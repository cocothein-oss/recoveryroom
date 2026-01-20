import { LossCard, RoundHistory, RoundEntry } from './types';

// ============================================================
// TOKEN ELIGIBILITY CONFIG - Easy to control conditions
// ============================================================
export const TOKEN_ELIGIBILITY_CONFIG = {
  // Minimum loss percentage required (0-100)
  // Token must have lost at least this % from entry price
  minLossPercentage: 80,

  // Maximum 24h trading volume in USD
  // Prevents gaming with actively traded tokens
  maxVolume24h: 2000,

  // User must still hold tokens (cannot have sold all)
  // If true, user must hold > 0 tokens
  requireHoldings: true,

  // Minimum USD value of holdings
  // Set to 0 to disable
  minHoldingsUsd: 0,

  // Maximum number of tokens user can submit per round
  maxTokensPerRound: 3,

  // Exclude tokens with zero total bought (airdrops/dusts)
  requirePurchaseHistory: true,
};

// Legacy exports for backwards compatibility
export const MIN_PROJECT_TOKENS = 1000000; // 1M Tokens required to access
export const MIN_LOSS_PERCENTAGE = TOKEN_ELIGIBILITY_CONFIG.minLossPercentage;
export const MAX_VOL_24H = TOKEN_ELIGIBILITY_CONFIG.maxVolume24h;

// Mock Data representing the Global Pool for SQRT weighting
// LUNA: 16 subs -> sqrt(16) = 4 weight
// FTT: 9 subs -> sqrt(9) = 3 weight
// SLERF: 4 subs -> sqrt(4) = 2 weight
export const MOCK_GLOBAL_POOL = [
  { ticker: 'LUNA', subCount: 16, color: '#ef4444' },
  { ticker: 'FTT', subCount: 9, color: '#f59e0b' },
  { ticker: 'SLERF', subCount: 4, color: '#10b981' },
  { ticker: 'JEJ', subCount: 1, color: '#3b82f6' }, // The user's potential entry
];

export const MOCK_LOSS_HISTORY: LossCard[] = [
  {
    id: '1',
    tokenAddress: 'mock-luna-address',
    ticker: 'LUNA',
    name: 'Terra Luna',
    lossAmount: 4500.23,
    lossPercentage: 99.99,
    date: '2022-05-12',
    txHash: '5x...9a',
    status: 'ELIGIBLE',
    entryPrice: 80.00,
    currentPrice: 0.0001,
    volume24h: 1200,
    holdings: 50000,
    holdingsUsd: 5,
    totalBought: 60000,
    totalSold: 10000,
  },
  {
    id: '2',
    tokenAddress: 'mock-ftt-address',
    ticker: 'FTT',
    name: 'FTX Token',
    lossAmount: 1200.50,
    lossPercentage: 94.5,
    date: '2022-11-08',
    txHash: '2z...3k',
    status: 'ELIGIBLE',
    entryPrice: 22.00,
    currentPrice: 1.20,
    volume24h: 4000,
    holdings: 100,
    holdingsUsd: 120,
    totalBought: 150,
    totalSold: 50,
  },
  {
    id: '3',
    tokenAddress: 'mock-slerf-address',
    ticker: 'SLERF',
    name: 'Slerf',
    lossAmount: 320.00,
    lossPercentage: 66.67,
    date: '2024-03-18',
    txHash: '8p...1m',
    status: 'USED',
    entryPrice: 0.90,
    currentPrice: 0.30,
    volume24h: 400000, // Too high volume
    holdings: 0,
    holdingsUsd: 0,
    totalBought: 1000,
    totalSold: 1000,
  },
  {
    id: '4',
    tokenAddress: 'mock-wif-address',
    ticker: 'WIF',
    name: 'dogwifhat',
    lossAmount: 50.00,
    lossPercentage: 10.0,
    date: '2024-01-10',
    txHash: '9q...2b',
    status: 'INELIGIBLE', // < 80% loss
    entryPrice: 2.00,
    currentPrice: 1.80,
    volume24h: 15000000,
    holdings: 50,
    holdingsUsd: 90,
    totalBought: 100,
    totalSold: 50,
  },
  {
    id: '5',
    tokenAddress: 'mock-ruggg-address',
    ticker: 'RUGGG',
    name: 'RugPull Coin',
    lossAmount: 850.75,
    lossPercentage: 99.998,
    date: '2023-12-25',
    txHash: '4j...9x',
    status: 'ELIGIBLE',
    entryPrice: 0.05,
    currentPrice: 0.000001,
    volume24h: 150, // Dead coin
    holdings: 2000000,
    holdingsUsd: 2,
    totalBought: 3000000,
    totalSold: 1000000,
  },
];

export const MOCK_RECENT_WINNERS = [
  { user: '8x...92a', amount: 400, token: 'SLERF' },
  { user: '2b...11z', amount: 1250, token: 'LUNA' },
  { user: '9q...88x', amount: 330, token: 'BONK' },
];

export const MOCK_LIVE_FEED: RoundEntry[] = [
  { id: 'e1', walletAddress: 'Hv3...9aX', lossTicker: 'JEJ', lossAmount: 120, timestamp: Date.now(), heldAmount: 500000, color: 'hsl(280, 70%, 50%)' },
  { id: 'e2', walletAddress: '2kA...kL9', lossTicker: 'LUNA', lossAmount: 5000, timestamp: Date.now() - 5000, heldAmount: 12400, color: 'hsl(45, 80%, 55%)' },
  { id: 'e3', walletAddress: '9pX...m22', lossTicker: 'SLERF', lossAmount: 230, timestamp: Date.now() - 12000, heldAmount: 3300, color: 'hsl(160, 65%, 45%)' },
  { id: 'e4', walletAddress: '4bZ...x99', lossTicker: 'FTT', lossAmount: 1500, timestamp: Date.now() - 45000, heldAmount: 200, color: 'hsl(200, 75%, 50%)' },
];

export const MOCK_ROUND_HISTORY: RoundHistory[] = [
  { id: 1042, winningToken: 'LUNA', totalPayout: 15400, winnerCount: 12, txHash: '4x...aa', timestamp: '2024-05-20 14:00' },
  { id: 1041, winningToken: 'BOME', totalPayout: 3200, winnerCount: 4, txHash: '3b...bb', timestamp: '2024-05-20 13:00' },
  { id: 1040, winningToken: 'SLERF', totalPayout: 850, winnerCount: 2, txHash: '9c...cc', timestamp: '2024-05-20 12:00' },
];