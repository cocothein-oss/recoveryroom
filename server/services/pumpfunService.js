/**
 * PumpFun Creator Fee Service
 * Fetches trading data and collects creator fees
 */

import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as bs58Module from 'bs58';

// Handle both bs58 v4 and v6 import styles
const bs58 = bs58Module.default || bs58Module;

// PumpPortal API endpoint for local transactions
const PUMPPORTAL_API = 'https://pumpportal.fun/api/trade-local';

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Token configuration - loaded from environment
const TOKEN_CONFIG = {
  mint: process.env.PUMPFUN_TOKEN_MINT || 'DX8co1BEmQDZPWRWtUddA59zeSJ3nq8Q8XkiHFxWpump',
  creatorWallet: process.env.PUMPFUN_CREATOR_WALLET || '8EdtshswQJaQb34GxPhvbBVi8io1SU2McYY3uQ7Uk76X',
  feePercentage: 0.003, // 0.30% creator fee (minimum)
};

// Keypair loaded lazily after dotenv
let creatorKeypair = null;
let keypairLoaded = false;

function loadCreatorKeypair() {
  if (keypairLoaded) return;
  keypairLoaded = true;

  const privateKey = process.env.PUMPFUN_CREATOR_PRIVATE_KEY;
  if (privateKey && privateKey.length > 0) {
    try {
      const privateKeyBytes = bs58.decode(privateKey);
      creatorKeypair = Keypair.fromSecretKey(privateKeyBytes);
      console.log('PumpFun creator wallet loaded:', creatorKeypair.publicKey.toBase58());
    } catch (error) {
      console.error('Failed to load PumpFun creator private key:', error.message);
    }
  } else {
    console.log('PumpFun creator private key not configured');
  }
}

class PumpFunService {
  constructor() {
    this.connection = new Connection(RPC_URL);
    this.bondingCurveAddress = null;
    this.cachedData = null;
    this.lastFetchTime = 0;
    this.cacheExpiry = 30000; // 30 seconds cache
  }

  /**
   * Ensure keypair is loaded (called before any operation needing it)
   */
  ensureKeypairLoaded() {
    loadCreatorKeypair();
  }

  /**
   * Derive bonding curve PDA from token mint
   */
  async getBondingCurveAddress(mintAddress) {
    if (this.bondingCurveAddress) return this.bondingCurveAddress;

    const mint = new PublicKey(mintAddress);
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mint.toBuffer()],
      PUMP_PROGRAM_ID
    );

    this.bondingCurveAddress = bondingCurve;
    return bondingCurve;
  }

  /**
   * Fetch bonding curve account data
   */
  async getBondingCurveData() {
    try {
      const bondingCurve = await this.getBondingCurveAddress(TOKEN_CONFIG.mint);
      const accountInfo = await this.connection.getAccountInfo(bondingCurve);

      if (!accountInfo) {
        console.log('Bonding curve account not found');
        return null;
      }

      const data = accountInfo.data;
      let offset = 8; // Skip discriminator

      // Parse bonding curve layout
      const virtualTokenReserves = data.readBigUInt64LE(offset);
      offset += 8;
      const virtualSolReserves = data.readBigUInt64LE(offset);
      offset += 8;
      const realTokenReserves = data.readBigUInt64LE(offset);
      offset += 8;
      const realSolReserves = data.readBigUInt64LE(offset);
      offset += 8;
      const tokenTotalSupply = data.readBigUInt64LE(offset);
      offset += 8;
      const complete = data.readUInt8(offset);

      return {
        virtualTokenReserves: Number(virtualTokenReserves) / 1e6,
        virtualSolReserves: Number(virtualSolReserves) / 1e9,
        realTokenReserves: Number(realTokenReserves) / 1e6,
        realSolReserves: Number(realSolReserves) / 1e9,
        tokenTotalSupply: Number(tokenTotalSupply) / 1e6,
        complete: complete === 1,
        accountLamports: accountInfo.lamports,
        accountSol: accountInfo.lamports / 1e9,
      };
    } catch (error) {
      console.error('Error fetching bonding curve data:', error);
      return null;
    }
  }

  /**
   * Fetch token trading data from DexScreener
   */
  async getTokenTradingData() {
    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${TOKEN_CONFIG.mint}`
      );
      const data = await response.json();

      if (!data.pairs || data.pairs.length === 0) {
        return null;
      }

      const pair = data.pairs[0];
      return {
        priceUsd: parseFloat(pair.priceUsd),
        priceNative: parseFloat(pair.priceNative),
        volume24h: pair.volume?.h24 || 0,
        volume1h: pair.volume?.h1 || 0,
        txns24h: pair.txns?.h24 || { buys: 0, sells: 0 },
        fdv: pair.fdv || 0,
        marketCap: pair.marketCap || 0,
        pairAddress: pair.pairAddress,
      };
    } catch (error) {
      console.error('Error fetching DexScreener data:', error);
      return null;
    }
  }

  /**
   * Estimate accumulated creator fees based on trading volume
   * Note: This is an estimate - actual fees depend on exact trade sizes
   */
  async estimateCreatorFees() {
    const tradingData = await this.getTokenTradingData();
    if (!tradingData) return { estimatedFees: 0, volume24h: 0 };

    // Creator fee is 0.30% of volume (minimum rate)
    const estimatedFees24h = (tradingData.volume24h * TOKEN_CONFIG.feePercentage);
    const estimatedFees1h = (tradingData.volume1h * TOKEN_CONFIG.feePercentage);

    return {
      estimatedFees24h,
      estimatedFees1h,
      volume24h: tradingData.volume24h,
      volume1h: tradingData.volume1h,
      totalTxns: tradingData.txns24h.buys + tradingData.txns24h.sells,
    };
  }

  /**
   * Get comprehensive token and fee data
   */
  async getTokenFeeData() {
    // Use cache if valid
    if (this.cachedData && Date.now() - this.lastFetchTime < this.cacheExpiry) {
      return this.cachedData;
    }

    try {
      const [bondingCurve, tradingData, feeEstimate] = await Promise.all([
        this.getBondingCurveData(),
        this.getTokenTradingData(),
        this.estimateCreatorFees(),
      ]);

      this.cachedData = {
        token: {
          mint: TOKEN_CONFIG.mint,
          creatorWallet: TOKEN_CONFIG.creatorWallet,
        },
        bondingCurve,
        trading: tradingData,
        fees: feeEstimate,
        timestamp: Date.now(),
      };

      this.lastFetchTime = Date.now();
      return this.cachedData;
    } catch (error) {
      console.error('Error getting token fee data:', error);
      return null;
    }
  }

  /**
   * Get creator wallet SOL balance
   */
  async getCreatorWalletBalance() {
    try {
      const publicKey = new PublicKey(TOKEN_CONFIG.creatorWallet);
      const balance = await this.connection.getBalance(publicKey);
      return {
        lamports: balance,
        sol: balance / LAMPORTS_PER_SOL,
        address: TOKEN_CONFIG.creatorWallet,
      };
    } catch (error) {
      console.error('Error getting creator wallet balance:', error);
      return { lamports: 0, sol: 0, address: TOKEN_CONFIG.creatorWallet };
    }
  }

  /**
   * Check if creator wallet is configured and ready
   */
  isConfigured() {
    this.ensureKeypairLoaded();
    return creatorKeypair !== null;
  }

  /**
   * Get distributable balance (total minus reserve for fees)
   */
  async getDistributableBalance() {
    this.ensureKeypairLoaded();
    const balance = await this.getCreatorWalletBalance();
    // Keep very minimal 0.0001 SOL reserve for transaction fees (~20 transactions)
    const reserve = 0.0001;
    const distributable = Math.max(0, balance.sol - reserve);
    return {
      total: balance.sol,
      reserve,
      distributable,
      address: balance.address,
    };
  }

  /**
   * Transfer SOL from creator wallet to a recipient
   */
  async transferToWinner(recipientAddress, amountSol) {
    if (!creatorKeypair) {
      return { success: false, error: 'Creator wallet not configured' };
    }

    try {
      const recipientPubkey = new PublicKey(recipientAddress);
      const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: creatorKeypair.publicKey,
          toPubkey: recipientPubkey,
          lamports,
        })
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = creatorKeypair.publicKey;

      // Sign and send
      transaction.sign(creatorKeypair);
      const signature = await this.connection.sendRawTransaction(transaction.serialize());

      // Confirm transaction
      await this.connection.confirmTransaction(signature, 'confirmed');

      console.log(`Transferred ${amountSol} SOL to ${recipientAddress}: ${signature}`);
      return {
        success: true,
        signature,
        amount: amountSol,
        recipient: recipientAddress,
      };
    } catch (error) {
      console.error('Error transferring to winner:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Distribute prizes to multiple winners
   */
  async distributePrizes(payouts) {
    if (!creatorKeypair) {
      return { success: false, error: 'Creator wallet not configured' };
    }

    if (!payouts || payouts.length === 0) {
      return { success: false, error: 'No payouts to distribute' };
    }

    const results = [];
    let totalDistributed = 0;

    for (const payout of payouts) {
      if (payout.payoutSol > 0) {
        const result = await this.transferToWinner(payout.walletAddress, payout.payoutSol);
        results.push({
          ...payout,
          ...result,
        });
        if (result.success) {
          totalDistributed += payout.payoutSol;
        }
        // Small delay between transfers to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const successCount = results.filter(r => r.success).length;
    return {
      success: successCount > 0,
      totalDistributed,
      successCount,
      totalPayouts: payouts.length,
      results,
    };
  }

  /**
   * Claim creator fees from PumpFun using PumpPortal Local API
   * This collects all unclaimed fees and transfers them to the creator wallet
   */
  async claimCreatorFees(priorityFee = 0.0001) {
    this.ensureKeypairLoaded();

    if (!creatorKeypair) {
      return { success: false, error: 'Creator wallet not configured' };
    }

    try {
      console.log('Claiming creator fees via PumpPortal API...');

      // Get wallet balance before claim
      const balanceBefore = await this.getCreatorWalletBalance();
      console.log(`Wallet balance before claim: ${balanceBefore.sol} SOL`);

      // Step 1: Request unsigned transaction from PumpPortal
      const response = await fetch(PUMPPORTAL_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publicKey: creatorKeypair.publicKey.toBase58(),
          action: 'collectCreatorFee',
          priorityFee: priorityFee,
          pool: 'pump',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('PumpPortal API error:', response.status, errorText);

        // Check if it's a "no fees to claim" error
        if (errorText.includes('no fees') || errorText.includes('nothing to claim')) {
          return {
            success: false,
            error: 'No fees to claim',
            noFees: true,
          };
        }

        return { success: false, error: `PumpPortal API error: ${response.status} - ${errorText}` };
      }

      // Step 2: Get the transaction data (comes as arraybuffer)
      const txData = await response.arrayBuffer();

      if (!txData || txData.byteLength === 0) {
        return { success: false, error: 'Empty transaction received from PumpPortal' };
      }

      console.log(`Received transaction data: ${txData.byteLength} bytes`);

      // Step 3: Deserialize and sign the transaction
      const tx = VersionedTransaction.deserialize(new Uint8Array(txData));
      tx.sign([creatorKeypair]);

      // Step 4: Send the signed transaction
      const signature = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log(`Claim transaction sent: ${signature}`);

      // Step 5: Confirm the transaction
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        console.error('Transaction failed:', confirmation.value.err);
        return { success: false, error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}` };
      }

      // Step 6: Get balance after claim to see how much was claimed
      await new Promise(r => setTimeout(r, 2000)); // Wait for balance to update
      const balanceAfter = await this.getCreatorWalletBalance();
      const claimedAmount = balanceAfter.sol - balanceBefore.sol;

      console.log(`Wallet balance after claim: ${balanceAfter.sol} SOL`);
      console.log(`Claimed amount: ${claimedAmount.toFixed(6)} SOL`);

      return {
        success: true,
        signature,
        claimedAmount: Math.max(0, claimedAmount),
        balanceBefore: balanceBefore.sol,
        balanceAfter: balanceAfter.sol,
        solscanUrl: `https://solscan.io/tx/${signature}`,
      };

    } catch (error) {
      console.error('Error claiming creator fees:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Claim fees and distribute to winners in one operation
   * This is the main method for hourly prize distribution
   * IMPORTANT: Only distributes the amount that was claimed, NOT the entire wallet balance
   */
  async claimAndDistribute(payouts) {
    this.ensureKeypairLoaded();

    if (!creatorKeypair) {
      return { success: false, error: 'Creator wallet not configured' };
    }

    // Step 1: Claim any unclaimed fees first
    console.log('Step 1: Claiming unclaimed fees from PumpFun...');
    const claimResult = await this.claimCreatorFees();

    // Only distribute if we successfully claimed something
    if (!claimResult.success) {
      if (claimResult.noFees) {
        console.log('No fees to claim from PumpFun');
      } else {
        console.log('Claim failed:', claimResult.error);
      }
      return {
        success: false,
        error: claimResult.noFees ? 'No fees to claim' : claimResult.error,
        claim: claimResult,
        totalDistributed: 0,
      };
    }

    // Step 2: Get the claimed amount (this is what we distribute, NOT the wallet balance)
    const claimedAmount = claimResult.claimedAmount || 0;
    console.log(`Claimed ${claimedAmount.toFixed(6)} SOL from PumpFun`);

    if (claimedAmount <= 0.0001) {
      console.log('Claimed amount too small to distribute');
      return {
        success: false,
        error: 'Claimed amount too small to distribute',
        claim: claimResult,
        totalDistributed: 0,
      };
    }

    // Step 3: Calculate payouts based on CLAIMED amount only (not wallet balance)
    const prizePool = claimedAmount;
    const totalHoldings = payouts.reduce((sum, p) => sum + (p.holdings || 0), 0);

    // Recalculate each winner's payout based on their proportion of the claimed prize pool
    const adjustedPayouts = payouts.map(p => ({
      ...p,
      payoutSol: totalHoldings > 0 ? (p.holdings / totalHoldings) * prizePool : 0,
    }));

    console.log(`Step 2: Distributing ${prizePool.toFixed(6)} SOL (claimed fees only) to ${adjustedPayouts.length} winners...`);

    // Step 4: Distribute to winners
    const distributeResult = await this.distributePrizes(adjustedPayouts);

    return {
      success: distributeResult.success,
      claim: claimResult,
      distribution: distributeResult,
      totalDistributed: distributeResult.totalDistributed,
      prizePool: prizePool,
      claimedFromPumpFun: claimedAmount,
    };
  }

  /**
   * Get current prize pool (SOL in bonding curve + estimated unclaimed fees)
   */
  async getPrizePoolAmount() {
    const data = await this.getTokenFeeData();
    if (!data) return 0;

    // The prize pool could be:
    // 1. Estimated unclaimed creator fees (from trading volume)
    // 2. Or a portion of the bonding curve SOL

    // For now, return estimated 1-hour fees in USD, converted to SOL
    const feeEstimateUsd = data.fees?.estimatedFees1h || 0;
    const solPrice = data.trading?.priceUsd ? 1 / data.trading.priceNative : 0;

    // Simple estimate: fees in USD / SOL price
    // This is rough - in production you'd track actual fee accumulation
    const feesInSol = solPrice > 0 ? feeEstimateUsd / (solPrice * 1e9) : 0;

    return {
      estimatedFeesUsd: feeEstimateUsd,
      estimatedFeesSol: feesInSol,
      bondingCurveSol: data.bondingCurve?.realSolReserves || 0,
      volume1h: data.trading?.volume1h || 0,
      volume24h: data.trading?.volume24h || 0,
    };
  }
}

export const pumpfunService = new PumpFunService();
