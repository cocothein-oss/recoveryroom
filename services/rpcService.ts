// RPC Service for fetching and parsing Solana transactions
// Uses Alchemy RPC for reliable transaction history

// RPC endpoint - Alchemy is most reliable
const RPC_ENDPOINT = 'https://solana-mainnet.g.alchemy.com/v2/HS0Exhg0Rv8OjoFAWdbqSEP4-jZ5Q2Dx';

// Native SOL mint address (virtual - used for tracking)
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

// Known stablecoins and wrapped SOL to identify as "payment" tokens
const PAYMENT_TOKENS = new Set([
  NATIVE_SOL_MINT, // Native/Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', // USD1
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', // bSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
]);

export interface ParsedSwap {
  signature: string;
  blockTime: number;
  // What the user sent (sold)
  soldToken: {
    mint: string;
    amount: number;
    decimals: number;
  } | null;
  // What the user received (bought)
  boughtToken: {
    mint: string;
    amount: number;
    decimals: number;
  } | null;
  // Is this a buy or sell of a memecoin?
  type: 'buy' | 'sell' | 'unknown';
}

interface TokenBalanceInfo {
  mint: string;
  owner: string;
  amount: string;
  decimals: number;
  accountIndex: number;
}

class RpcService {
  private static instance: RpcService;

  private constructor() {}

  public static getInstance(): RpcService {
    if (!RpcService.instance) {
      RpcService.instance = new RpcService();
    }
    return RpcService.instance;
  }

  /**
   * Make RPC call
   */
  private async rpcCall(method: string, params: any[]): Promise<any> {
    const response = await fetch(RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }
    return data.result;
  }

  /**
   * Get all transaction signatures for a wallet (last 90 days)
   */
  async getSignatures(walletAddress: string, days: number = 90): Promise<string[]> {
    const signatures: string[] = [];
    const cutoffTime = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
    let before: string | undefined = undefined;
    let reachedCutoff = false;

    console.log(`Fetching signatures for ${walletAddress} (last ${days} days)...`);

    while (!reachedCutoff) {
      const params: any = { limit: 1000 };
      if (before) params.before = before;

      const result = await this.rpcCall('getSignaturesForAddress', [walletAddress, params]);

      if (!result || result.length === 0) break;

      for (const sig of result) {
        if (sig.blockTime && sig.blockTime < cutoffTime) {
          reachedCutoff = true;
          break;
        }
        // Only include successful transactions
        if (!sig.err) {
          signatures.push(sig.signature);
        }
      }

      before = result[result.length - 1]?.signature;

      // Safety limit
      if (signatures.length >= 5000) {
        console.log('Reached 5000 signature limit');
        break;
      }

      // Small delay to avoid rate limits (50ms is safe)
      await new Promise(r => setTimeout(r, 50));
    }

    console.log(`Found ${signatures.length} successful transactions`);
    return signatures;
  }

  /**
   * Fetch and parse a single transaction
   */
  async parseTransaction(signature: string, walletAddress: string): Promise<ParsedSwap | null> {
    try {
      const tx = await this.rpcCall('getTransaction', [
        signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
      ]);

      if (!tx || !tx.meta) return null;

      const { preTokenBalances, postTokenBalances, preBalances: preSolBalances, postBalances: postSolBalances } = tx.meta;

      // Find wallet's account index from the transaction accounts
      const accountKeys = tx.transaction?.message?.accountKeys || [];
      let walletAccountIndex = -1;
      for (let i = 0; i < accountKeys.length; i++) {
        const key = typeof accountKeys[i] === 'string' ? accountKeys[i] : accountKeys[i]?.pubkey;
        if (key === walletAddress) {
          walletAccountIndex = i;
          break;
        }
      }

      // Build map of token balance changes for the wallet
      const preBalances = new Map<string, TokenBalanceInfo>();
      const postBalances = new Map<string, TokenBalanceInfo>();

      if (preTokenBalances) {
        for (const b of preTokenBalances) {
          if (b.owner === walletAddress) {
            preBalances.set(b.mint, {
              mint: b.mint,
              owner: b.owner,
              amount: b.uiTokenAmount?.amount || '0',
              decimals: b.uiTokenAmount?.decimals || 0,
              accountIndex: b.accountIndex,
            });
          }
        }
      }

      if (postTokenBalances) {
        for (const b of postTokenBalances) {
          if (b.owner === walletAddress) {
            postBalances.set(b.mint, {
              mint: b.mint,
              owner: b.owner,
              amount: b.uiTokenAmount?.amount || '0',
              decimals: b.uiTokenAmount?.decimals || 0,
              accountIndex: b.accountIndex,
            });
          }
        }
      }

      // Track native SOL balance change
      let solChange = 0n;
      if (walletAccountIndex >= 0 && preSolBalances && postSolBalances) {
        const preSol = BigInt(preSolBalances[walletAccountIndex] || 0);
        const postSol = BigInt(postSolBalances[walletAccountIndex] || 0);
        solChange = postSol - preSol;
      }

      // Find all mints involved
      const allMints = new Set([...preBalances.keys(), ...postBalances.keys()]);

      let soldToken: ParsedSwap['soldToken'] = null;
      let boughtToken: ParsedSwap['boughtToken'] = null;

      // Check token balance changes
      for (const mint of allMints) {
        const pre = preBalances.get(mint);
        const post = postBalances.get(mint);

        const preAmount = BigInt(pre?.amount || '0');
        const postAmount = BigInt(post?.amount || '0');
        const decimals = pre?.decimals || post?.decimals || 0;

        const diff = postAmount - preAmount;

        if (diff < 0n) {
          // Token was sold (balance decreased)
          soldToken = {
            mint,
            amount: Number(-diff) / Math.pow(10, decimals),
            decimals,
          };
        } else if (diff > 0n) {
          // Token was bought (balance increased)
          boughtToken = {
            mint,
            amount: Number(diff) / Math.pow(10, decimals),
            decimals,
          };
        }
      }

      // Handle native SOL as payment token (only if significant change > 0.001 SOL)
      const SOL_DECIMALS = 9;
      const minSolChange = 1_000_000n; // 0.001 SOL in lamports

      if (solChange < -minSolChange && !soldToken) {
        // SOL was spent (negative change) - this is likely a buy
        soldToken = {
          mint: NATIVE_SOL_MINT,
          amount: Number(-solChange) / Math.pow(10, SOL_DECIMALS),
          decimals: SOL_DECIMALS,
        };
      } else if (solChange > minSolChange && !boughtToken) {
        // SOL was received (positive change) - this is likely a sell
        boughtToken = {
          mint: NATIVE_SOL_MINT,
          amount: Number(solChange) / Math.pow(10, SOL_DECIMALS),
          decimals: SOL_DECIMALS,
        };
      }

      // Determine swap type
      let type: ParsedSwap['type'] = 'unknown';
      if (soldToken && boughtToken) {
        // If sold a payment token and bought something else = BUY
        if (PAYMENT_TOKENS.has(soldToken.mint) && !PAYMENT_TOKENS.has(boughtToken.mint)) {
          type = 'buy';
        }
        // If sold something and got a payment token = SELL
        else if (!PAYMENT_TOKENS.has(soldToken.mint) && PAYMENT_TOKENS.has(boughtToken.mint)) {
          type = 'sell';
        }
        // Token to token swap - treat as buy of the received token
        else if (!PAYMENT_TOKENS.has(soldToken.mint) && !PAYMENT_TOKENS.has(boughtToken.mint)) {
          type = 'buy';
        }
      } else if (boughtToken && !PAYMENT_TOKENS.has(boughtToken.mint)) {
        // Only bought a non-payment token (likely paid with SOL we couldn't track properly)
        type = 'buy';
      } else if (soldToken && !PAYMENT_TOKENS.has(soldToken.mint)) {
        // Only sold a non-payment token (likely received SOL we couldn't track properly)
        type = 'sell';
      }

      // Skip if no meaningful swap detected (must have at least one non-payment token)
      const hasNonPaymentToken =
        (soldToken && !PAYMENT_TOKENS.has(soldToken.mint)) ||
        (boughtToken && !PAYMENT_TOKENS.has(boughtToken.mint));

      if (!hasNonPaymentToken) return null;

      return {
        signature,
        blockTime: tx.blockTime || 0,
        soldToken,
        boughtToken,
        type,
      };
    } catch (error) {
      // Silent fail for individual transactions
      return null;
    }
  }

  /**
   * Fetch all swaps for a wallet
   */
  async fetchAllSwaps(walletAddress: string, days: number = 90, onProgress?: (current: number, total: number) => void): Promise<ParsedSwap[]> {
    const signatures = await this.getSignatures(walletAddress, days);
    const swaps: ParsedSwap[] = [];

    console.log(`Parsing ${signatures.length} transactions...`);

    // Process in batches - 15 is safe balance of speed and reliability
    const batchSize = 15;
    for (let i = 0; i < signatures.length; i += batchSize) {
      const batch = signatures.slice(i, i + batchSize);

      const results = await Promise.all(
        batch.map(sig => this.parseTransaction(sig, walletAddress))
      );

      for (const result of results) {
        if (result && (result.soldToken || result.boughtToken)) {
          swaps.push(result);
        }
      }

      if (onProgress) {
        onProgress(Math.min(i + batchSize, signatures.length), signatures.length);
      }

      // Small delay between batches
      await new Promise(r => setTimeout(r, 50));
    }

    console.log(`Found ${swaps.length} swaps`);
    return swaps;
  }

  /**
   * Aggregate swaps into token positions
   */
  aggregateSwaps(swaps: ParsedSwap[]): Map<string, {
    totalBought: number;
    totalSold: number;
    buyCount: number;
    sellCount: number;
    firstBuyTime: number;
    lastBuyTime: number;
    totalBuyCostSol: number; // Total SOL spent buying
    totalBuyCostStable: number; // Total stablecoins spent buying
    totalSellRevenueSol: number; // Total SOL received from sells
    totalSellRevenueStable: number; // Total stablecoins received from sells
  }> {
    const positions = new Map<string, {
      totalBought: number;
      totalSold: number;
      buyCount: number;
      sellCount: number;
      firstBuyTime: number;
      lastBuyTime: number;
      totalBuyCostSol: number;
      totalBuyCostStable: number;
      totalSellRevenueSol: number;
      totalSellRevenueStable: number;
    }>();

    // SOL-like tokens (need USD conversion)
    const SOL_TOKENS = new Set([
      NATIVE_SOL_MINT,
      'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
      'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', // bSOL
      'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
    ]);

    for (const swap of swaps) {
      if (swap.type === 'buy' && swap.boughtToken && !PAYMENT_TOKENS.has(swap.boughtToken.mint)) {
        const mint = swap.boughtToken.mint;
        const existing = positions.get(mint) || {
          totalBought: 0,
          totalSold: 0,
          buyCount: 0,
          sellCount: 0,
          firstBuyTime: swap.blockTime,
          lastBuyTime: swap.blockTime,
          totalBuyCostSol: 0,
          totalBuyCostStable: 0,
          totalSellRevenueSol: 0,
          totalSellRevenueStable: 0,
        };

        existing.totalBought += swap.boughtToken.amount;
        existing.buyCount++;
        existing.lastBuyTime = Math.max(existing.lastBuyTime, swap.blockTime);
        existing.firstBuyTime = Math.min(existing.firstBuyTime, swap.blockTime);

        // Track cost by payment token type
        if (swap.soldToken) {
          if (SOL_TOKENS.has(swap.soldToken.mint)) {
            existing.totalBuyCostSol += swap.soldToken.amount;
          } else {
            existing.totalBuyCostStable += swap.soldToken.amount;
          }
        }

        positions.set(mint, existing);
      }

      if (swap.type === 'sell' && swap.soldToken && !PAYMENT_TOKENS.has(swap.soldToken.mint)) {
        const mint = swap.soldToken.mint;
        const existing = positions.get(mint) || {
          totalBought: 0,
          totalSold: 0,
          buyCount: 0,
          sellCount: 0,
          firstBuyTime: swap.blockTime,
          lastBuyTime: swap.blockTime,
          totalBuyCostSol: 0,
          totalBuyCostStable: 0,
          totalSellRevenueSol: 0,
          totalSellRevenueStable: 0,
        };

        existing.totalSold += swap.soldToken.amount;
        existing.sellCount++;

        // Track revenue by payment token type
        if (swap.boughtToken) {
          if (SOL_TOKENS.has(swap.boughtToken.mint)) {
            existing.totalSellRevenueSol += swap.boughtToken.amount;
          } else {
            existing.totalSellRevenueStable += swap.boughtToken.amount;
          }
        }

        positions.set(mint, existing);
      }
    }

    return positions;
  }
}

export const rpcService = RpcService.getInstance();
