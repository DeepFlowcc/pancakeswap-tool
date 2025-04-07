document.addEventListener('DOMContentLoaded', function() {
  const tokenAddressInput = document.getElementById('token-address');
  const privateKeyInput = document.getElementById('private-key');
  const amountInput = document.getElementById('amount');
  const slippageInput = document.getElementById('slippage');
  
  const getInfoBtn = document.getElementById('get-info-btn');
  const buyBtn = document.getElementById('buy-btn');
  const sellBtn = document.getElementById('sell-btn');
  const buyMediumFeeBtn = document.getElementById('buy-medium-fee-btn');
  const sellMediumFeeBtn = document.getElementById('sell-medium-fee-btn');
  
  const tokenInfoSection = document.getElementById('token-info');
  const tokenNameEl = document.getElementById('token-name');
  const tokenSymbolEl = document.getElementById('token-symbol');
  const tokenDecimalsEl = document.getElementById('token-decimals');
  const tokenBalanceEl = document.getElementById('token-balance');
  const bnbBalanceEl = document.getElementById('bnb-balance');
  
  const resultArea = document.getElementById('result-area');
  
  const infoLoader = document.getElementById('info-loader');
  const buyLoader = document.getElementById('buy-loader');
  const sellLoader = document.getElementById('sell-loader');
  const buyMediumLoader = document.getElementById('buy-medium-loader');
  const sellMediumLoader = document.getElementById('sell-medium-loader');
  
  // Show loader
  function showLoader(loader) {
    loader.style.display = 'inline-block';
  }
  
  // Hide loader
  function hideLoader(loader) {
    loader.style.display = 'none';
  }
  
  // Show result message
  function showResult(message, isError = false, details = null) {
    resultArea.innerHTML = message;
    resultArea.style.display = 'block';
    resultArea.className = isError ? 'alert alert-danger mt-3' : 'alert alert-success mt-3';
    
    // Add details in smaller text if available
    if (details && details !== message) {
      const detailsElement = document.createElement('div');
      detailsElement.className = 'mt-2 small';
      detailsElement.textContent = details;
      resultArea.appendChild(detailsElement);
    }
    
    // Hide after 10 seconds for errors, 5 seconds for success
    setTimeout(() => {
      resultArea.style.display = 'none';
    }, isError ? 10000 : 5000);
  }
  
  // Validate inputs
  function validateInputs(checkAmount = true) {
    const tokenAddress = tokenAddressInput.value.trim();
    const privateKey = privateKeyInput.value.trim();
    const amount = amountInput.value.trim();
    
    if (!tokenAddress) {
      showResult('Please enter a token address', true);
      return false;
    }
    
    if (!privateKey) {
      showResult('Please enter your private key', true);
      return false;
    }
    
    if (checkAmount && !amount) {
      showResult('Please enter an amount', true);
      return false;
    }
    
    return true;
  }
  
  // Get token information
  getInfoBtn.addEventListener('click', async function() {
    if (!validateInputs(false)) return;
    
    const tokenAddress = tokenAddressInput.value.trim();
    const privateKey = privateKeyInput.value.trim();
    
    showLoader(infoLoader);
    
    try {
      const response = await fetch('/api/token-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tokenAddress,
          privateKey
        })
      });
      
      const data = await response.json();
      
      if (data.error) {
        showResult(data.error, true);
      } else {
        // Display token info
        tokenNameEl.textContent = data.name;
        tokenSymbolEl.textContent = data.symbol;
        tokenDecimalsEl.textContent = data.decimals;
        tokenBalanceEl.textContent = `${data.tokenBalance} ${data.symbol}`;
        bnbBalanceEl.textContent = `${data.bnbBalance} BNB`;
        
        tokenInfoSection.style.display = 'block';
        showResult('Token information retrieved successfully');
      }
    } catch (error) {
      showResult('Error retrieving token information: ' + error.message, true);
    } finally {
      hideLoader(infoLoader);
    }
  });
  
  // Buy tokens
  buyBtn.addEventListener('click', async function() {
    if (!validateInputs(true)) return;
    
    const tokenAddress = tokenAddressInput.value.trim();
    const privateKey = privateKeyInput.value.trim();
    const amount = amountInput.value.trim();
    const slippage = slippageInput.value.trim();
    
    showLoader(buyLoader);
    
    try {
      const response = await fetch('/api/buy-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tokenAddress,
          privateKey,
          amount,
          slippage
        })
      });
      
      const data = await response.json();
      
      if (data.error) {
        showResult(data.error, true, data.details);
      } else {
        showResult(`Transaction successful! Tx hash: ${data.txHash}`);
        
        // Update token info after successful transaction
        setTimeout(() => {
          getInfoBtn.click();
        }, 5000); // Wait 5 seconds for transaction to be processed
      }
    } catch (error) {
      showResult('Error buying tokens: ' + error.message, true);
    } finally {
      hideLoader(buyLoader);
    }
  });
  
  // Sell tokens
  sellBtn.addEventListener('click', async function() {
    if (!validateInputs(true)) return;
    
    const tokenAddress = tokenAddressInput.value.trim();
    const privateKey = privateKeyInput.value.trim();
    const amount = amountInput.value.trim();
    const slippage = slippageInput.value.trim();
    
    showLoader(sellLoader);
    
    try {
      const response = await fetch('/api/sell-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tokenAddress,
          privateKey,
          amount,
          slippage
        })
      });
      
      const data = await response.json();
      
      if (data.error) {
        showResult(data.error, true, data.details);
      } else {
        showResult(`Transaction successful! Tx hash: ${data.txHash}`);
        
        // Update token info after successful transaction
        setTimeout(() => {
          getInfoBtn.click();
        }, 5000); // Wait 5 seconds for transaction to be processed
      }
    } catch (error) {
      showResult('Error selling tokens: ' + error.message, true);
    } finally {
      hideLoader(sellLoader);
    }
  });
  
  // Buy tokens with 0.25% fee tier
  buyMediumFeeBtn.addEventListener('click', async function() {
    if (!validateInputs(true)) return;
    
    const tokenAddress = tokenAddressInput.value.trim();
    const privateKey = privateKeyInput.value.trim();
    const amount = amountInput.value.trim();
    const slippage = slippageInput.value.trim();
    
    showLoader(buyMediumLoader);
    
    try {
      const response = await fetch('/api/buy-token-medium-fee', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tokenAddress,
          privateKey,
          amount,
          slippage
        })
      });
      
      const data = await response.json();
      
      if (data.error) {
        showResult(data.error, true, data.details);
      } else {
        showResult(`Transaction successful with 0.25% fee tier! Tx hash: ${data.txHash}`);
        
        // Update token info after successful transaction
        setTimeout(() => {
          getInfoBtn.click();
        }, 5000); // Wait 5 seconds for transaction to be processed
      }
    } catch (error) {
      showResult('Error buying tokens with 0.25% fee tier: ' + error.message, true);
    } finally {
      hideLoader(buyMediumLoader);
    }
  });
  
  // Sell tokens with 0.25% fee tier
  sellMediumFeeBtn.addEventListener('click', async function() {
    if (!validateInputs(true)) return;
    
    const tokenAddress = tokenAddressInput.value.trim();
    const privateKey = privateKeyInput.value.trim();
    const amount = amountInput.value.trim();
    const slippage = slippageInput.value.trim();
    
    showLoader(sellMediumLoader);
    
    try {
      const response = await fetch('/api/sell-token-medium-fee', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tokenAddress,
          privateKey,
          amount,
          slippage
        })
      });
      
      const data = await response.json();
      
      if (data.error) {
        showResult(data.error, true, data.details);
      } else {
        showResult(`Transaction successful with 0.25% fee tier! Tx hash: ${data.txHash}`);
        
        // Update token info after successful transaction
        setTimeout(() => {
          getInfoBtn.click();
        }, 5000); // Wait 5 seconds for transaction to be processed
      }
    } catch (error) {
      showResult('Error selling tokens with 0.25% fee tier: ' + error.message, true);
    } finally {
      hideLoader(sellMediumLoader);
    }
  });
}); 