/**
 * Data Service for Recovery Room
 * Communicates with backend API for data persistence
 */

// Dynamic API base - handles local dev and tunnel URLs
const getApiBase = () => {
  if (typeof window === 'undefined') return 'http://localhost:6002/api';

  const hostname = window.location.hostname;

  // If using Cloudflare tunnel (trycloudflare.com), use the backend tunnel
  if (hostname.endsWith('.trycloudflare.com')) {
    return 'https://suite-five-quantity-unix.trycloudflare.com/api';
  }

  // If using localtunnel (loca.lt), use the backend tunnel
  if (hostname.endsWith('.loca.lt')) {
    return 'https://recoveryroom-api.loca.lt/api';
  }

  // Local development
  return `http://${hostname}:6002/api`;
};

const API_BASE = getApiBase();

export interface StoredTokenData {
  tokenAddress: string;
  ticker: string;
  name: string;
  imageUrl?: string;
  totalBought: number;
  totalSold: number;
  totalBuyCostSol: number;
  totalBuyCostStable: number;
  totalSellRevenueSol: number;
  totalSellRevenueStable: number;
  firstBuyTime: number;
  lastBuyTime: number;
}

export interface StoredLiveEntry {
  id: string;
  walletAddress: string;
  lossTicker: string;
  tokenAddress: string;
  lossAmount: number;
  timestamp: number;
  heldAmount: number;
  color: string;
}

export interface StoredPoolToken {
  ticker: string;
  tokenAddress: string;
  subCount: number;
  color: string;
}

export interface RoundInfo {
  roundId: number;
  startTime: number;
  endTime: number;
  timeRemaining: number;
}

export interface ParticipationToken {
  id: string;
  ticker: string;
  tokenAddress: string;
  lossAmount: number;
  holdings: number;
  color: string;
}

class DataService {
  private static instance: DataService;
  private roundCache: RoundInfo | null = null;
  private lastRoundFetch: number = 0;

  private constructor() {}

  public static getInstance(): DataService {
    if (!DataService.instance) {
      DataService.instance = new DataService();
    }
    return DataService.instance;
  }

  /**
   * Make API request
   */
  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'API request failed');
    }

    return data;
  }

  // ============ Round Operations ============

  /**
   * Get current round info (cached for 1 second)
   */
  async getCurrentRound(): Promise<RoundInfo> {
    const now = Date.now();
    if (this.roundCache && now - this.lastRoundFetch < 1000) {
      return this.roundCache;
    }

    try {
      const response = await this.fetch<{ success: boolean; data: RoundInfo }>('/round');
      this.roundCache = response.data;
      this.lastRoundFetch = now;
      return response.data;
    } catch (error) {
      console.error('Error fetching round:', error);
      // Return fallback round info
      const hourStart = Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000);
      return {
        roundId: Math.floor(hourStart / (60 * 60 * 1000)),
        startTime: hourStart,
        endTime: hourStart + 60 * 60 * 1000,
        timeRemaining: Math.floor((hourStart + 60 * 60 * 1000 - now) / 1000),
      };
    }
  }

  /**
   * Get time remaining in current round (seconds)
   */
  async getTimeRemaining(): Promise<number> {
    const round = await this.getCurrentRound();
    return round.timeRemaining;
  }

  /**
   * Synchronous time remaining (uses cache)
   */
  getTimeRemainingSync(): number {
    if (this.roundCache) {
      const remaining = Math.max(0, this.roundCache.endTime - Date.now());
      return Math.floor(remaining / 1000);
    }
    // Fallback calculation
    const now = Date.now();
    const hourStart = Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000);
    const remaining = Math.max(0, hourStart + 60 * 60 * 1000 - now);
    return Math.floor(remaining / 1000);
  }

  // ============ User Cache Operations ============

  /**
   * Get user's cached wallet analysis
   */
  async getUserCache(walletAddress: string): Promise<{ tokens: StoredTokenData[]; swapCount: number; lastAnalyzedAt: number; noValidTokens: boolean } | null> {
    try {
      const response = await this.fetch<{ success: boolean; data: { cache: any } }>(`/user/${walletAddress}`);
      return response.data.cache;
    } catch (error) {
      console.error('Error fetching user cache:', error);
      return null;
    }
  }

  /**
   * Save user's wallet analysis cache
   */
  async saveUserCache(walletAddress: string, tokens: StoredTokenData[], swapCount: number, noValidTokens: boolean = false): Promise<void> {
    try {
      await this.fetch(`/user/${walletAddress}/cache`, {
        method: 'POST',
        body: JSON.stringify({ tokens, swapCount, noValidTokens }),
      });
      console.log(`Saved ${tokens.length} tokens to server for ${walletAddress} (noValidTokens: ${noValidTokens})`);
    } catch (error) {
      console.error('Error saving user cache:', error);
    }
  }

  // ============ Participation Operations ============

  /**
   * Check if user has participated in current round
   */
  async hasParticipatedInRound(walletAddress: string): Promise<boolean> {
    try {
      const response = await this.fetch<{ success: boolean; data: { hasParticipated: boolean } }>(`/participation/${walletAddress}`);
      return response.data.hasParticipated;
    } catch (error) {
      console.error('Error checking participation:', error);
      return false;
    }
  }

  /**
   * Get user's participated tokens for current round
   */
  async getParticipatedTokens(walletAddress: string): Promise<string[]> {
    try {
      const response = await this.fetch<{ success: boolean; data: { participatedTokens: string[] } }>(`/participation/${walletAddress}`);
      return response.data.participatedTokens || [];
    } catch (error) {
      console.error('Error getting participated tokens:', error);
      return [];
    }
  }

  /**
   * Submit participation
   */
  async participate(walletAddress: string, tokens: ParticipationToken[]): Promise<{ success: boolean; entries?: StoredLiveEntry[]; error?: string; alreadyParticipated?: boolean }> {
    try {
      const response = await this.fetch<{ success: boolean; entries: StoredLiveEntry[]; error?: string; alreadyParticipated?: boolean }>('/participate', {
        method: 'POST',
        body: JSON.stringify({ walletAddress, tokens }),
      });
      return response;
    } catch (error: any) {
      console.error('Error participating:', error);
      return { success: false, error: error.message };
    }
  }

  // ============ Live Entries Operations ============

  /**
   * Get live entries for current round
   */
  async getLiveEntries(): Promise<StoredLiveEntry[]> {
    try {
      const response = await this.fetch<{ success: boolean; data: StoredLiveEntry[] }>('/live-feed');
      return response.data || [];
    } catch (error) {
      console.error('Error fetching live entries:', error);
      return [];
    }
  }

  // ============ Pool Stats Operations ============

  /**
   * Get pool stats for current round
   */
  async getPoolStats(): Promise<StoredPoolToken[]> {
    try {
      const response = await this.fetch<{ success: boolean; data: StoredPoolToken[] }>('/pool-stats');
      return response.data || [];
    } catch (error) {
      console.error('Error fetching pool stats:', error);
      return [];
    }
  }

  // ============ Prize Pool Operations ============

  /**
   * Get current prize pool (from real treasury balance)
   */
  async getPrizePool(): Promise<{ amountSol: number; currency: string; configured: boolean; address?: string }> {
    try {
      // Fetch real treasury balance
      const response = await this.fetch<{
        success: boolean;
        data: {
          balanceSol: number;
          configured: boolean;
          address?: string;
        }
      }>('/transfer/balance');

      return {
        amountSol: response.data.balanceSol,
        currency: 'SOL',
        configured: response.data.configured,
        address: response.data.address,
      };
    } catch (error) {
      console.error('Error fetching prize pool:', error);
      return { amountSol: 0, currency: 'SOL', configured: false };
    }
  }

  /**
   * Complete round and distribute prizes
   */
  async completeRound(winnerTicker: string, vrfResult?: string): Promise<{
    success: boolean;
    roundId?: number;
    winnerTicker?: string;
    prizePoolSol?: number;
    payouts?: Array<{
      walletAddress: string;
      ticker: string;
      holdings: number;
      proportion: number;
      payoutSol: number;
    }>;
    totalWinners?: number;
    transfer?: {
      success: boolean;
      signature?: string;
      totalTransferred?: number;
      error?: string;
    };
    error?: string;
  }> {
    try {
      const response = await this.fetch<{
        success: boolean;
        data: {
          roundId: number;
          winnerTicker: string;
          prizePoolSol: number;
          payouts: Array<{
            walletAddress: string;
            ticker: string;
            holdings: number;
            proportion: number;
            payoutSol: number;
          }>;
          totalWinners: number;
          transfer?: {
            success: boolean;
            signature?: string;
            totalTransferred?: number;
            error?: string;
          };
        };
      }>('/round/complete', {
        method: 'POST',
        body: JSON.stringify({ winnerTicker, vrfResult }),
      });

      return {
        success: true,
        ...response.data,
      };
    } catch (error: any) {
      console.error('Error completing round:', error);
      return { success: false, error: error.message };
    }
  }

  // ============ User Winnings Operations ============

  /**
   * Get user's winnings history and total
   */
  async getUserWinnings(walletAddress: string): Promise<{
    totalWinningsSol: number;
    winnings: Array<{
      roundId: number;
      ticker: string;
      payoutSol: number;
      proportion: number;
      timestamp: number;
    }>;
  }> {
    try {
      const response = await this.fetch<{
        success: boolean;
        data: {
          totalWinningsSol: number;
          winnings: Array<{
            roundId: number;
            ticker: string;
            payoutSol: number;
            proportion: number;
            timestamp: number;
          }>;
        };
      }>(`/winnings/${walletAddress}`);

      return response.data;
    } catch (error) {
      console.error('Error fetching winnings:', error);
      return { totalWinningsSol: 0, winnings: [] };
    }
  }

  // ============ Swap Data Operations (for fast scanning) ============

  /**
   * Get cached swap data for instant retrieval
   */
  async getSwapData(walletAddress: string): Promise<{
    swaps: any[];
    positions: Record<string, any>;
    lastUpdated: number;
  } | null> {
    try {
      const response = await this.fetch<{
        success: boolean;
        data: {
          swaps: any[];
          positions: Record<string, any>;
          lastUpdated: number;
        } | null;
      }>(`/swaps/${walletAddress}`);

      return response.data;
    } catch (error) {
      console.error('Error fetching swap data:', error);
      return null;
    }
  }

  /**
   * Save processed swap data for future fast retrieval
   */
  async saveSwapData(walletAddress: string, swaps: any[], positions: Record<string, any>): Promise<void> {
    try {
      await this.fetch(`/swaps/${walletAddress}`, {
        method: 'POST',
        body: JSON.stringify({ swaps, positions }),
      });
      console.log('Saved swap data to server');
    } catch (error) {
      console.error('Error saving swap data:', error);
    }
  }

  // ============ Round History Operations ============

  /**
   * Get history of completed rounds
   */
  async getRoundHistory(limit: number = 50): Promise<Array<{
    roundId: number;
    winnerTicker: string;
    prizePoolSol: number;
    totalWinners: number;
    totalHoldings: number;
    completedAt: number;
    vrfResult: string | null;
    txSignature: string | null;
    participantCount: number;
    tokenCount: number;
  }>> {
    try {
      const response = await this.fetch<{
        success: boolean;
        data: Array<{
          roundId: number;
          winnerTicker: string;
          prizePoolSol: number;
          totalWinners: number;
          totalHoldings: number;
          completedAt: number;
          vrfResult: string | null;
          txSignature: string | null;
          participantCount: number;
          tokenCount: number;
        }>;
      }>(`/rounds/history?limit=${limit}`);

      return response.data || [];
    } catch (error) {
      console.error('Error fetching round history:', error);
      return [];
    }
  }

  // ============ Platform Stats ============

  /**
   * Get platform-wide statistics
   */
  async getPlatformStats(): Promise<{
    totalParticipants: number;
    totalWinners: number;
    totalSolDistributed: number;
    completedRounds: number;
    currentPotSol: number;
  }> {
    try {
      const response = await this.fetch<{
        success: boolean;
        data: {
          totalParticipants: number;
          totalWinners: number;
          totalSolDistributed: number;
          completedRounds: number;
          currentPotSol: number;
        };
      }>('/stats');

      return response.data || {
        totalParticipants: 0,
        totalWinners: 0,
        totalSolDistributed: 0,
        completedRounds: 0,
        currentPotSol: 0,
      };
    } catch (error) {
      console.error('Error fetching platform stats:', error);
      return {
        totalParticipants: 0,
        totalWinners: 0,
        totalSolDistributed: 0,
        completedRounds: 0,
        currentPotSol: 0,
      };
    }
  }

  // ============ Leaderboard ============

  /**
   * Get leaderboard data
   */
  async getLeaderboard(type: 'comeback' | 'god' = 'comeback', limit: number = 20): Promise<Array<{
    walletAddress: string;
    totalWinningsSol: number;
    winCount: number;
    winStreak: number;
    lastWinTimestamp: number;
  }>> {
    try {
      const response = await this.fetch<{
        success: boolean;
        data: Array<{
          walletAddress: string;
          totalWinningsSol: number;
          winCount: number;
          winStreak: number;
          lastWinTimestamp: number;
        }>;
      }>(`/leaderboard?type=${type}&limit=${limit}`);

      return response.data || [];
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      return [];
    }
  }

  // ============ Admin Operations ============

  /**
   * Clear all data and start fresh round (for testing)
   */
  async clearAll(): Promise<{ round?: { roundId: number; startTime: number; endTime: number } }> {
    try {
      const response = await this.fetch<{ success: boolean; round?: { roundId: number; startTime: number; endTime: number } }>('/admin/clear', { method: 'POST' });
      console.log('Cleared all server data, new round:', response.round?.roundId);
      return { round: response.round };
    } catch (error) {
      console.error('Error clearing data:', error);
      return {};
    }
  }

  // ============ Legacy localStorage methods (for backwards compatibility during transition) ============

  /**
   * @deprecated Use getUserCache instead
   */
  getWalletData(walletAddress: string): null {
    console.warn('getWalletData is deprecated, use getUserCache (async)');
    return null;
  }

  /**
   * @deprecated Use saveUserCache instead
   */
  saveWalletData(walletAddress: string, tokens: StoredTokenData[], swapCount: number): void {
    console.warn('saveWalletData is deprecated, use saveUserCache (async)');
    this.saveUserCache(walletAddress, tokens, swapCount);
  }

  // ============ PumpFun Fee Operations ============

  /**
   * Get PumpFun creator fee data
   */
  async getPumpFunFees(): Promise<{
    estimatedFees1h: number;
    estimatedFees24h: number;
    volume1h: number;
    volume24h: number;
    priceUsd: number;
    priceNative: number;
    marketCap: number;
    bondingCurve?: {
      virtualSolReserves: number;
      realSolReserves: number;
      complete: boolean;
    };
    timestamp: number;
  } | null> {
    try {
      const response = await this.fetch<{
        success: boolean;
        data: {
          estimatedFees1h: number;
          estimatedFees24h: number;
          volume1h: number;
          volume24h: number;
          priceUsd: number;
          priceNative: number;
          marketCap: number;
          bondingCurve?: {
            virtualSolReserves: number;
            realSolReserves: number;
            complete: boolean;
          };
          timestamp: number;
        };
      }>('/pumpfun/fees');

      return response.data;
    } catch (error) {
      console.error('Error fetching PumpFun fees:', error);
      return null;
    }
  }

  /**
   * Get PumpFun prize pool (estimated fees)
   */
  async getPumpFunPrizePool(): Promise<{
    estimatedFeesUsd: number;
    estimatedFeesSol: number;
    bondingCurveSol: number;
    volume1h: number;
    volume24h: number;
  }> {
    try {
      const response = await this.fetch<{
        success: boolean;
        data: {
          estimatedFeesUsd: number;
          estimatedFeesSol: number;
          bondingCurveSol: number;
          volume1h: number;
          volume24h: number;
        };
      }>('/pumpfun/prize-pool');

      return response.data;
    } catch (error) {
      console.error('Error fetching PumpFun prize pool:', error);
      return {
        estimatedFeesUsd: 0,
        estimatedFeesSol: 0,
        bondingCurveSol: 0,
        volume1h: 0,
        volume24h: 0,
      };
    }
  }

  // ============ WebSocket Broadcast Operations ============

  /**
   * Broadcast spin start to all connected clients
   */
  async broadcastSpinStart(duration: number = 10000): Promise<void> {
    try {
      await this.fetch('/admin/spin-start', {
        method: 'POST',
        body: JSON.stringify({ duration }),
      });
      console.log('Broadcast spin start');
    } catch (error) {
      console.error('Error broadcasting spin start:', error);
      throw error;
    }
  }

  /**
   * Broadcast spin result to all connected clients
   */
  async broadcastSpinResult(winner: string, prizePool: number): Promise<void> {
    try {
      await this.fetch('/admin/spin-result', {
        method: 'POST',
        body: JSON.stringify({ winner, prizePool }),
      });
      console.log('Broadcast spin result:', winner);
    } catch (error) {
      console.error('Error broadcasting spin result:', error);
      throw error;
    }
  }
}

export const dataService = DataService.getInstance();
