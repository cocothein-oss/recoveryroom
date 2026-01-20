/**
 * VRF Service for Recovery Room
 * Frontend integration for Switchboard VRF
 *
 * Note: Full on-chain integration requires @coral-xyz/anchor and @solana/web3.js
 * This version provides a simplified interface for demo/simulation mode
 */

export type RoundStatus = 'Active' | 'VrfRequested' | 'Complete';

export interface OnChainRoundState {
  roundId: number;
  startTime: number;
  endTime: number;
  totalParticipants: number;
  totalTokenEntries: number;
  status: RoundStatus;
  vrfResult: number[] | null;
  winnerToken: string | null;
}

export interface TokenEntry {
  tokenMint: string;
  ticker: string;
  lossAmountUsd: number;
  holdings: number;
}

export interface VrfServiceConfig {
  rpcEndpoint: string;
  programId?: string;
  network?: 'devnet' | 'mainnet';
}

/**
 * VRF Service - Simplified frontend version
 * For production, use @coral-xyz/anchor with full program integration
 */
class VrfService {
  private rpcEndpoint: string;
  private network: 'devnet' | 'mainnet';
  private programId: string;

  constructor(config: VrfServiceConfig) {
    this.rpcEndpoint = config.rpcEndpoint;
    this.network = config.network || 'devnet';
    this.programId = config.programId || 'RecovRoomVRF111111111111111111111111111111';
  }

  /**
   * Get Explorer URL for transaction
   */
  getExplorerUrl(txHash: string): string {
    return `https://explorer.solana.com/tx/${txHash}?cluster=${this.network}`;
  }

  /**
   * Format VRF result for display
   */
  formatVrfResult(vrfBytes: Uint8Array | number[]): string {
    const bytes = vrfBytes instanceof Uint8Array ? vrfBytes : new Uint8Array(vrfBytes);
    return '0x' + Array.from(bytes.slice(0, 8))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Generate simulated VRF result (for demo mode)
   */
  generateSimulatedVrf(): { vrfBytes: Uint8Array; vrfHex: string; txHash: string } {
    const vrfBytes = new Uint8Array(32);
    crypto.getRandomValues(vrfBytes);

    const vrfHex = this.formatVrfResult(vrfBytes);
    const txHash = Array.from(vrfBytes.slice(8, 40))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return { vrfBytes, vrfHex, txHash };
  }

  /**
   * Calculate winner using sqrt-weighted probabilities
   * Recreates the on-chain algorithm for verification
   */
  calculateWinnerFromVrf(
    vrfBytes: Uint8Array,
    tokenPool: { ticker: string; submissionCount: number }[]
  ): { winner: string; probabilities: { ticker: string; probability: number }[] } {
    // Calculate sqrt weights
    let totalWeight = 0;
    const weights = tokenPool.map(t => {
      const weight = Math.sqrt(t.submissionCount);
      totalWeight += weight;
      return { ticker: t.ticker, weight };
    });

    // Convert VRF bytes to normalized value (0-1)
    // Use first 8 bytes as u64
    let vrfNumber = 0n;
    for (let i = 0; i < 8; i++) {
      vrfNumber += BigInt(vrfBytes[i]) << BigInt(i * 8);
    }
    const normalized = Number(vrfNumber) / Number(0xFFFFFFFFFFFFFFFFn);

    // Find winner using weighted selection
    const target = normalized * totalWeight;
    let accumulated = 0;
    let winner = weights[0]?.ticker || '';

    for (const { ticker, weight } of weights) {
      accumulated += weight;
      if (target <= accumulated) {
        winner = ticker;
        break;
      }
    }

    // Calculate probabilities for display
    const probabilities = weights.map(w => ({
      ticker: w.ticker,
      probability: totalWeight > 0 ? (w.weight / totalWeight) * 100 : 0,
    }));

    return { winner, probabilities };
  }

  /**
   * Verify VRF result matches winner (for transparency)
   */
  verifyWinnerSelection(
    vrfHex: string,
    winner: string,
    tokenPool: { ticker: string; submissionCount: number }[]
  ): boolean {
    // Parse VRF hex to bytes
    const hex = vrfHex.startsWith('0x') ? vrfHex.slice(2) : vrfHex;
    const vrfBytes = new Uint8Array(
      hex.match(/.{2}/g)?.map(byte => parseInt(byte, 16)) || []
    );

    // Pad to 32 bytes if needed
    const paddedBytes = new Uint8Array(32);
    paddedBytes.set(vrfBytes);

    const { winner: calculatedWinner } = this.calculateWinnerFromVrf(paddedBytes, tokenPool);
    return calculatedWinner === winner;
  }
}

// Singleton instance
let vrfServiceInstance: VrfService | null = null;

export const getVrfService = (config?: VrfServiceConfig): VrfService => {
  if (!vrfServiceInstance && config) {
    vrfServiceInstance = new VrfService(config);
  }
  if (!vrfServiceInstance) {
    // Default config
    vrfServiceInstance = new VrfService({
      rpcEndpoint: 'https://api.devnet.solana.com',
      network: 'devnet',
    });
  }
  return vrfServiceInstance;
};

export default VrfService;
