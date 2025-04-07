const Web3 = require('web3');
const axios = require('axios');
const { 
  erc20Abi, 
  routerAbiV3, 
  factoryAbiV3, 
  poolAbiV3,
  quoterAbiV3
} = require('./utils/abi');
const { 
  BSC_RPC_URL, 
  PANCAKESWAP_ROUTER_ADDRESS, 
  PANCAKESWAP_FACTORY_ADDRESS,
  PANCAKESWAP_QUOTER_ADDRESS,
  WBNB_ADDRESS,
  BNB_TOKEN_INFO,
  DEFAULT_SLIPPAGE,
  DEFAULT_DEADLINE_MINUTES,
  MAX_UINT256,
  GAS_MULTIPLIER,
  FEE_TIERS
} = require('./utils/constants');

// Set to true for detailed logging, false for production
const DEBUG_MODE = false; 

// Initialize Web3
const web3 = new Web3(BSC_RPC_URL);

// Initialize contracts
const router = new web3.eth.Contract(routerAbiV3, PANCAKESWAP_ROUTER_ADDRESS);
const factory = new web3.eth.Contract(factoryAbiV3, PANCAKESWAP_FACTORY_ADDRESS);
const quoter = new web3.eth.Contract(quoterAbiV3, PANCAKESWAP_QUOTER_ADDRESS);

// Add a nonce cache at the top of the file, after other global variables
const nonceCache = {};

/**
 * Get the next available nonce for an address
 * @param {string} address - Wallet address
 * @returns {Promise<number>} Next available nonce
 */
async function getNextNonce(address) {
  try {
    // Get the current on-chain nonce
    const onChainNonce = await web3.eth.getTransactionCount(address, 'pending');
    
    // Check if we have a cached nonce
    if (nonceCache[address] === undefined || nonceCache[address] < onChainNonce) {
      nonceCache[address] = onChainNonce;
    } else {
      // Increment the cached nonce
      nonceCache[address]++;
    }
    
    debugLog(`Using nonce ${nonceCache[address]} for ${address}`, true);
    return nonceCache[address];
  } catch (error) {
    debugError('Error getting next nonce:', error);
    // Fallback to getting the current nonce
    const nonce = await web3.eth.getTransactionCount(address, 'pending');
    debugLog(`Fallback to on-chain nonce: ${nonce}`, true);
    return nonce;
  }
}

/**
 * Helper function for conditional logging
 * @param {string} message - Message to log
 * @param {boolean} [forceLog=false] - Whether to log even if DEBUG_MODE is false
 */
function debugLog(message, forceLog = false) {
  if (DEBUG_MODE || forceLog) {
    console.log(message);
  }
}

/**
 * Helper function for conditional error logging
 * @param {string} message - Message to log
 * @param {Error} [error] - Error object
 * @param {boolean} [forceLog=true] - Whether to log even if DEBUG_MODE is false
 */
function debugError(message, error = null, forceLog = true) {
  if (DEBUG_MODE || forceLog) {
    if (error) {
      console.error(message, error.message || error);
    } else {
      console.error(message);
    }
  }
}

/**
 * Safe conversion to BN
 * @param {string|number|Object} value - Value to convert
 * @param {string} [defaultValue="0"] - Default value if conversion fails
 * @returns {Object} BN instance
 */
function safeBN(value, defaultValue = "0") {
  try {
    // Handle undefined or null
    if (value === undefined || value === null) {
      debugLog(`safeBN: Converting null/undefined to BN(${defaultValue})`, true);
      return web3.utils.toBN(defaultValue);
    }
    
    // Handle BigNumber objects from web3
    if (value._isBigNumber) {
      return web3.utils.toBN(value.toString());
    }
    
    // Handle BN objects
    if (typeof value === 'object' && value.constructor && value.constructor.name === 'BN') {
      return value;
    }
    
    // Special handling for quoter response objects which may have an amountOut property
    if (typeof value === 'object' && value.amountOut !== undefined) {
      debugLog(`safeBN: Detected quoter response object, using amountOut: ${value.amountOut}`, true);
      return safeBN(value.amountOut, defaultValue);
    }
    
    // Handle objects that might be stringified incorrectly
    if (typeof value === 'object') {
      debugError(`safeBN: Received object instead of number or string: ${inspect(value)}`, null, true);
      return web3.utils.toBN(defaultValue);
    }
    
    // Convert to string first
    let strValue = value.toString().trim();
    
    // Handle strings with decimal points by removing decimals (for BN compatibility)
    if (strValue.includes('.')) {
      debugLog(`safeBN: String with decimal point detected, removing decimal: ${strValue}`, true);
      strValue = strValue.split('.')[0];
    }
    
    // Handle hex strings
    if (strValue.startsWith('0x')) {
      return web3.utils.toBN(strValue);
    }
    
    // Convert strings or numbers to BN properly
    return web3.utils.toBN(strValue);
  } catch (error) {
    debugError(`safeBN: Failed to convert ${typeof value === 'object' ? 'object' : value} (type: ${typeof value}) to BN`, error, true);
    return web3.utils.toBN(defaultValue);
  }
}

// Add helper function to inspect objects safely
function inspect(obj) {
  try {
    return JSON.stringify(obj);
  } catch (error) {
    return '[Object cannot be stringified]';
  }
}

/**
 * Get token information from contract address
 * @param {string} tokenAddress - Token address
 * @returns {Promise<Object>} Token info object with symbol, name, decimals
 */
async function getTokenInfo(tokenAddress) {
  if (tokenAddress.toLowerCase() === 'bnb') {
    return BNB_TOKEN_INFO;
  }
  
  try {
    // Check if address is a valid address
    if (!web3.utils.isAddress(tokenAddress)) {
      throw new Error('Invalid token address');
    }
    
    const tokenContract = new web3.eth.Contract(erc20Abi, tokenAddress);
    
    // Get token information in parallel
    const [symbol, name, decimals] = await Promise.all([
      tokenContract.methods.symbol().call(),
      tokenContract.methods.name().call(),
      tokenContract.methods.decimals().call()
    ]);
    
    return {
      address: tokenAddress,
      symbol,
      name,
      decimals: parseInt(decimals)
    };
  } catch (error) {
    console.error('Error getting token info:', error);
    throw new Error(`Failed to get token info: ${error.message}`);
  }
}

/**
 * Find the best fee tier for a token pair
 * @param {string} tokenA - First token address
 * @param {string} tokenB - Second token address
 * @returns {Promise<number>} Best fee tier
 */
async function findBestFeeTier(tokenA, tokenB) {
  try {
    debugLog(`Finding best fee tier for ${tokenA} and ${tokenB}...`);
    
    // Try all fee tiers and find the one with the most liquidity
    const feeTiers = [FEE_TIERS.LOWEST, FEE_TIERS.LOW, FEE_TIERS.MEDIUM, FEE_TIERS.HIGH];
    let bestFeeTier = FEE_TIERS.MEDIUM; // Default to medium fee
    let maxLiquidity = safeBN("0");
    let poolsFound = false;
    
    for (const fee of feeTiers) {
      try {
        debugLog(`Checking fee tier: ${fee / 10000}%`);
        const poolAddress = await factory.methods.getPool(tokenA, tokenB, fee).call();
        
        if (poolAddress !== '0x0000000000000000000000000000000000000000') {
          debugLog(`Pool found at ${poolAddress} for fee tier ${fee / 10000}%`);
          poolsFound = true;
          
          try {
            const poolContract = new web3.eth.Contract(poolAbiV3, poolAddress);
            const liquidityStr = await poolContract.methods.liquidity().call();
            debugLog(`Liquidity: ${liquidityStr}`);
            
            // Safely convert liquidity to BN
            const liquidity = safeBN(liquidityStr);
            
            if (liquidity.gt(maxLiquidity)) {
              maxLiquidity = liquidity;
              bestFeeTier = fee;
              debugLog(`New best fee tier: ${bestFeeTier / 10000}% with liquidity ${liquidity.toString()}`);
            }
          } catch (error) {
            debugError(`Error checking liquidity for fee tier ${fee / 10000}%:`, error);
          }
        } else {
          debugLog(`No pool found for fee tier ${fee / 10000}%`);
        }
      } catch (error) {
        debugError(`Error checking fee tier ${fee / 10000}%:`, error);
      }
    }
    
    if (!poolsFound) {
      debugLog(`No pools found for ${tokenA} and ${tokenB}. Using default fee tier: ${FEE_TIERS.MEDIUM / 10000}%`, true);
    } else if (maxLiquidity.isZero()) {
      debugLog(`Pools found but no liquidity data. Using default fee tier: ${FEE_TIERS.MEDIUM / 10000}%`, true);
    } else {
      debugLog(`Selected best fee tier: ${bestFeeTier / 10000}% with liquidity ${maxLiquidity.toString()}`, true);
    }
    
    // To help with troubleshooting, prioritize tiers in a specific order if we couldn't determine liquidity
    if (maxLiquidity.isZero()) {
      // Try to find any existing pool first, regardless of liquidity
      for (const fee of feeTiers) {
        try {
          const poolAddress = await factory.methods.getPool(tokenA, tokenB, fee).call();
          if (poolAddress !== '0x0000000000000000000000000000000000000000') {
            debugLog(`Using existing pool with fee tier ${fee / 10000}%`, true);
            return fee;
          }
        } catch (error) {
          // Ignore errors here
        }
      }
      
      // If no pools exist, use this priority order (medium fee is most common)
      debugLog(`No pools with liquidity found, using default medium fee tier`, true);
      return FEE_TIERS.MEDIUM;
    }
    
    return bestFeeTier;
  } catch (error) {
    debugError('Error finding best fee tier:', error);
    debugLog(`Falling back to medium fee tier ${FEE_TIERS.MEDIUM / 10000}%`, true);
    return FEE_TIERS.MEDIUM; // Default to medium fee if an error occurs
  }
}

/**
 * Encode PancakeSwap V3 path for multi-hop swaps
 * @param {string[]} tokenAddresses - Array of token addresses in the path
 * @param {number[]} fees - Array of fees for each hop
 * @returns {string} Encoded path
 */
function encodePath(tokenAddresses, fees) {
  if (tokenAddresses.length !== fees.length + 1) {
    throw new Error('tokenAddresses.length must be equal to fees.length + 1');
  }
  
  let path = '0x';
  for (let i = 0; i < fees.length; i++) {
    path += tokenAddresses[i].slice(2);
    path += fees[i].toString(16).padStart(6, '0');
  }
  path += tokenAddresses[tokenAddresses.length - 1].slice(2);
  
  return path;
}

/**
 * Calculate deadline timestamp
 * @param {number} minutes - Minutes from now
 * @returns {number} Deadline timestamp in seconds
 */
function getDeadline(minutes = DEFAULT_DEADLINE_MINUTES) {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}

/**
 * Calculate gas price with multiplier
 * @returns {Promise<string>} Gas price in wei with multiplier applied
 */
async function getGasPrice() {
  const gasPrice = await web3.eth.getGasPrice();
  return Math.floor(Number(gasPrice) * GAS_MULTIPLIER).toString();
}

/**
 * Convert token amount to its smallest unit based on decimals
 * @param {number|string} amount - Amount to convert
 * @param {number} decimals - Token decimals
 * @returns {string} Amount in smallest unit
 */
function toTokenUnits(amount, decimals) {
  try {
    // Check if decimals is a standard value we can use with web3.utils.toWei
    if ([3, 6, 9, 12, 15, 18].includes(decimals)) {
      return web3.utils.toWei(amount.toString(), getEtherUnit(decimals));
    }
    
    // For non-standard decimals, we need to convert manually
    const amountStr = amount.toString();
    let result;
    
    if (amountStr.includes('.')) {
      // Split at decimal point
      const parts = amountStr.split('.');
      const whole = parts[0];
      let fractional = parts[1];
      
      // Trim or pad the fractional part to match decimals
      if (fractional.length > decimals) {
        fractional = fractional.substring(0, decimals);
      } else {
        while (fractional.length < decimals) {
          fractional += '0';
        }
      }
      
      // Remove leading zeros from whole part
      const trimmedWhole = whole.replace(/^0+/, '') || '0';
      
      // Combine
      result = trimmedWhole + fractional;
      // Remove leading zeros
      result = result.replace(/^0+/, '') || '0';
    } else {
      // No decimal point, just add zeros
      result = amountStr + '0'.repeat(decimals);
      // Remove leading zeros
      result = result.replace(/^0+/, '') || '0';
    }
    
    debugLog(`Manual conversion: ${amount} with ${decimals} decimals -> ${result}`);
    return result;
  } catch (error) {
    debugError(`Error in toTokenUnits: ${error.message}`, error);
    throw new Error(`Failed to convert ${amount} to token units with ${decimals} decimals`);
  }
}

/**
 * Convert amount from smallest unit to human readable
 * @param {string} amount - Amount in smallest unit
 * @param {number} decimals - Token decimals
 * @returns {string} Human readable amount
 */
function fromTokenUnits(amount, decimals) {
  try {
    // Check if decimals is a standard value we can use with web3.utils.fromWei
    if ([3, 6, 9, 12, 15, 18].includes(decimals)) {
      return web3.utils.fromWei(amount, getEtherUnit(decimals));
    }
    
    // For non-standard decimals, we need to convert manually
    const amountStr = amount.toString();
    
    if (amountStr === '0') return '0';
    
    // Pad with leading zeros if needed
    let paddedAmount = amountStr;
    while (paddedAmount.length <= decimals) {
      paddedAmount = '0' + paddedAmount;
    }
    
    // Insert decimal point
    const decimalPos = paddedAmount.length - decimals;
    const result = paddedAmount.substring(0, decimalPos) + '.' + paddedAmount.substring(decimalPos);
    
    // Trim trailing zeros and decimal point if it's the last character
    return result.replace(/\.?0+$/, '');
  } catch (error) {
    debugError(`Error in fromTokenUnits: ${error.message}`, error);
    return amount.toString();
  }
}

/**
 * Get appropriate ether unit based on decimals
 * @param {number} decimals - Token decimals
 * @returns {string} Ether unit
 */
function getEtherUnit(decimals) {
  switch (decimals) {
    case 3: return 'kwei';
    case 6: return 'mwei';
    case 9: return 'gwei';
    case 12: return 'microether';
    case 15: return 'milliether';
    case 18: return 'ether';
    default: 
      // For non-standard decimals, we convert manually
      if (decimals < 18) {
        return 'wei';
      }
      return 'ether';
  }
}

/**
 * Basic check for potential honeypot tokens
 * This is a simplified check and not foolproof
 * @param {string} tokenAddress - Token address to check
 * @returns {Promise<boolean>} True if token might be a honeypot
 */
async function checkForHoneypot(tokenAddress) {
  try {
    const tokenContract = new web3.eth.Contract(erc20Abi, tokenAddress);
    
    // Check if token has unusual transfer conditions that might indicate a honeypot
    // This is a basic check for educational purposes
    
    // 1. Check if contract has unusual code size (might indicate complexity)
    const code = await web3.eth.getCode(tokenAddress);
    const unusualCodeSize = code.length > 50000; // Arbitrary threshold
    
    // 2. Check total supply (some honeypots have unusual supplies)
    const totalSupply = await tokenContract.methods.totalSupply().call().catch(() => '0');
    
    // 3. Check if the contract includes common indicators of problematic tokens
    const hasIndicators = code.includes('owner') && code.includes('blacklist') && code.includes('swap');
    
    return unusualCodeSize || hasIndicators;
  } catch (error) {
    console.error('Error checking for honeypot:', error);
    return false; // Default to false if we can't determine
  }
}

/**
 * Validate if a PancakeSwap V3 pool has enough liquidity for trading
 * @param {string} tokenAddress - Token address
 * @param {number} feeTier - Fee tier to check
 * @returns {Promise<boolean>} True if pool is valid for trading
 */
async function validatePancakeV3Pool(tokenAddress, feeTier) {
  try {
    // Sort token addresses (lower address should be first)
    const sortedTokens = web3.utils.toChecksumAddress(tokenAddress) < web3.utils.toChecksumAddress(WBNB_ADDRESS)
      ? [tokenAddress, WBNB_ADDRESS]
      : [WBNB_ADDRESS, tokenAddress];

    // Get pool address
    const poolAddress = await factory.methods.getPool(
      sortedTokens[0],
      sortedTokens[1],
      feeTier
    ).call();

    // Check if pool exists
    if (poolAddress === '0x0000000000000000000000000000000000000000') {
      debugLog(`No PancakeSwap V3 pool exists for ${tokenAddress} with fee tier ${feeTier/10000}%`, true);
      return false;
    }

    // Create pool contract
    const poolContract = new web3.eth.Contract(poolAbiV3, poolAddress);
    
    // Check liquidity
    const liquidity = await poolContract.methods.liquidity().call();
    debugLog(`Pool ${poolAddress} has liquidity: ${liquidity}`);
    
    if (web3.utils.toBN(liquidity).lte(web3.utils.toBN('1000000'))) {
      debugLog(`Pool ${poolAddress} has very low liquidity: ${liquidity}`, true);
      return false;
    }
    
    // Check if pool is initialized by getting slot0
    try {
      const slot0 = await poolContract.methods.slot0().call();
      debugLog(`Pool sqrtPriceX96: ${slot0.sqrtPriceX96}`);
      
      // If sqrtPriceX96 is 0, pool is not initialized
      if (slot0.sqrtPriceX96 === '0') {
        debugLog(`Pool ${poolAddress} is not initialized (sqrtPriceX96 = 0)`, true);
        return false;
      }
      
      return true;
    } catch (error) {
      debugError(`Error getting slot0 for pool ${poolAddress}:`, error);
      return false;
    }
  } catch (error) {
    debugError('Error validating PancakeSwap V3 pool:', error);
    return false;
  }
}

/**
 * Buy tokens using BNB
 * @param {string} privateKey - Private key of the account
 * @param {string} tokenAddress - Token address to buy
 * @param {string|number} bnbAmount - Amount of BNB to spend
 * @param {number} slippagePercent - Slippage tolerance in percentage
 * @returns {Promise<string>} Transaction hash
 */
async function buyToken(privateKey, tokenAddress, bnbAmount, slippagePercent = 1.0) {
  try {
    // Add account to wallet
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(account);
    const walletAddress = account.address;
    
    debugLog(`Using wallet address: ${walletAddress}`, true);
    
    // Check BNB balance
    const bnbBalance = await web3.eth.getBalance(walletAddress);
    let bnbAmountWei;
    
    try {
      // Convert BNB amount to Wei safely
      bnbAmountWei = web3.utils.toWei(bnbAmount.toString(), 'ether');
    } catch (error) {
      debugError(`Error converting BNB amount to Wei: ${error.message}`, error);
      throw new Error(`Invalid BNB amount: ${bnbAmount}. Please provide a valid number.`);
    }
    
    debugLog(`BNB balance: ${web3.utils.fromWei(bnbBalance, 'ether')} BNB`);
    debugLog(`Attempting to spend: ${bnbAmount} BNB`);
    
    if (web3.utils.toBN(bnbBalance).lt(web3.utils.toBN(bnbAmountWei))) {
      throw new Error(`Insufficient BNB balance. You have ${web3.utils.fromWei(bnbBalance, 'ether')} BNB but trying to spend ${bnbAmount} BNB`);
    }
    
    // Get token info
    const tokenInfo = await getTokenInfo(tokenAddress);
    debugLog(`Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
    
    // Find the best fee tier for the token pair
    let feeTier = await findBestFeeTier(WBNB_ADDRESS, tokenAddress);
    
    // Validate if the pool has enough liquidity
    const isPoolValid = await validatePancakeV3Pool(tokenAddress, feeTier);
    if (!isPoolValid) {
      // Try other fee tiers if the best one doesn't have enough liquidity
      const feeTiers = [FEE_TIERS.LOWEST, FEE_TIERS.LOW, FEE_TIERS.MEDIUM, FEE_TIERS.HIGH];
      let foundValidPool = false;
      
      for (const alternativeFee of feeTiers.filter(fee => fee !== feeTier)) {
        debugLog(`Trying alternative fee tier: ${alternativeFee/10000}%`, true);
        if (await validatePancakeV3Pool(tokenAddress, alternativeFee)) {
          debugLog(`Found valid pool with fee tier ${alternativeFee/10000}%`, true);
          feeTier = alternativeFee;
          foundValidPool = true;
          break;
        }
      }
      
      if (!foundValidPool) {
        throw new Error('No valid PancakeSwap V3 pool found with sufficient liquidity. Trading may not be possible at this time.');
      }
    }
    
    // Check if the token might be a honeypot
    const isHoneypot = await checkForHoneypot(tokenAddress);
    if (isHoneypot) {
      throw new Error('This token appears to be a potential honeypot. Transaction aborted for your safety.');
    }
    
    // Encode path for swap (WBNB -> Token)
    const path = encodePath([WBNB_ADDRESS, tokenAddress], [feeTier]);
    
    // Get expected output amount
    let expectedOutputAmount = '0';
    let usedFallback = false;
    
    try {
      // Try using the quoter first
      const quoteResult = await quoter.methods.quoteExactInput(
        path,
        bnbAmountWei
      ).call();
      
      // Enhanced logging for debugging
      debugLog(`Raw quoter response: ${inspect(quoteResult)}`, true);
      
      // Extract the amountOut from the response
      if (typeof quoteResult === 'object' && quoteResult.amountOut) {
        expectedOutputAmount = quoteResult.amountOut.toString();
      } else if (typeof quoteResult === 'string' || typeof quoteResult === 'number') {
        expectedOutputAmount = quoteResult.toString();
      } else {
        throw new Error('Unexpected quoter response format');
      }
      
      debugLog(`Quoted output amount from PancakeSwap V3 Quoter: ${expectedOutputAmount}`);
    } catch (quoteError) {
      debugError('Failed to quote output amount using V3 Quoter:', quoteError);
      usedFallback = true;
      
      try {
        debugLog('Attempting to estimate price using pool data...', true);
        
        // Get pool data for manual price calculation
        const sortedTokens = web3.utils.toChecksumAddress(tokenAddress) < web3.utils.toChecksumAddress(WBNB_ADDRESS)
          ? [tokenAddress, WBNB_ADDRESS]
          : [WBNB_ADDRESS, tokenAddress];
        
        const poolAddress = await factory.methods.getPool(sortedTokens[0], sortedTokens[1], feeTier).call();
        
        if (poolAddress !== '0x0000000000000000000000000000000000000000') {
          const poolContract = new web3.eth.Contract(poolAbiV3, poolAddress);
          const slot0 = await poolContract.methods.slot0().call();
          
          debugLog(`Pool data - sqrtPriceX96: ${slot0.sqrtPriceX96}`, true);
          
          // Safely convert values to BN
          try {
            // Calculate price from sqrtPriceX96
            const sqrtPriceX96 = safeBN(slot0.sqrtPriceX96);
            const Q96 = web3.utils.toBN(2).pow(web3.utils.toBN(96));
            
            // Convert to price depending on token order
            let price;
            if (sortedTokens[0] === WBNB_ADDRESS) {
              // If BNB is token0, then price = 1 / (sqrtPriceX96^2 / 2^192)
              const sqrtPriceSquared = sqrtPriceX96.mul(sqrtPriceX96);
              if (sqrtPriceSquared.isZero()) {
                throw new Error('Price calculation failed: sqrtPriceSquared is zero');
              }
              price = Q96.mul(Q96).div(sqrtPriceSquared);
            } else {
              // If BNB is token1, then price = sqrtPriceX96^2 / 2^192
              price = sqrtPriceX96.mul(sqrtPriceX96).div(Q96.mul(Q96));
            }
            
            // Adjust for decimals
            const decimalAdjustment = web3.utils.toBN(10).pow(web3.utils.toBN(18 - tokenInfo.decimals));
            price = price.mul(decimalAdjustment);
            
            // Calculate rough output amount
            const inputAmount = safeBN(bnbAmountWei);
            const divisionFactor = safeBN(10).pow(safeBN(18));
            let roughOutputAmount;
            
            // Avoid division by zero
            if (divisionFactor.isZero()) {
              throw new Error('Division by zero error in price calculation');
            }
            
            roughOutputAmount = inputAmount.mul(price).div(divisionFactor);
            
            // Apply a safety factor (reduce by 10%) to account for fees and price impact
            roughOutputAmount = roughOutputAmount.mul(safeBN(90)).div(safeBN(100));
            
            expectedOutputAmount = roughOutputAmount.toString();
            debugLog(`Estimated output amount using pool data: ${expectedOutputAmount}`, true);
          } catch (calcError) {
            debugError('Error in price calculation:', calcError);
            // Use a fallback minimum value
            expectedOutputAmount = '1000';
            debugLog('Using minimum fallback value due to calculation error', true);
          }
        } else {
          debugLog('No pool found for manual price estimation', true);
          
          // Last resort: use a very small non-zero amount to allow transaction with high slippage
          expectedOutputAmount = '1000';
          debugLog('Using minimum fallback value for output amount', true);
        }
      } catch (fallbackError) {
        debugError('Failed to estimate price using fallback:', fallbackError);
        
        // Last resort: use a very small non-zero amount to allow transaction with high slippage
        expectedOutputAmount = '1000';
        debugLog('Using minimum fallback value for output amount after all attempts failed', true);
      }
    }
    
    // Calculate minimum output amount based on slippage
    let amountOutMin;
    try {
      // Safely convert to BN
      const bnExpectedOutput = safeBN(expectedOutputAmount);
      const bnSlippageFactor = safeBN(10000 - slippagePercent * 100);
      const bnDivisor = safeBN(10000);
      
      // Avoid division by zero
      if (bnDivisor.isZero()) {
        amountOutMin = bnExpectedOutput.toString(); // Just use the expected output as minimum if division error
        debugLog('Division error in slippage calculation, using expected output as minimum', true);
      } else {
        amountOutMin = bnExpectedOutput.mul(bnSlippageFactor).div(bnDivisor).toString();
      }
    } catch (error) {
      debugError('Error calculating minimum output amount:', error);
      // Fallback: set amountOutMin to a very small value to allow transaction to proceed
      amountOutMin = '1';
      debugLog('Using minimum fallback value for minimum output amount', true);
    }
    
    debugLog(`Expected output: ${fromTokenUnits(expectedOutputAmount, tokenInfo.decimals)} ${tokenInfo.symbol}`, true);
    debugLog(`Minimum output (with ${slippagePercent}% slippage): ${fromTokenUnits(amountOutMin, tokenInfo.decimals)} ${tokenInfo.symbol}`, true);
    
    if (usedFallback) {
      debugLog('⚠️ Using estimated price due to quoter failure. Consider using higher slippage.', true);
    }
    
    // Get the next nonce
    const nonce = await getNextNonce(walletAddress);
    
    // Setup swap parameters
    const recipient = walletAddress;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    
    // Estimate gas
    const gasPrice = await web3.eth.getGasPrice();
    
    // Prepare transaction
    const swapParams = {
      path: path,
      recipient: recipient,
      deadline: deadline,
      amountIn: bnbAmountWei,
      amountOutMinimum: amountOutMin
    };
    
    const swapData = router.methods.exactInput(swapParams).encodeABI();
    const estimatedGas = await router.methods.exactInput(swapParams).estimateGas({
      from: walletAddress,
      value: bnbAmountWei
    }).catch(error => {
      debugError('Gas estimation failed:', error);
      // Default gas limit if estimation fails
      return 500000;
    });
    
    debugLog(`Gas estimate: ${estimatedGas}`);
    debugLog(`Gas price: ${web3.utils.fromWei(gasPrice, 'gwei')} gwei`);
    debugLog(`Swapping ${bnbAmount} BNB for ${tokenInfo.symbol} with ${slippagePercent}% slippage`, true);
    
    // Execute the swap
    const tx = await web3.eth.sendTransaction({
      from: walletAddress,
      to: PANCAKESWAP_ROUTER_ADDRESS,
      data: swapData,
      value: bnbAmountWei,
      gas: Math.floor(estimatedGas * 1.1), // Add 10% buffer
      gasPrice: gasPrice,
      nonce: nonce // Add the nonce
    });
    
    // Clean up wallet
    web3.eth.accounts.wallet.remove(walletAddress);
    
    debugLog(`Transaction successful! Hash: ${tx.transactionHash}`, true);
    return tx.transactionHash;
  } catch (error) {
    debugError('Error buying token:', error);
    
    // Clean up wallet if exists
    try {
      const account = web3.eth.accounts.privateKeyToAccount(privateKey);
      web3.eth.accounts.wallet.remove(account.address);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    throw error;
  }
}

/**
 * Sell tokens for BNB
 * @param {string} privateKey - Private key of the account
 * @param {string} tokenAddress - Token address to sell
 * @param {string|number} tokenAmount - Amount of tokens to sell
 * @param {number} slippagePercent - Slippage tolerance in percentage
 * @returns {Promise<string>} Transaction hash
 */
async function sellToken(privateKey, tokenAddress, tokenAmount, slippagePercent = 1.0) {
  try {
    // Add account to wallet
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(account);
    const walletAddress = account.address;
    
    debugLog(`Using wallet address: ${walletAddress}`, true);
    
    // Get token info
    const tokenInfo = await getTokenInfo(tokenAddress);
    debugLog(`Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
    
    // Convert token amount to token units safely
    let tokenAmountInUnits;
    
    try {
      tokenAmountInUnits = toTokenUnits(tokenAmount, tokenInfo.decimals);
      debugLog(`Token amount in smallest units: ${tokenAmountInUnits}`);
    } catch (error) {
      debugError(`Error converting token amount to units: ${error.message}`, error);
      throw new Error(`Invalid token amount: ${tokenAmount}. Please provide a valid number.`);
    }
    
    // Check token balance
    const tokenBalance = await tokenContract.methods.balanceOf(walletAddress).call();
    debugLog(`Token balance: ${fromTokenUnits(tokenBalance, tokenInfo.decimals)} ${tokenInfo.symbol}`);
    debugLog(`Attempting to sell: ${tokenAmount} ${tokenInfo.symbol}`);
    
    if (web3.utils.toBN(tokenBalance).lt(web3.utils.toBN(tokenAmountInUnits))) {
      throw new Error(`Insufficient token balance. You have ${fromTokenUnits(tokenBalance, tokenInfo.decimals)} ${tokenInfo.symbol} but trying to sell ${tokenAmount} ${tokenInfo.symbol}`);
    }
    
    // Find the best fee tier for the token pair
    let feeTier = await findBestFeeTier(tokenAddress, WBNB_ADDRESS);
    
    // Validate if the pool has enough liquidity
    const isPoolValid = await validatePancakeV3Pool(tokenAddress, feeTier);
    if (!isPoolValid) {
      // Try other fee tiers if the best one doesn't have enough liquidity
      const feeTiers = [FEE_TIERS.LOWEST, FEE_TIERS.LOW, FEE_TIERS.MEDIUM, FEE_TIERS.HIGH];
      let foundValidPool = false;
      
      for (const alternativeFee of feeTiers.filter(fee => fee !== feeTier)) {
        debugLog(`Trying alternative fee tier: ${alternativeFee/10000}%`, true);
        if (await validatePancakeV3Pool(tokenAddress, alternativeFee)) {
          debugLog(`Found valid pool with fee tier ${alternativeFee/10000}%`, true);
          feeTier = alternativeFee;
          foundValidPool = true;
          break;
        }
      }
      
      if (!foundValidPool) {
        throw new Error('No valid PancakeSwap V3 pool found with sufficient liquidity. Trading may not be possible at this time.');
      }
    }
    
    // Encode path for swap (Token -> WBNB)
    const path = encodePath([tokenAddress, WBNB_ADDRESS], [feeTier]);
    
    // Get expected output amount
    let expectedOutputAmount = '0';
    let usedFallback = false;
    
    try {
      // Try using the quoter first
      const quoteResult = await quoter.methods.quoteExactInput(
        path,
        tokenAmountInUnits
      ).call();
      
      // Enhanced logging for debugging
      debugLog(`Raw quoter response: ${inspect(quoteResult)}`, true);
      
      // Extract the amountOut from the response
      if (typeof quoteResult === 'object' && quoteResult.amountOut) {
        expectedOutputAmount = quoteResult.amountOut.toString();
      } else if (typeof quoteResult === 'string' || typeof quoteResult === 'number') {
        expectedOutputAmount = quoteResult.toString();
      } else {
        throw new Error('Unexpected quoter response format');
      }
      
      debugLog(`Quoted output amount from PancakeSwap V3 Quoter: ${expectedOutputAmount}`);
    } catch (quoteError) {
      debugError('Failed to quote output amount using V3 Quoter:', quoteError);
      usedFallback = true;
      
      try {
        debugLog('Attempting to estimate price using pool data...', true);
        
        // Get pool data for manual price calculation
        const sortedTokens = web3.utils.toChecksumAddress(tokenAddress) < web3.utils.toChecksumAddress(WBNB_ADDRESS)
          ? [tokenAddress, WBNB_ADDRESS]
          : [WBNB_ADDRESS, tokenAddress];
        
        const poolAddress = await factory.methods.getPool(sortedTokens[0], sortedTokens[1], feeTier).call();
        
        if (poolAddress !== '0x0000000000000000000000000000000000000000') {
          const poolContract = new web3.eth.Contract(poolAbiV3, poolAddress);
          const slot0 = await poolContract.methods.slot0().call();
          
          debugLog(`Pool data - sqrtPriceX96: ${slot0.sqrtPriceX96}`, true);
          
          // Safely convert values to BN
          try {
            // Calculate price from sqrtPriceX96
            const sqrtPriceX96 = safeBN(slot0.sqrtPriceX96);
            const Q96 = web3.utils.toBN(2).pow(web3.utils.toBN(96));
            
            // Convert to price depending on token order
            let price;
            if (sortedTokens[0] === tokenAddress) {
              // If token is token0, then token price in BNB = 1 / (sqrtPriceX96^2 / 2^192)
              const sqrtPriceSquared = sqrtPriceX96.mul(sqrtPriceX96);
              if (sqrtPriceSquared.isZero()) {
                throw new Error('Price calculation failed: sqrtPriceSquared is zero');
              }
              price = Q96.mul(Q96).div(sqrtPriceSquared);
            } else {
              // If token is token1, then token price in BNB = sqrtPriceX96^2 / 2^192
              price = sqrtPriceX96.mul(sqrtPriceX96).div(Q96.mul(Q96));
            }
            
            // Adjust for decimals
            const decimalAdjustment = web3.utils.toBN(10).pow(web3.utils.toBN(tokenInfo.decimals - 18));
            price = price.mul(decimalAdjustment);
            
            // Calculate rough output amount
            const inputAmount = safeBN(tokenAmountInUnits);
            const divisionFactor = safeBN(10).pow(safeBN(tokenInfo.decimals));
            let roughOutputAmount;
            
            // Avoid division by zero
            if (divisionFactor.isZero()) {
              throw new Error('Division by zero error in price calculation');
            }
            
            roughOutputAmount = inputAmount.mul(price).div(divisionFactor);
            
            // Apply a safety factor (reduce by 10%) to account for fees and price impact
            roughOutputAmount = roughOutputAmount.mul(safeBN(90)).div(safeBN(100));
            
            expectedOutputAmount = roughOutputAmount.toString();
            debugLog(`Estimated output amount using pool data: ${expectedOutputAmount}`, true);
          } catch (calcError) {
            debugError('Error in price calculation:', calcError);
            // Use a fallback minimum value
            expectedOutputAmount = '1000';
            debugLog('Using minimum fallback value due to calculation error', true);
          }
        } else {
          debugLog('No pool found for manual price estimation', true);
          
          // Last resort: use a very small non-zero amount to allow transaction with high slippage
          expectedOutputAmount = '1000';
          debugLog('Using minimum fallback value for output amount', true);
        }
      } catch (fallbackError) {
        debugError('Failed to estimate price using fallback:', fallbackError);
        
        // Last resort: use a very small non-zero amount to allow transaction with high slippage
        expectedOutputAmount = '1000';
        debugLog('Using minimum fallback value for output amount after all attempts failed', true);
      }
    }
    
    // Calculate minimum output amount based on slippage
    let amountOutMin;
    try {
      // Safely convert to BN
      const bnExpectedOutput = safeBN(expectedOutputAmount);
      const bnSlippageFactor = safeBN(10000 - slippagePercent * 100);
      const bnDivisor = safeBN(10000);
      
      // Avoid division by zero
      if (bnDivisor.isZero()) {
        amountOutMin = bnExpectedOutput.toString(); // Just use the expected output as minimum if division error
        debugLog('Division error in slippage calculation, using expected output as minimum', true);
      } else {
        amountOutMin = bnExpectedOutput.mul(bnSlippageFactor).div(bnDivisor).toString();
      }
    } catch (error) {
      debugError('Error calculating minimum output amount:', error);
      // Fallback: set amountOutMin to a very small value to allow transaction to proceed
      amountOutMin = '1';
      debugLog('Using minimum fallback value for minimum output amount', true);
    }
    
    debugLog(`Expected output: ${web3.utils.fromWei(expectedOutputAmount, 'ether')} BNB`, true);
    debugLog(`Minimum output (with ${slippagePercent}% slippage): ${web3.utils.fromWei(amountOutMin, 'ether')} BNB`, true);
    
    if (usedFallback) {
      debugLog('⚠️ Using estimated price due to quoter failure. Consider using higher slippage.', true);
    }
    
    // Get the next nonce for approval transaction
    let nonce = await getNextNonce(walletAddress);
    
    // Check if the token has any transfer restrictions
    try {
      // Check allowance
      const allowance = await tokenContract.methods.allowance(walletAddress, PANCAKESWAP_ROUTER_ADDRESS).call();
      
      // If allowance is less than the amount to sell, approve tokens
      if (web3.utils.toBN(allowance).lt(web3.utils.toBN(tokenAmountInUnits))) {
        debugLog('Approving tokens for PancakeSwap V3 router...', true);
        
        // Unlimited approval
        const approveAmount = web3.utils.toBN(2).pow(web3.utils.toBN(256)).sub(web3.utils.toBN(1)).toString();
        
        const approveTx = await tokenContract.methods.approve(PANCAKESWAP_ROUTER_ADDRESS, approveAmount).send({
          from: walletAddress,
          gas: 200000,
          gasPrice: await web3.eth.getGasPrice(),
          nonce: nonce // Add the nonce for approval
        });
        
        debugLog(`Token approval successful! Hash: ${approveTx.transactionHash}`);
        
        // Increment nonce for the next transaction
        nonce++;
      } else {
        debugLog('Token already approved for PancakeSwap V3 router');
      }
    } catch (error) {
      debugError('Token approval failed:', error);
      throw new Error(`Token approval failed: ${error.message}. This token may have transfer restrictions or be a honeypot.`);
    }
    
    // Setup swap parameters
    const recipient = walletAddress;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    
    // Estimate gas
    const gasPrice = await web3.eth.getGasPrice();
    
    // Prepare transaction
    const swapParams = {
      path: path,
      recipient: recipient,
      deadline: deadline,
      amountIn: tokenAmountInUnits,
      amountOutMinimum: amountOutMin
    };
    
    const swapData = router.methods.exactInput(swapParams).encodeABI();
    const estimatedGas = await router.methods.exactInput(swapParams).estimateGas({
      from: walletAddress
    }).catch(error => {
      debugError('Gas estimation failed:', error);
      // Default gas limit if estimation fails
      return 500000;
    });
    
    debugLog(`Gas estimate: ${estimatedGas}`);
    debugLog(`Gas price: ${web3.utils.fromWei(gasPrice, 'gwei')} gwei`);
    debugLog(`Swapping ${tokenAmount} ${tokenInfo.symbol} for BNB with ${slippagePercent}% slippage`, true);
    
    // Execute the swap with the current nonce (either incremented after approval or the original one)
    const tx = await web3.eth.sendTransaction({
      from: walletAddress,
      to: PANCAKESWAP_ROUTER_ADDRESS,
      data: swapData,
      gas: Math.floor(estimatedGas * 1.1), // Add 10% buffer
      gasPrice: gasPrice,
      nonce: nonce // Add the nonce
    });
    
    // Clean up wallet
    web3.eth.accounts.wallet.remove(walletAddress);
    
    debugLog(`Transaction successful! Hash: ${tx.transactionHash}`, true);
    return tx.transactionHash;
  } catch (error) {
    debugError('Error selling token:', error);
    
    // Clean up wallet if exists
    try {
      const account = web3.eth.accounts.privateKeyToAccount(privateKey);
      web3.eth.accounts.wallet.remove(account.address);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    throw error;
  }
}

/**
 * Buy tokens using BNB with a specific fee tier
 * @param {string} privateKey - Private key of the account
 * @param {string} tokenAddress - Token address to buy
 * @param {string|number} bnbAmount - Amount of BNB to spend
 * @param {number} slippagePercent - Slippage tolerance in percentage
 * @param {number} [specificFeeTier] - Use a specific fee tier if provided
 * @returns {Promise<string>} Transaction hash
 */
async function buyTokenWithFeeTier(privateKey, tokenAddress, bnbAmount, slippagePercent = 1.0, specificFeeTier = FEE_TIERS.MEDIUM) {
  debugLog(`Using specific fee tier: ${specificFeeTier / 10000}%`, true);
  
  // Call the regular buyToken but with fixed fee tier
  try {
    // Add account to wallet
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(account);
    const walletAddress = account.address;
    
    debugLog(`Using wallet address: ${walletAddress}`, true);
    
    // Check BNB balance
    const bnbBalance = await web3.eth.getBalance(walletAddress);
    const bnbAmountWei = web3.utils.toWei(bnbAmount.toString(), 'ether');
    
    debugLog(`BNB balance: ${web3.utils.fromWei(bnbBalance, 'ether')} BNB`);
    debugLog(`Attempting to spend: ${bnbAmount} BNB`);
    
    if (web3.utils.toBN(bnbBalance).lt(web3.utils.toBN(bnbAmountWei))) {
      throw new Error(`Insufficient BNB balance. You have ${web3.utils.fromWei(bnbBalance, 'ether')} BNB but trying to spend ${bnbAmount} BNB`);
    }
    
    // Get token info
    const tokenInfo = await getTokenInfo(tokenAddress);
    debugLog(`Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
    
    // Use the specified fee tier instead of finding the best one
    const feeTier = specificFeeTier;
    
    // Validate if the pool has enough liquidity
    const isPoolValid = await validatePancakeV3Pool(tokenAddress, feeTier);
    if (!isPoolValid) {
      throw new Error(`No valid PancakeSwap V3 pool with ${feeTier/10000}% fee tier found. Try using the auto-select option instead.`);
    }
    
    // Check if the token might be a honeypot
    const isHoneypot = await checkForHoneypot(tokenAddress);
    if (isHoneypot) {
      throw new Error('This token appears to be a potential honeypot. Transaction aborted for your safety.');
    }
    
    // Encode path for swap (WBNB -> Token)
    const path = encodePath([WBNB_ADDRESS, tokenAddress], [feeTier]);
    
    // Get expected output amount
    let expectedOutputAmount = '0';
    let usedFallback = false;
    
    try {
      // Try using the quoter first
      const quoteResult = await quoter.methods.quoteExactInput(
        path,
        bnbAmountWei
      ).call();
      
      // Enhanced logging for debugging
      debugLog(`Raw quoter response: ${inspect(quoteResult)}`, true);
      
      // Extract the amountOut from the response
      if (typeof quoteResult === 'object' && quoteResult.amountOut) {
        expectedOutputAmount = quoteResult.amountOut.toString();
      } else if (typeof quoteResult === 'string' || typeof quoteResult === 'number') {
        expectedOutputAmount = quoteResult.toString();
      } else {
        throw new Error('Unexpected quoter response format');
      }
      
      debugLog(`Quoted output amount from PancakeSwap V3 Quoter: ${expectedOutputAmount}`);
    } catch (quoteError) {
      debugError('Failed to quote output amount using V3 Quoter:', quoteError);
      usedFallback = true;
      
      try {
        debugLog('Attempting to estimate price using pool data...', true);
        
        // Get pool data for manual price calculation
        const sortedTokens = web3.utils.toChecksumAddress(tokenAddress) < web3.utils.toChecksumAddress(WBNB_ADDRESS)
          ? [tokenAddress, WBNB_ADDRESS]
          : [WBNB_ADDRESS, tokenAddress];
        
        const poolAddress = await factory.methods.getPool(sortedTokens[0], sortedTokens[1], feeTier).call();
        
        if (poolAddress !== '0x0000000000000000000000000000000000000000') {
          const poolContract = new web3.eth.Contract(poolAbiV3, poolAddress);
          const slot0 = await poolContract.methods.slot0().call();
          
          debugLog(`Pool data - sqrtPriceX96: ${slot0.sqrtPriceX96}`, true);
          
          // Safely convert values to BN
          try {
            // Calculate price from sqrtPriceX96
            const sqrtPriceX96 = safeBN(slot0.sqrtPriceX96);
            const Q96 = web3.utils.toBN(2).pow(web3.utils.toBN(96));
            
            // Convert to price depending on token order
            let price;
            if (sortedTokens[0] === WBNB_ADDRESS) {
              // If BNB is token0, then price = 1 / (sqrtPriceX96^2 / 2^192)
              const sqrtPriceSquared = sqrtPriceX96.mul(sqrtPriceX96);
              if (sqrtPriceSquared.isZero()) {
                throw new Error('Price calculation failed: sqrtPriceSquared is zero');
              }
              price = Q96.mul(Q96).div(sqrtPriceSquared);
            } else {
              // If BNB is token1, then price = sqrtPriceX96^2 / 2^192
              price = sqrtPriceX96.mul(sqrtPriceX96).div(Q96.mul(Q96));
            }
            
            // Adjust for decimals
            const decimalAdjustment = web3.utils.toBN(10).pow(web3.utils.toBN(18 - tokenInfo.decimals));
            price = price.mul(decimalAdjustment);
            
            // Calculate rough output amount
            const inputAmount = safeBN(bnbAmountWei);
            const divisionFactor = safeBN(10).pow(safeBN(18));
            let roughOutputAmount;
            
            // Avoid division by zero
            if (divisionFactor.isZero()) {
              throw new Error('Division by zero error in price calculation');
            }
            
            roughOutputAmount = inputAmount.mul(price).div(divisionFactor);
            
            // Apply a safety factor (reduce by 10%) to account for fees and price impact
            roughOutputAmount = roughOutputAmount.mul(safeBN(90)).div(safeBN(100));
            
            expectedOutputAmount = roughOutputAmount.toString();
            debugLog(`Estimated output amount using pool data: ${expectedOutputAmount}`, true);
          } catch (calcError) {
            debugError('Error in price calculation:', calcError);
            // Use a fallback minimum value
            expectedOutputAmount = '1000';
            debugLog('Using minimum fallback value due to calculation error', true);
          }
        } else {
          throw new Error(`No pool exists for this token with the ${feeTier/10000}% fee tier. Try using the auto-select option instead.`);
        }
      } catch (fallbackError) {
        throw new Error(`Could not estimate price for ${feeTier/10000}% fee tier: ${fallbackError.message}`);
      }
    }
    
    // Calculate minimum output amount based on slippage
    const amountOutMin = web3.utils.toBN(expectedOutputAmount)
      .mul(web3.utils.toBN(10000 - slippagePercent * 100))
      .div(web3.utils.toBN(10000))
      .toString();
    
    debugLog(`Expected output: ${fromTokenUnits(expectedOutputAmount, tokenInfo.decimals)} ${tokenInfo.symbol}`, true);
    debugLog(`Minimum output (with ${slippagePercent}% slippage): ${fromTokenUnits(amountOutMin, tokenInfo.decimals)} ${tokenInfo.symbol}`, true);
    
    if (usedFallback) {
      debugLog('⚠️ Using estimated price due to quoter failure. Consider using higher slippage.', true);
    }
    
    // Get the next nonce
    const nonce = await getNextNonce(walletAddress);
    
    // Setup swap parameters
    const recipient = walletAddress;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    
    // Estimate gas
    const gasPrice = await web3.eth.getGasPrice();
    
    // Prepare transaction
    const swapParams = {
      path: path,
      recipient: recipient,
      deadline: deadline,
      amountIn: bnbAmountWei,
      amountOutMinimum: amountOutMin
    };
    
    const swapData = router.methods.exactInput(swapParams).encodeABI();
    const estimatedGas = await router.methods.exactInput(swapParams).estimateGas({
      from: walletAddress,
      value: bnbAmountWei
    }).catch(error => {
      debugError('Gas estimation failed:', error);
      // Default gas limit if estimation fails
      return 500000;
    });
    
    debugLog(`Gas estimate: ${estimatedGas}`);
    debugLog(`Gas price: ${web3.utils.fromWei(gasPrice, 'gwei')} gwei`);
    debugLog(`Swapping ${bnbAmount} BNB for ${tokenInfo.symbol} with ${slippagePercent}% slippage and ${feeTier/10000}% fee tier`, true);
    
    // Execute the swap
    const tx = await web3.eth.sendTransaction({
      from: walletAddress,
      to: PANCAKESWAP_ROUTER_ADDRESS,
      data: swapData,
      value: bnbAmountWei,
      gas: Math.floor(estimatedGas * 1.1), // Add 10% buffer
      gasPrice: gasPrice,
      nonce: nonce // Add the nonce
    });
    
    // Clean up wallet
    web3.eth.accounts.wallet.remove(walletAddress);
    
    debugLog(`Transaction successful! Hash: ${tx.transactionHash}`, true);
    return tx.transactionHash;
  } catch (error) {
    debugError('Error buying token with specific fee tier:', error);
    
    // Clean up wallet if exists
    try {
      const account = web3.eth.accounts.privateKeyToAccount(privateKey);
      web3.eth.accounts.wallet.remove(account.address);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    throw error;
  }
}

/**
 * Sell tokens for BNB with a specific fee tier
 * @param {string} privateKey - Private key of the account
 * @param {string} tokenAddress - Token address to sell
 * @param {string|number} tokenAmount - Amount of tokens to sell
 * @param {number} slippagePercent - Slippage tolerance in percentage
 * @param {number} [specificFeeTier] - Use a specific fee tier if provided
 * @returns {Promise<string>} Transaction hash
 */
async function sellTokenWithFeeTier(privateKey, tokenAddress, tokenAmount, slippagePercent = 1.0, specificFeeTier = FEE_TIERS.MEDIUM) {
  debugLog(`Using specific fee tier: ${specificFeeTier / 10000}%`, true);
  
  try {
    // Add account to wallet
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    web3.eth.accounts.wallet.add(account);
    const walletAddress = account.address;
    
    debugLog(`Using wallet address: ${walletAddress}`, true);
    
    // Get token info
    const tokenInfo = await getTokenInfo(tokenAddress);
    debugLog(`Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
    
    // Convert token amount to token units
    const tokenContract = new web3.eth.Contract(erc20Abi, tokenAddress);
    const tokenAmountInUnits = toTokenUnits(tokenAmount, tokenInfo.decimals);
    
    // Check token balance
    const tokenBalance = await tokenContract.methods.balanceOf(walletAddress).call();
    debugLog(`Token balance: ${fromTokenUnits(tokenBalance, tokenInfo.decimals)} ${tokenInfo.symbol}`);
    debugLog(`Attempting to sell: ${tokenAmount} ${tokenInfo.symbol}`);
    
    if (web3.utils.toBN(tokenBalance).lt(web3.utils.toBN(tokenAmountInUnits))) {
      throw new Error(`Insufficient token balance. You have ${fromTokenUnits(tokenBalance, tokenInfo.decimals)} ${tokenInfo.symbol} but trying to sell ${tokenAmount} ${tokenInfo.symbol}`);
    }
    
    // Use the specified fee tier instead of finding the best one
    const feeTier = specificFeeTier;
    
    // Validate if the pool has enough liquidity
    const isPoolValid = await validatePancakeV3Pool(tokenAddress, feeTier);
    if (!isPoolValid) {
      throw new Error(`No valid PancakeSwap V3 pool with ${feeTier/10000}% fee tier found. Try using the auto-select option instead.`);
    }
    
    // Encode path for swap (Token -> WBNB)
    const path = encodePath([tokenAddress, WBNB_ADDRESS], [feeTier]);
    
    // Get expected output amount
    let expectedOutputAmount = '0';
    let usedFallback = false;
    
    try {
      // Try using the quoter first
      const quoteResult = await quoter.methods.quoteExactInput(
        path,
        tokenAmountInUnits
      ).call();
      
      // Enhanced logging for debugging
      debugLog(`Raw quoter response: ${inspect(quoteResult)}`, true);
      
      // Extract the amountOut from the response
      if (typeof quoteResult === 'object' && quoteResult.amountOut) {
        expectedOutputAmount = quoteResult.amountOut.toString();
      } else if (typeof quoteResult === 'string' || typeof quoteResult === 'number') {
        expectedOutputAmount = quoteResult.toString();
      } else {
        throw new Error('Unexpected quoter response format');
      }
      
      debugLog(`Quoted output amount from PancakeSwap V3 Quoter: ${expectedOutputAmount}`);
    } catch (quoteError) {
      debugError('Failed to quote output amount using V3 Quoter:', quoteError);
      usedFallback = true;
      
      try {
        debugLog('Attempting to estimate price using pool data...', true);
        
        // Get pool data for manual price calculation
        const sortedTokens = web3.utils.toChecksumAddress(tokenAddress) < web3.utils.toChecksumAddress(WBNB_ADDRESS)
          ? [tokenAddress, WBNB_ADDRESS]
          : [WBNB_ADDRESS, tokenAddress];
        
        const poolAddress = await factory.methods.getPool(sortedTokens[0], sortedTokens[1], feeTier).call();
        
        if (poolAddress !== '0x0000000000000000000000000000000000000000') {
          const poolContract = new web3.eth.Contract(poolAbiV3, poolAddress);
          const slot0 = await poolContract.methods.slot0().call();
          
          debugLog(`Pool data - sqrtPriceX96: ${slot0.sqrtPriceX96}`, true);
          
          // Safely convert values to BN
          try {
            // Calculate price from sqrtPriceX96
            const sqrtPriceX96 = safeBN(slot0.sqrtPriceX96);
            const Q96 = web3.utils.toBN(2).pow(web3.utils.toBN(96));
            
            // Convert to price depending on token order
            let price;
            if (sortedTokens[0] === tokenAddress) {
              // If token is token0, then token price in BNB = 1 / (sqrtPriceX96^2 / 2^192)
              const sqrtPriceSquared = sqrtPriceX96.mul(sqrtPriceX96);
              if (sqrtPriceSquared.isZero()) {
                throw new Error('Price calculation failed: sqrtPriceSquared is zero');
              }
              price = Q96.mul(Q96).div(sqrtPriceSquared);
            } else {
              // If token is token1, then token price in BNB = sqrtPriceX96^2 / 2^192
              price = sqrtPriceX96.mul(sqrtPriceX96).div(Q96.mul(Q96));
            }
            
            // Adjust for decimals
            const decimalAdjustment = web3.utils.toBN(10).pow(web3.utils.toBN(tokenInfo.decimals - 18));
            price = price.mul(decimalAdjustment);
            
            // Calculate rough output amount
            const inputAmount = safeBN(tokenAmountInUnits);
            const divisionFactor = safeBN(10).pow(safeBN(tokenInfo.decimals));
            let roughOutputAmount;
            
            // Avoid division by zero
            if (divisionFactor.isZero()) {
              throw new Error('Division by zero error in price calculation');
            }
            
            roughOutputAmount = inputAmount.mul(price).div(divisionFactor);
            
            // Apply a safety factor (reduce by 10%) to account for fees and price impact
            roughOutputAmount = roughOutputAmount.mul(safeBN(90)).div(safeBN(100));
            
            expectedOutputAmount = roughOutputAmount.toString();
            debugLog(`Estimated output amount using pool data: ${expectedOutputAmount}`, true);
          } catch (calcError) {
            debugError('Error in price calculation:', calcError);
            // Use a fallback minimum value
            expectedOutputAmount = '1000';
            debugLog('Using minimum fallback value due to calculation error', true);
          }
        } else {
          throw new Error(`No pool exists for this token with the ${feeTier/10000}% fee tier. Try using the auto-select option instead.`);
        }
      } catch (fallbackError) {
        throw new Error(`Could not estimate price for ${feeTier/10000}% fee tier: ${fallbackError.message}`);
      }
    }
    
    // Calculate minimum output amount based on slippage
    const amountOutMin = web3.utils.toBN(expectedOutputAmount)
      .mul(web3.utils.toBN(10000 - slippagePercent * 100))
      .div(web3.utils.toBN(10000))
      .toString();
    
    debugLog(`Expected output: ${web3.utils.fromWei(expectedOutputAmount, 'ether')} BNB`, true);
    debugLog(`Minimum output (with ${slippagePercent}% slippage): ${web3.utils.fromWei(amountOutMin, 'ether')} BNB`, true);
    
    if (usedFallback) {
      debugLog('⚠️ Using estimated price due to quoter failure. Consider using higher slippage.', true);
    }
    
    // Get the next nonce for approval transaction
    let nonce = await getNextNonce(walletAddress);
    
    // Check if the token has any transfer restrictions
    try {
      // Check allowance
      const allowance = await tokenContract.methods.allowance(walletAddress, PANCAKESWAP_ROUTER_ADDRESS).call();
      
      // If allowance is less than the amount to sell, approve tokens
      if (web3.utils.toBN(allowance).lt(web3.utils.toBN(tokenAmountInUnits))) {
        debugLog('Approving tokens for PancakeSwap V3 router...', true);
        
        // Unlimited approval
        const approveAmount = web3.utils.toBN(2).pow(web3.utils.toBN(256)).sub(web3.utils.toBN(1)).toString();
        
        const approveTx = await tokenContract.methods.approve(PANCAKESWAP_ROUTER_ADDRESS, approveAmount).send({
          from: walletAddress,
          gas: 200000,
          gasPrice: await web3.eth.getGasPrice(),
          nonce: nonce // Add the nonce for approval
        });
        
        debugLog(`Token approval successful! Hash: ${approveTx.transactionHash}`);
        
        // Increment nonce for the next transaction
        nonce++;
      } else {
        debugLog('Token already approved for PancakeSwap V3 router');
      }
    } catch (error) {
      debugError('Token approval failed:', error);
      throw new Error(`Token approval failed: ${error.message}. This token may have transfer restrictions or be a honeypot.`);
    }
    
    // Setup swap parameters
    const recipient = walletAddress;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    
    // Estimate gas
    const gasPrice = await web3.eth.getGasPrice();
    
    // Prepare transaction
    const swapParams = {
      path: path,
      recipient: recipient,
      deadline: deadline,
      amountIn: tokenAmountInUnits,
      amountOutMinimum: amountOutMin
    };
    
    const swapData = router.methods.exactInput(swapParams).encodeABI();
    const estimatedGas = await router.methods.exactInput(swapParams).estimateGas({
      from: walletAddress
    }).catch(error => {
      debugError('Gas estimation failed:', error);
      // Default gas limit if estimation fails
      return 500000;
    });
    
    debugLog(`Gas estimate: ${estimatedGas}`);
    debugLog(`Gas price: ${web3.utils.fromWei(gasPrice, 'gwei')} gwei`);
    debugLog(`Swapping ${tokenAmount} ${tokenInfo.symbol} for BNB with ${slippagePercent}% slippage and ${feeTier/10000}% fee tier`, true);
    
    // Execute the swap with the current nonce (either incremented after approval or the original one)
    const tx = await web3.eth.sendTransaction({
      from: walletAddress,
      to: PANCAKESWAP_ROUTER_ADDRESS,
      data: swapData,
      gas: Math.floor(estimatedGas * 1.1), // Add 10% buffer
      gasPrice: gasPrice,
      nonce: nonce // Add the nonce
    });
    
    // Clean up wallet
    web3.eth.accounts.wallet.remove(walletAddress);
    
    debugLog(`Transaction successful! Hash: ${tx.transactionHash}`, true);
    return tx.transactionHash;
  } catch (error) {
    debugError('Error selling token with specific fee tier:', error);
    
    // Clean up wallet if exists
    try {
      const account = web3.eth.accounts.privateKeyToAccount(privateKey);
      web3.eth.accounts.wallet.remove(account.address);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    throw error;
  }
}

module.exports = {
  buyToken,
  sellToken,
  getTokenInfo,
  toTokenUnits,
  fromTokenUnits,
  findBestFeeTier,
  buyTokenWithFeeTier,
  sellTokenWithFeeTier
}; 