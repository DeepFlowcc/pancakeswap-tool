const express = require('express');
const path = require('path');
const Web3 = require('web3');
const bodyParser = require('body-parser');
const { erc20Abi } = require('./utils/abi');
const { BSC_RPC_URL, WBNB_ADDRESS, FEE_TIERS } = require('./utils/constants');
const { 
  buyToken, 
  sellToken, 
  getTokenInfo, 
  fromTokenUnits,
  buyTokenWithFeeTier,
  sellTokenWithFeeTier
} = require('./pancakeSwapWeb3');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Create Web3 instance
const web3 = new Web3(BSC_RPC_URL);

// API Routes
app.post('/api/token-info', async (req, res) => {
  try {
    const { tokenAddress, privateKey } = req.body;
    
    if (!tokenAddress || !privateKey) {
      return res.status(400).json({ error: 'Token address and private key are required' });
    }
    
    // Validate private key format
    if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
      return res.status(400).json({ error: 'Invalid private key format. Make sure it starts with 0x and has 64 characters after that.' });
    }
    
    // Generate account from private key
    const account = web3.eth.accounts.privateKeyToAccount(privateKey);
    
    // Get token info
    const tokenInfo = await getTokenInfo(tokenAddress).catch(error => {
      if (error.message.includes('Invalid token address')) {
        throw new Error('Invalid token address. Please enter a valid BEP-20 token contract address.');
      }
      throw error;
    });
    
    // Get BNB balance
    const bnbBalance = await web3.eth.getBalance(account.address);
    const bnbBalanceFormatted = web3.utils.fromWei(bnbBalance, 'ether');
    
    // Create token contract instance
    const tokenContract = new web3.eth.Contract(erc20Abi, tokenAddress);
    
    // Get token balance
    const tokenBalance = await tokenContract.methods.balanceOf(account.address).call();
    const tokenBalanceFormatted = fromTokenUnits(tokenBalance, tokenInfo.decimals);
    
    return res.json({
      address: tokenInfo.address,
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      tokenBalance: tokenBalanceFormatted,
      bnbBalance: bnbBalanceFormatted
    });
  } catch (error) {
    console.error('Error getting token info:', error);
    return res.status(500).json({ error: error.message || 'Error retrieving token information' });
  }
});

app.post('/api/buy-token', async (req, res) => {
  try {
    const { tokenAddress, privateKey, amount, slippage } = req.body;
    
    if (!tokenAddress || !privateKey || !amount) {
      return res.status(400).json({ error: 'Token address, private key, and amount are required' });
    }
    
    // Validate amount is a positive number
    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    
    // Validate slippage is within reasonable range
    const slippageValue = parseFloat(slippage) || 1.0; // Increased default for V3
    if (slippageValue < 0.1 || slippageValue > 100) {
      return res.status(400).json({ error: 'Slippage must be between 0.1% and 100%' });
    }
    
    // Execute buy transaction
    const txHash = await buyToken(privateKey, tokenAddress, amount, slippageValue);
    
    return res.json({ 
      success: true,
      txHash,
      message: `Successfully bought tokens. Transaction hash: ${txHash}` 
    });
  } catch (error) {
    console.error('Error buying token:', error);
    
    // Extract the most user-friendly error message
    let errorMessage = 'Error buying tokens';
    
    if (error.message.includes('Transaction reverted:')) {
      errorMessage = error.message;
    } else if (error.message.includes('Insufficient BNB balance')) {
      errorMessage = error.message;
    } else if (error.message.includes('No liquidity pool exists')) {
      errorMessage = error.message;
    } else if (error.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
      errorMessage = 'Transaction failed: Price impact too high. Try increasing slippage tolerance.';
    } else if (error.message.includes('Price impact too high')) {
      errorMessage = error.message;
    } else if (error.message.includes('honeypot')) {
      errorMessage = error.message;
    } else if (error.message.includes('execution reverted')) {
      errorMessage = 'Transaction failed: The token contract reverted the transaction. This may be due to trading restrictions, insufficient liquidity, or other contract limitations.';
    } else if (error.message.includes('Failed to quote output amount')) {
      errorMessage = 'Failed to quote output amount: The V3 quoter could not calculate an exact price. This may be due to low liquidity or price impact. Try a smaller amount or higher slippage.';
    } else if (error.message.includes('no route found')) {
      errorMessage = 'No trading route found: There may not be enough liquidity in PancakeSwap V3 pools for this token pair.';
    } else if (error.message.includes('Too little received')) {
      errorMessage = 'Slippage error: Price moved unfavorably during transaction. Try increasing slippage tolerance.';
    } else if (error.message.includes('Too much requested')) {
      errorMessage = 'Slippage error: Price moved unfavorably during transaction. Try increasing slippage tolerance.';
    }
    
    return res.status(500).json({ 
      error: errorMessage,
      details: error.message
    });
  }
});

app.post('/api/sell-token', async (req, res) => {
  try {
    const { tokenAddress, privateKey, amount, slippage } = req.body;
    
    if (!tokenAddress || !privateKey || !amount) {
      return res.status(400).json({ error: 'Token address, private key, and amount are required' });
    }
    
    // Validate amount is a positive number
    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    
    // Validate slippage is within reasonable range
    const slippageValue = parseFloat(slippage) || 1.0; // Increased default for V3
    if (slippageValue < 0.1 || slippageValue > 100) {
      return res.status(400).json({ error: 'Slippage must be between 0.1% and 100%' });
    }
    
    // Execute sell transaction
    const txHash = await sellToken(privateKey, tokenAddress, amount, slippageValue);
    
    return res.json({ 
      success: true,
      txHash,
      message: `Successfully sold tokens. Transaction hash: ${txHash}` 
    });
  } catch (error) {
    console.error('Error selling token:', error);
    
    // Extract the most user-friendly error message
    let errorMessage = 'Error selling tokens';
    
    if (error.message.includes('Transaction reverted:')) {
      errorMessage = error.message;
    } else if (error.message.includes('Insufficient token balance')) {
      errorMessage = error.message;
    } else if (error.message.includes('No liquidity pool exists')) {
      errorMessage = error.message;
    } else if (error.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
      errorMessage = 'Transaction failed: Price impact too high. Try increasing slippage tolerance.';
    } else if (error.message.includes('Price impact too high')) {
      errorMessage = error.message;
    } else if (error.message.includes('honeypot')) {
      errorMessage = 'Token may be a honeypot (has trading restrictions). Unable to sell.';
    } else if (error.message.includes('Token approval failed')) {
      errorMessage = 'Token approval failed. This token may have transfer restrictions or be a honeypot.';
    } else if (error.message.includes('execution reverted')) {
      errorMessage = 'Transaction failed: The token contract reverted the transaction. This may be due to selling restrictions, insufficient liquidity, or other contract limitations.';
    } else if (error.message.includes('Failed to quote output amount')) {
      errorMessage = 'Failed to quote output amount: The V3 quoter could not calculate an exact price. This may be due to low liquidity or price impact. Try a smaller amount or higher slippage.';
    } else if (error.message.includes('no route found')) {
      errorMessage = 'No trading route found: There may not be enough liquidity in PancakeSwap V3 pools for this token pair.';
    } else if (error.message.includes('Too little received')) {
      errorMessage = 'Slippage error: Price moved unfavorably during transaction. Try increasing slippage tolerance.';
    } else if (error.message.includes('Too much requested')) {
      errorMessage = 'Slippage error: Price moved unfavorably during transaction. Try increasing slippage tolerance.';
    }
    
    return res.status(500).json({ 
      error: errorMessage,
      details: error.message
    });
  }
});

// New routes for trading with specific 0.25% fee tier
app.post('/api/buy-token-medium-fee', async (req, res) => {
  try {
    const { tokenAddress, privateKey, amount, slippage } = req.body;
    
    if (!tokenAddress || !privateKey || !amount) {
      return res.status(400).json({ error: 'Token address, private key, and amount are required' });
    }
    
    // Validate amount is a positive number
    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    
    // Validate slippage is within reasonable range
    const slippageValue = parseFloat(slippage) || 1.0;
    if (slippageValue < 0.1 || slippageValue > 100) {
      return res.status(400).json({ error: 'Slippage must be between 0.1% and 100%' });
    }
    
    // Execute buy transaction with medium (0.25%) fee tier
    const txHash = await buyTokenWithFeeTier(privateKey, tokenAddress, amount, slippageValue, FEE_TIERS.MEDIUM);
    
    return res.json({ 
      success: true,
      txHash,
      message: `Successfully bought tokens with 0.25% fee tier. Transaction hash: ${txHash}` 
    });
  } catch (error) {
    console.error('Error buying token with 0.25% fee tier:', error);
    
    // Extract the most user-friendly error message
    let errorMessage = 'Error buying tokens';
    
    if (error.message.includes('Transaction reverted:')) {
      errorMessage = error.message;
    } else if (error.message.includes('Insufficient BNB balance')) {
      errorMessage = error.message;
    } else if (error.message.includes('No valid PancakeSwap V3 pool with 0.25% fee tier')) {
      errorMessage = error.message;
    } else if (error.message.includes('No pool exists for this token with the 0.25% fee tier')) {
      errorMessage = error.message;
    } else if (error.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
      errorMessage = 'Transaction failed: Price impact too high. Try increasing slippage tolerance.';
    } else if (error.message.includes('honeypot')) {
      errorMessage = error.message;
    } else if (error.message.includes('Could not estimate price for 0.25% fee tier')) {
      errorMessage = error.message;
    }
    
    return res.status(500).json({ 
      error: errorMessage,
      details: error.message
    });
  }
});

app.post('/api/sell-token-medium-fee', async (req, res) => {
  try {
    const { tokenAddress, privateKey, amount, slippage } = req.body;
    
    if (!tokenAddress || !privateKey || !amount) {
      return res.status(400).json({ error: 'Token address, private key, and amount are required' });
    }
    
    // Validate amount is a positive number
    const amountFloat = parseFloat(amount);
    if (isNaN(amountFloat) || amountFloat <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    
    // Validate slippage is within reasonable range
    const slippageValue = parseFloat(slippage) || 1.0;
    if (slippageValue < 0.1 || slippageValue > 100) {
      return res.status(400).json({ error: 'Slippage must be between 0.1% and 100%' });
    }
    
    // Execute sell transaction with medium (0.25%) fee tier
    const txHash = await sellTokenWithFeeTier(privateKey, tokenAddress, amount, slippageValue, FEE_TIERS.MEDIUM);
    
    return res.json({ 
      success: true,
      txHash,
      message: `Successfully sold tokens with 0.25% fee tier. Transaction hash: ${txHash}` 
    });
  } catch (error) {
    console.error('Error selling token with 0.25% fee tier:', error);
    
    // Extract the most user-friendly error message
    let errorMessage = 'Error selling tokens';
    
    if (error.message.includes('Transaction reverted:')) {
      errorMessage = error.message;
    } else if (error.message.includes('Insufficient token balance')) {
      errorMessage = error.message;
    } else if (error.message.includes('No valid PancakeSwap V3 pool with 0.25% fee tier')) {
      errorMessage = error.message;
    } else if (error.message.includes('No pool exists for this token with the 0.25% fee tier')) {
      errorMessage = error.message;
    } else if (error.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
      errorMessage = 'Transaction failed: Price impact too high. Try increasing slippage tolerance.';
    } else if (error.message.includes('Token approval failed')) {
      errorMessage = 'Token approval failed. This token may have transfer restrictions or be a honeypot.';
    } else if (error.message.includes('Could not estimate price for 0.25% fee tier')) {
      errorMessage = error.message;
    }
    
    return res.status(500).json({ 
      error: errorMessage,
      details: error.message
    });
  }
});

// Serve the HTML file for any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
}); 