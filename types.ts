export interface UserProfile {
  walletAddress: string;
  balance: number; // Project token balance
  tier: 'TIER_1' | 'TIER_2' | 'NONE';
  totalLossesSubmitted: number;
  totalWinnings: number;
}

export interface LossCard {
  id: string;
  tokenAddress: string; // Token mint address
  ticker: string;
  name: string;
  lossAmount: number; // In USD
  lossPercentage: number; // Loss percentage (0-100)
  date: string;
  txHash: string;
  status: 'ELIGIBLE' | 'USED' | 'INELIGIBLE';
  imageUrl?: string;
  // Analytics Fields
  entryPrice: number; // Average entry price in USD
  currentPrice: number; // Current price in USD
  volume24h: number; // 24h volume in USD
  holdings: number; // Token amount user holds
  holdingsUsd: number; // Holdings value in USD
  totalBought: number; // Total tokens bought
  totalSold: number; // Total tokens sold
}

export interface GlobalPoolToken {
  ticker: string;
  subCount: number;
  color: string;
}

export interface RoundEntry {
  id: string;
  walletAddress: string;
  lossTicker: string;
  lossAmount: number;
  timestamp: number;
  heldAmount: number; // Tokens held by user
  color: string; // Token color for display
}

export interface RoundHistory {
  id: number;
  winningToken: string;
  totalPayout: number;
  winnerCount: number;
  txHash: string;
  timestamp: string;
}

export enum AppRoute {
  LANDING = '/',
  DASHBOARD = '/dashboard',
  PORTFOLIO = '/portfolio',
  LEADERBOARD = '/leaderboard',
  TRANSPARENCY = '/transparency',
  ADMIN = '/admin'
}