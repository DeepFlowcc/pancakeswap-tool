// BSC Network Configuration
exports.BSC_RPC_URL = 'https://bsc-dataseed2.ninicoin.io/';
exports.BSC_CHAIN_ID = 56;

// PancakeSwap V3 Contract Addresses on BSC
exports.PANCAKESWAP_ROUTER_ADDRESS = '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4'; // PancakeSwap V3 SmartRouter
exports.PANCAKESWAP_FACTORY_ADDRESS = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'; // PancakeSwap V3 Factory
exports.PANCAKESWAP_QUOTER_ADDRESS = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997'; // PancakeSwap V3 Quoter

// Token Addresses
exports.WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'; // Wrapped BNB
exports.BNB_TOKEN_INFO = {
  symbol: 'BNB',
  name: 'Binance Coin',
  decimals: 18
};

// Slippage and Deadline
exports.DEFAULT_SLIPPAGE = 0.5; // 0.5% slippage tolerance
exports.DEFAULT_DEADLINE_MINUTES = 20; // 20 minutes
exports.MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935'; // 2^256 - 1

// Gas configuration
exports.GAS_MULTIPLIER = 1.2; // Add 20% to estimated gas

// PancakeSwap V3 Fee Tiers - in hundredths of a bip (0.0001%)
exports.FEE_TIERS = {
  LOWEST: 100,   // 0.01%
  LOW: 500,      // 0.05%
  MEDIUM: 2500,  // 0.25%
  HIGH: 10000    // 1%
}; 