import { LossCard, UserProfile, GlobalPoolToken } from '../types';
import {
  MIN_LOSS_PERCENTAGE,
  MAX_VOL_24H,
  MOCK_GLOBAL_POOL
} from '../constants';
import { PublicKey } from '@solana/web3.js';
import { apiService, MoralisSwap } from './apiService';

// Simulated delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Phantom wallet type declaration
interface PhantomWallet {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  isConnected: boolean;
  connect: () => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  on: (event: string, callback: () => void) => void;
  off: (event: string, callback: () => void) => void;
}

declare global {
  interface Window {
    solana?: PhantomWallet;
  }
}

export class SolanaService {
  private static instance: SolanaService;
  private isConnected: boolean = false;
  private currentWallet: string | null = null;
  private projectTokenBalance: number = 0;

  private constructor() {}

  public static getInstance(): SolanaService {
    if (!SolanaService.instance) {
      SolanaService.instance = new SolanaService();
    }
    return SolanaService.instance;
  }

  /**
   * Check if Phantom wallet is installed
   */
  isPhantomInstalled(): boolean {
    return typeof window !== 'undefined' && !!window.solana?.isPhantom;
  }

  /**
   * Get Phantom wallet provider
   */
  getPhantom(): PhantomWallet | null {
    if (typeof window !== 'undefined' && window.solana?.isPhantom) {
      return window.solana;
    }
    return null;
  }

  async connectWallet(): Promise<UserProfile> {
    console.log('connectWallet called');

    // Check if accessing via IP address (local network) - Phantom doesn't work with IPs
    // But allow loca.lt tunnel URLs (HTTPS)
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    const isLocalNetworkIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    const isTunnelUrl = hostname.endsWith('.loca.lt') || hostname.endsWith('.ngrok.io') || hostname.endsWith('.trycloudflare.com');

    if (isLocalNetworkIP && !isTunnelUrl) {
      throw new Error('Phantom wallet does not work over IP addresses. Please access via localhost:5173 or use the tunnel URL.');
    }

    const phantom = this.getPhantom();
    console.log('Phantom detected:', !!phantom, phantom);

    if (!phantom) {
      // Open Phantom download page if not installed
      console.log('No Phantom - opening download page');
      window.open('https://phantom.app/', '_blank');
      throw new Error('Phantom wallet not found. Please install Phantom wallet.');
    }

    try {
      // Request connection to Phantom
      console.log('Calling phantom.connect()...');
      const response = await phantom.connect();
      console.log('phantom.connect() response:', response);
      const walletAddress = response.publicKey.toString();

      this.isConnected = true;
      this.currentWallet = walletAddress;

      // For now, use mock balance (will be replaced with real token balance fetch later)
      this.projectTokenBalance = 1250000;

      return {
        walletAddress: walletAddress,
        balance: this.projectTokenBalance,
        tier: 'TIER_1', // Default tier for now
        totalLossesSubmitted: 0,
        totalWinnings: 0
      };
    } catch (error: any) {
      console.error('Phantom connection error:', error);
      throw new Error(error?.message || 'Failed to connect to Phantom wallet');
    }
  }

  /**
   * PHASE 1: WALLET ANALYSIS - REAL IMPLEMENTATION
   * 1. Fetch all swaps from last 90 days
   * 2. Aggregate by token (buys vs sells)
   * 3. Get current holdings
   * 4. Get current price & 24h volume from DexScreener
   * 5. Calculate loss percentage
   * 6. Filter by qualification criteria
   */
  async scanTrauma(): Promise<LossCard[]> {
    if (!this.isConnected || !this.currentWallet) {
      throw new Error("Wallet not connected");
    }

    console.log('Starting wallet scan for:', this.currentWallet);

    // Step 1: Fetch all swaps from last 90 days
    const swaps = await apiService.fetchAllSwaps(this.currentWallet);
    console.log(`Found ${swaps.length} swaps in last 90 days`);

    // Step 2: Fetch current token holdings
    const tokenBalances = await apiService.fetchTokenBalances(this.currentWallet);
    const holdingsMap = new Map<string, { amount: number; name: string; symbol: string }>();

    for (const balance of tokenBalances) {
      holdingsMap.set(balance.mint, {
        amount: parseFloat(balance.amount),
        name: balance.name,
        symbol: balance.symbol,
      });
    }
    console.log(`Found ${holdingsMap.size} tokens in wallet`);

    // Step 3: Aggregate swaps by token
    const tokenSwapData = this.aggregateSwapsByToken(swaps);
    console.log(`Aggregated ${tokenSwapData.size} unique tokens from swaps`);

    // Step 4: Get tokens that user still holds (from swap history)
    const tokensToAnalyze: string[] = [];

    for (const [tokenAddress, data] of tokenSwapData) {
      // Skip excluded tokens (stablecoins, wrapped SOL, etc.)
      if (apiService.isExcludedToken(tokenAddress)) continue;

      // Only analyze tokens user bought and still holds
      const holdings = holdingsMap.get(tokenAddress);
      if (holdings && holdings.amount > 0 && data.totalBoughtAmount > 0) {
        tokensToAnalyze.push(tokenAddress);
      }
    }
    console.log(`${tokensToAnalyze.length} tokens to analyze (held + bought in 90 days)`);

    // Step 5: Fetch current market data from DexScreener
    const marketData = await apiService.fetchMultipleTokenData(tokensToAnalyze);
    console.log(`Got market data for ${marketData.size} tokens`);

    // Step 6: Build loss cards
    const lossCards: LossCard[] = [];

    for (const tokenAddress of tokensToAnalyze) {
      const swapData = tokenSwapData.get(tokenAddress);
      const holdings = holdingsMap.get(tokenAddress);
      const dexData = marketData.get(tokenAddress);

      if (!swapData || !holdings) continue;

      // Calculate average entry price
      const avgEntryPrice = swapData.totalBoughtUsd / swapData.totalBoughtAmount;

      // Get current price from DexScreener
      const currentPrice = dexData ? parseFloat(dexData.priceUsd) : 0;
      const volume24h = dexData?.volume?.h24 || 0;

      // Calculate loss percentage
      let lossPercentage = 0;
      if (avgEntryPrice > 0 && currentPrice > 0) {
        lossPercentage = ((avgEntryPrice - currentPrice) / avgEntryPrice) * 100;
      } else if (avgEntryPrice > 0 && currentPrice === 0) {
        // Token is dead/rugged
        lossPercentage = 100;
      }

      // Calculate holdings value in USD
      const holdingsUsd = holdings.amount * currentPrice;

      // Calculate total loss amount in USD
      const lossAmount = (swapData.totalBoughtUsd - (holdings.amount * currentPrice));

      // Determine eligibility status
      let status: LossCard['status'] = 'ELIGIBLE';

      // CRITERIA 1: Must hold tokens
      if (holdings.amount <= 0) {
        status = 'INELIGIBLE';
      }
      // CRITERIA 2: Unrealized Loss >= 80%
      else if (lossPercentage < MIN_LOSS_PERCENTAGE) {
        status = 'INELIGIBLE';
      }
      // CRITERIA 3: 24h Volume < $5,000
      else if (volume24h > MAX_VOL_24H) {
        status = 'INELIGIBLE';
      }

      // Get token info
      const tokenName = dexData?.baseToken?.name || holdings.name || 'Unknown';
      const tokenSymbol = dexData?.baseToken?.symbol || holdings.symbol || '???';
      const tokenImage = dexData?.info?.imageUrl || undefined;

      // Only include tokens with actual losses (positive loss percentage)
      if (lossPercentage > 0) {
        lossCards.push({
          id: tokenAddress,
          tokenAddress,
          ticker: tokenSymbol,
          name: tokenName,
          lossAmount: Math.max(0, lossAmount),
          lossPercentage: Math.min(100, Math.max(0, lossPercentage)),
          date: swapData.lastBuyDate,
          txHash: swapData.lastBuyTxHash,
          status,
          imageUrl: tokenImage,
          entryPrice: avgEntryPrice,
          currentPrice,
          volume24h,
          holdings: holdings.amount,
          holdingsUsd,
          totalBought: swapData.totalBoughtAmount,
          totalSold: swapData.totalSoldAmount,
        });
      }
    }

    // Sort by loss percentage (highest first)
    lossCards.sort((a, b) => b.lossPercentage - a.lossPercentage);

    console.log(`Found ${lossCards.length} loss cards, ${lossCards.filter(c => c.status === 'ELIGIBLE').length} eligible`);

    return lossCards;
  }

  /**
   * Aggregate swaps by token address
   */
  private aggregateSwapsByToken(swaps: MoralisSwap[]): Map<string, {
    totalBoughtAmount: number;
    totalBoughtUsd: number;
    totalSoldAmount: number;
    totalSoldUsd: number;
    lastBuyDate: string;
    lastBuyTxHash: string;
  }> {
    const tokenData = new Map<string, {
      totalBoughtAmount: number;
      totalBoughtUsd: number;
      totalSoldAmount: number;
      totalSoldUsd: number;
      lastBuyDate: string;
      lastBuyTxHash: string;
    }>();

    for (const swap of swaps) {
      // When user BUYS a token, it appears in the "bought" field
      if (swap.transactionType === 'buy' && swap.bought) {
        const tokenAddress = swap.bought.address;
        const amount = parseFloat(swap.bought.amount) || 0;
        const usdAmount = swap.bought.usdAmount || 0;

        const existing = tokenData.get(tokenAddress) || {
          totalBoughtAmount: 0,
          totalBoughtUsd: 0,
          totalSoldAmount: 0,
          totalSoldUsd: 0,
          lastBuyDate: '',
          lastBuyTxHash: '',
        };

        existing.totalBoughtAmount += amount;
        existing.totalBoughtUsd += usdAmount;

        // Track most recent buy
        if (!existing.lastBuyDate || swap.blockTimestamp > existing.lastBuyDate) {
          existing.lastBuyDate = swap.blockTimestamp;
          existing.lastBuyTxHash = swap.transactionHash;
        }

        tokenData.set(tokenAddress, existing);
      }

      // When user SELLS a token, it appears in the "sold" field
      if (swap.transactionType === 'sell' && swap.sold) {
        const tokenAddress = swap.sold.address;
        const amount = parseFloat(swap.sold.amount) || 0;
        const usdAmount = swap.sold.usdAmount || 0;

        const existing = tokenData.get(tokenAddress) || {
          totalBoughtAmount: 0,
          totalBoughtUsd: 0,
          totalSoldAmount: 0,
          totalSoldUsd: 0,
          lastBuyDate: '',
          lastBuyTxHash: '',
        };

        existing.totalSoldAmount += amount;
        existing.totalSoldUsd += usdAmount;

        tokenData.set(tokenAddress, existing);
      }
    }

    return tokenData;
  }

  /**
   * Fetch Global Pool for Wheel Calculation
   * Returns list of tokens and how many users submitted them.
   */
  async getGlobalPoolStats(): Promise<GlobalPoolToken[]> {
    await delay(500);
    return MOCK_GLOBAL_POOL;
  }

  async enterLottery(lossCardId: string): Promise<boolean> {
    await delay(1500); // Simulate wallet signature and tx confirmation
    return true;
  }

  async disconnect(): Promise<void> {
    const phantom = this.getPhantom();

    if (phantom) {
      try {
        await phantom.disconnect();
      } catch (error) {
        console.error('Disconnect error:', error);
      }
    }

    this.isConnected = false;
    this.currentWallet = null;
    this.projectTokenBalance = 0;
  }

  /**
   * Get current wallet address
   */
  getWalletAddress(): string | null {
    return this.currentWallet;
  }

  /**
   * Check if wallet is connected
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }
}

export const solanaService = SolanaService.getInstance();