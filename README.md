# FourMeme PancakeSwap V3 Trader

A Web3.js based application to buy and sell FourMeme tokens on BSC (Binance Smart Chain) via PancakeSwap V3.

## Features

- Buy FourMeme tokens with BNB using PancakeSwap V3
- Sell FourMeme tokens for BNB using PancakeSwap V3
- Check token information and balances
- Set custom slippage tolerance
- Automatic best fee tier selection for optimal trading
- **Dedicated 0.25% fee tier trading option** for standard tokens
- Web-based interface for easy interaction

## Prerequisites

- Node.js (version 14 or higher)
- npm (Node Package Manager)
- A BSC wallet with private key
- BNB for gas fees and purchasing tokens

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd fourmeme-pancakeswap-trader
```

2. Install dependencies:
```bash
npm install
```

## Usage

1. Start the server:
```bash
npm start
```

2. Open your browser and navigate to:
```
http://localhost:3000
```

3. Use the web interface to:
   - Enter your token contract address
   - Provide your private key (this is kept in your browser and never stored)
   - Set the amount to buy/sell
   - Adjust slippage tolerance if needed (PancakeSwap V3 may require higher slippage for some tokens)
   - Click "Get Token Info" to view token details and balances
   - Choose between auto-selecting the best fee tier or using the fixed 0.25% fee tier
   - Use "Buy with BNB" or "Sell for BNB" buttons to execute trades

## Security Notice

- This application is for educational purposes only
- Never share your private key with others
- The private key is used only to sign transactions and is never stored on the server
- For maximum security, run this application locally
- Always verify token contracts before trading

## Development

To run the application in development mode with auto-restart:

```bash
npm run dev
```

## How It Works

The application uses Web3.js to interact with the Binance Smart Chain and PancakeSwap V3. Here's the flow:

1. User inputs token address, private key, and amount
2. The application connects to BSC via RPC
3. For buying: The app swaps BNB for the specified token using PancakeSwap V3's exactInput method
4. For selling: The app approves the router to spend tokens (if needed) and then swaps tokens for BNB using PancakeSwap V3
5. The application can either:
   - Automatically select the best fee tier (0.01%, 0.05%, 0.25%, or 1.00%) based on available liquidity
   - Use a fixed 0.25% fee tier (most common for standard tokens)
6. Transaction details are displayed to the user

## PancakeSwap V3 Fee Tiers

PancakeSwap V3 offers multiple fee tiers optimized for different trading scenarios:

| Fee Tier | Best For                                          | Example Pairs                 |
|----------|---------------------------------------------------|-------------------------------|
| 0.01%    | Extremely stable assets with minimal price impact | USDT-USDC stablecoin pairs    |
| 0.05%    | Stable assets with low volatility                 | BUSD-USDT, major stablecoins  |
| **0.25%**| **Moderately volatile assets (standard tokens)**  | **BNB-BUSD, established tokens**|
| 1.00%    | Highly volatile tokens, new tokens, meme tokens   | New listings, small caps      |

The **0.25% fee tier** is the most commonly used tier for standard tokens and offers a good balance between trading costs and price stability.

### When to Use 0.25% Fee Tier

- Trading established tokens with moderate volatility
- For tokens with stable trading pairs (like BNB with major tokens)
- For FourMeme tokens with good liquidity
- When you want to balance trading costs with slippage
- When auto-selection is not finding the best pool

## PancakeSwap V3 Benefits

- **Better Liquidity Concentration**: V3 uses concentrated liquidity, allowing liquidity providers to allocate capital more efficiently
- **Lower Slippage**: For tokens with good liquidity, V3 typically offers better prices and lower slippage
- **Multiple Fee Tiers**: Supports 0.01%, 0.05%, 0.25%, and 1% fee tiers, optimized for different volatility conditions
- **Lower Gas Costs**: Generally more gas-efficient than V2 for most transactions

## Troubleshooting PancakeSwap V3 Issues

### Enhanced Error Handling
This application includes several fallback mechanisms to handle common issues with PancakeSwap V3:

1. **Quoter Fallbacks**: If the V3 Quoter fails to provide price quotes, the application will:
   - First try to calculate prices manually using the pool's current state
   - Apply a safety buffer to ensure transactions don't fail due to price movements
   - Fall back to a minimum value as a last resort to allow the transaction to proceed

2. **Fee Tier Selection**: The application will:
   - Automatically find the best fee tier based on available liquidity
   - Try alternative fee tiers if the primary one has insufficient liquidity
   - Validate pools before attempting transactions to avoid common failures
   - Offer the option to manually use the 0.25% fee tier for standard tokens

3. **Detailed Error Messages**: The application provides specific error messages for common V3 issues:
   - Low liquidity warnings
   - Pool validation failures
   - Slippage-related errors
   - Fee tier-specific errors

### Recommended Actions for Common Errors

| Error | Possible Solution |
|-------|------------------|
| "Failed to quote output amount" | Try a smaller transaction amount or increase slippage |
| "No valid PancakeSwap V3 pool" | This token may not have sufficient V3 liquidity yet |
| "Price impact too high" | Reduce transaction amount or increase slippage tolerance |
| "Execution reverted" | Token may have trading restrictions or insufficient liquidity |
| "No valid pool with 0.25% fee tier" | Try the auto-select option instead of forcing 0.25% fee tier |

## License

MIT

## Disclaimer

Trading cryptocurrencies involves risk. This tool is provided "as is" without any warranties. Always do your own research before trading. 