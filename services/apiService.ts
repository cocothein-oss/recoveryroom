// API Service for Moralis and DexScreener

const MORALIS_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6Ijk3MDY2ZDZjLTJmYmItNGZhMy05Zjc0LTFjNDA5MWY0ODk1NCIsIm9yZ0lkIjoiMzQwMzc0IiwidXNlcklkIjoiMzQ5OTE3IiwidHlwZUlkIjoiZjI2YTFlZDktODhhMy00NTJjLWJiNGUtZTY4OWFhOTE2NTZlIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3MDc0MjgxMzUsImV4cCI6NDg2MzE4ODEzNX0.zZWh_SZ6Kj0KkldN-YFauhYAVcmCOXSLlYmdBJXUfmM';
const MORALIS_BASE_URL = 'https://solana-gateway.moralis.io';
const DEXSCREENER_BASE_URL = 'https://api.dexscreener.com';

// Types for Moralis Swap Response
export interface MoralisSwap {
  transactionHash: string;
  transactionType: 'buy' | 'sell';
  blockTimestamp: string;
  walletAddress: string;
  pairAddress: string;
  pairLabel: string;
  bought: {
    address: string;
    name: string;
    symbol: string;
    logo: string | null;
    amount: string;
    usdPrice: number;
    usdAmount: number;
  };
  sold: {
    address: string;
    name: string;
    symbol: string;
    logo: string | null;
    amount: string;
    usdPrice: number;
    usdAmount: number;
  };
  totalValueUsd: number;
}

export interface MoralisSwapResponse {
  cursor: string | null;
  page: number;
  pageSize: number;
  result: MoralisSwap[];
}

// Types for Moralis Token Balance
export interface MoralisTokenBalance {
  associatedTokenAddress: string;
  mint: string;
  amountRaw: string;
  amount: string;
  decimals: number;
  name: string;
  symbol: string;
  logo: string | null;
}

// Types for DexScreener Response
export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    h24: number;
    h6: number;
    h1: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  info?: {
    imageUrl?: string;
  };
}

export interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

// Stablecoins and wrapped SOL to exclude from analysis
const EXCLUDED_TOKENS = [
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', // USD1
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK (too popular)
];

class ApiService {
  private static instance: ApiService;

  private constructor() {}

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  /**
   * Fetch all swaps from Moralis with pagination (last 90 days)
   */
  async fetchAllSwaps(walletAddress: string): Promise<MoralisSwap[]> {
    const allSwaps: MoralisSwap[] = [];
    let cursor: string | null = null;

    // Calculate 90 days ago timestamp
    const fromDate = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);

    do {
      const url = new URL(`${MORALIS_BASE_URL}/account/mainnet/${walletAddress}/swaps`);
      url.searchParams.append('limit', '100');
      url.searchParams.append('order', 'DESC');
      url.searchParams.append('transactionTypes', 'buy,sell');
      url.searchParams.append('fromDate', fromDate.toString());

      if (cursor) {
        url.searchParams.append('cursor', cursor);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'X-API-Key': MORALIS_API_KEY,
        },
      });

      if (!response.ok) {
        throw new Error(`Moralis API error: ${response.status}`);
      }

      const data: MoralisSwapResponse = await response.json();
      allSwaps.push(...data.result);
      cursor = data.cursor;

      // Safety limit - max 10 pages (1000 swaps)
      if (allSwaps.length >= 1000) break;

    } while (cursor);

    return allSwaps;
  }

  /**
   * Fetch token balances from Moralis
   */
  async fetchTokenBalances(walletAddress: string): Promise<MoralisTokenBalance[]> {
    const response = await fetch(
      `${MORALIS_BASE_URL}/account/mainnet/${walletAddress}/tokens`,
      {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'X-API-Key': MORALIS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Moralis API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Fetch token data from DexScreener
   */
  async fetchTokenData(tokenAddress: string): Promise<DexScreenerPair | null> {
    try {
      const response = await fetch(
        `${DEXSCREENER_BASE_URL}/latest/dex/tokens/${tokenAddress}`
      );

      if (!response.ok) {
        return null;
      }

      const data: DexScreenerResponse = await response.json();

      // Return the pair with highest liquidity
      if (data.pairs && data.pairs.length > 0) {
        return data.pairs.reduce((best, current) =>
          (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best
        );
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Batch fetch token data from DexScreener (max 30 tokens per request)
   */
  async fetchMultipleTokenData(tokenAddresses: string[]): Promise<Map<string, DexScreenerPair>> {
    const tokenDataMap = new Map<string, DexScreenerPair>();

    // DexScreener allows comma-separated addresses
    const chunks = this.chunkArray(tokenAddresses, 30);

    for (const chunk of chunks) {
      try {
        const response = await fetch(
          `${DEXSCREENER_BASE_URL}/latest/dex/tokens/${chunk.join(',')}`
        );

        if (response.ok) {
          const data: DexScreenerResponse = await response.json();

          if (data.pairs) {
            // Group by token address and keep best liquidity pair
            for (const pair of data.pairs) {
              const tokenAddr = pair.baseToken.address;
              const existing = tokenDataMap.get(tokenAddr);

              if (!existing || (pair.liquidity?.usd || 0) > (existing.liquidity?.usd || 0)) {
                tokenDataMap.set(tokenAddr, pair);
              }
            }
          }
        }
      } catch (error) {
        console.error('DexScreener batch fetch error:', error);
      }

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return tokenDataMap;
  }

  /**
   * Helper to chunk array
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Check if token should be excluded (stablecoins, wrapped SOL, etc.)
   */
  isExcludedToken(tokenAddress: string): boolean {
    return EXCLUDED_TOKENS.includes(tokenAddress);
  }
}

export const apiService = ApiService.getInstance();
