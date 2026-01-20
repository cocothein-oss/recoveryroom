/**
 * Solana Transfer Service
 * Handles SOL transfers from treasury wallet to winners
 */

import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { decrypt } from './encryption.js';

// Mainnet RPC endpoint
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Minimum balance to keep in treasury for fees and rent (0.005 SOL)
const MIN_TREASURY_BALANCE = 0.005 * LAMPORTS_PER_SOL;
// Fee per transfer instruction (~0.000005 SOL, but we reserve more for safety)
const FEE_PER_TRANSFER = 0.00001 * LAMPORTS_PER_SOL;

class SolanaTransferService {
  constructor() {
    this.connection = new Connection(RPC_ENDPOINT, 'confirmed');
    this.treasuryKeypair = null;
  }

  /**
   * Initialize the treasury wallet from encrypted private key
   */
  async initialize() {
    const encryptedKey = process.env.TREASURY_PRIVATE_KEY_ENCRYPTED;
    const encryptionPassword = process.env.ENCRYPTION_PASSWORD;

    if (!encryptedKey || !encryptionPassword) {
      console.warn('Treasury wallet not configured - transfers disabled');
      return false;
    }

    try {
      // Decrypt the private key
      const privateKeyBase58 = decrypt(encryptedKey, encryptionPassword);
      const privateKeyBytes = bs58.decode(privateKeyBase58);
      this.treasuryKeypair = Keypair.fromSecretKey(privateKeyBytes);

      console.log(`Treasury wallet initialized: ${this.treasuryKeypair.publicKey.toBase58()}`);
      return true;
    } catch (error) {
      console.error('Failed to initialize treasury wallet:', error.message);
      return false;
    }
  }

  /**
   * Get treasury wallet public key
   */
  getTreasuryAddress() {
    if (!this.treasuryKeypair) return null;
    return this.treasuryKeypair.publicKey.toBase58();
  }

  /**
   * Get treasury balance in SOL
   */
  async getTreasuryBalance() {
    if (!this.treasuryKeypair) {
      throw new Error('Treasury wallet not initialized');
    }

    const balance = await this.connection.getBalance(this.treasuryKeypair.publicKey);
    return balance / LAMPORTS_PER_SOL;
  }

  /**
   * Get distributable balance (total minus reserved for fees)
   * @param {number} recipientCount - Expected number of recipients for fee calculation
   */
  async getDistributableBalance(recipientCount = 10) {
    const totalBalance = await this.getTreasuryBalance();
    const reservedForFees = (MIN_TREASURY_BALANCE + (FEE_PER_TRANSFER * recipientCount)) / LAMPORTS_PER_SOL;
    const distributable = Math.max(0, totalBalance - reservedForFees);
    return {
      totalBalance,
      distributable,
      reservedForFees,
    };
  }

  /**
   * Check if treasury has sufficient balance for transfers
   */
  async hasSufficientBalance(amountSol) {
    const balance = await this.getTreasuryBalance();
    const required = amountSol + (MIN_TREASURY_BALANCE / LAMPORTS_PER_SOL);
    return balance >= required;
  }

  /**
   * Transfer SOL to a recipient
   * @param {string} recipientAddress - Recipient wallet address
   * @param {number} amountSol - Amount in SOL
   * @returns {object} - Transaction result
   */
  async transfer(recipientAddress, amountSol) {
    if (!this.treasuryKeypair) {
      throw new Error('Treasury wallet not initialized');
    }

    if (amountSol <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    // Validate recipient address
    let recipientPubkey;
    try {
      recipientPubkey = new PublicKey(recipientAddress);
    } catch {
      throw new Error('Invalid recipient address');
    }

    // Check balance
    const hasFunds = await this.hasSufficientBalance(amountSol);
    if (!hasFunds) {
      const balance = await this.getTreasuryBalance();
      throw new Error(`Insufficient treasury balance. Has ${balance.toFixed(4)} SOL, needs ${amountSol.toFixed(4)} SOL`);
    }

    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    // Create transfer instruction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.treasuryKeypair.publicKey,
        toPubkey: recipientPubkey,
        lamports,
      })
    );

    try {
      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.treasuryKeypair.publicKey;

      // Sign and send
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.treasuryKeypair],
        { commitment: 'confirmed' }
      );

      console.log(`Transfer successful: ${amountSol} SOL to ${recipientAddress}`);
      console.log(`Signature: ${signature}`);

      return {
        success: true,
        signature,
        amount: amountSol,
        recipient: recipientAddress,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Transfer failed:', error);
      throw new Error(`Transfer failed: ${error.message}`);
    }
  }

  /**
   * Atomic batch transfer - ALL transfers in a SINGLE transaction
   * More efficient (single fee) but all-or-nothing
   * @param {Array<{address: string, amount: number}>} transfers - List of transfers
   * @returns {object} - Transaction result
   */
  async atomicBatchTransfer(transfers) {
    if (!this.treasuryKeypair) {
      throw new Error('Treasury wallet not initialized');
    }

    if (transfers.length === 0) {
      throw new Error('No transfers provided');
    }

    // Solana limit: ~20 transfers per transaction (due to size limits)
    if (transfers.length > 20) {
      throw new Error('Maximum 20 transfers per atomic transaction');
    }

    const totalAmount = transfers.reduce((sum, t) => sum + t.amount, 0);

    // Check total balance
    const hasFunds = await this.hasSufficientBalance(totalAmount);
    if (!hasFunds) {
      const balance = await this.getTreasuryBalance();
      throw new Error(`Insufficient treasury balance. Has ${balance.toFixed(4)} SOL, needs ${totalAmount.toFixed(4)} SOL`);
    }

    // Create transaction with multiple transfer instructions
    const transaction = new Transaction();

    for (const { address, amount } of transfers) {
      let recipientPubkey;
      try {
        recipientPubkey = new PublicKey(address);
      } catch {
        throw new Error(`Invalid recipient address: ${address}`);
      }

      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

      transaction.add(
        SystemProgram.transfer({
          fromPubkey: this.treasuryKeypair.publicKey,
          toPubkey: recipientPubkey,
          lamports,
        })
      );
    }

    try {
      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.treasuryKeypair.publicKey;

      // Sign and send single transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.treasuryKeypair],
        { commitment: 'confirmed' }
      );

      console.log(`Atomic batch transfer successful: ${totalAmount} SOL to ${transfers.length} recipients`);
      console.log(`Signature: ${signature}`);

      return {
        success: true,
        signature,
        totalAmount,
        recipientCount: transfers.length,
        transfers: transfers.map(t => ({ address: t.address, amount: t.amount })),
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Atomic batch transfer failed:', error);
      throw new Error(`Atomic batch transfer failed: ${error.message}`);
    }
  }

  /**
   * Batch transfer SOL to multiple recipients (sequential, for >20 recipients)
   * @param {Array<{address: string, amount: number}>} transfers - List of transfers
   * @returns {Array} - Results for each transfer
   */
  async batchTransfer(transfers) {
    if (!this.treasuryKeypair) {
      throw new Error('Treasury wallet not initialized');
    }

    const results = [];
    const totalAmount = transfers.reduce((sum, t) => sum + t.amount, 0);

    // Check total balance first
    const hasFunds = await this.hasSufficientBalance(totalAmount);
    if (!hasFunds) {
      const balance = await this.getTreasuryBalance();
      throw new Error(`Insufficient treasury balance for batch. Has ${balance.toFixed(4)} SOL, needs ${totalAmount.toFixed(4)} SOL`);
    }

    // Process transfers sequentially to avoid nonce issues
    for (const { address, amount } of transfers) {
      try {
        const result = await this.transfer(address, amount);
        results.push(result);

        // Small delay between transfers
        await new Promise(r => setTimeout(r, 500));
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          amount,
          recipient: address,
          timestamp: Date.now(),
        });
      }
    }

    return results;
  }

  /**
   * Distribute prize pool to winners
   * Uses atomic batch (single tx) for ≤20 recipients, sequential for more
   * @param {Array<{walletAddress: string, payoutSol: number}>} payouts - Winner payouts
   * @returns {object} - Distribution results
   */
  async distributePrizes(payouts) {
    if (!this.treasuryKeypair) {
      return {
        success: false,
        error: 'Treasury wallet not configured',
        results: [],
      };
    }

    // Filter out zero/negative amounts
    const validPayouts = payouts.filter(p => p.payoutSol > 0);

    if (validPayouts.length === 0) {
      return {
        success: true,
        totalTransferred: 0,
        recipientCount: 0,
        message: 'No valid payouts to process',
      };
    }

    const transfers = validPayouts.map(p => ({
      address: p.walletAddress,
      amount: p.payoutSol,
    }));

    try {
      // Use atomic batch transfer for ≤20 recipients (single transaction)
      if (transfers.length <= 20) {
        console.log(`Using atomic batch transfer for ${transfers.length} recipients`);
        const result = await this.atomicBatchTransfer(transfers);
        return {
          success: true,
          signature: result.signature,
          totalTransferred: result.totalAmount,
          recipientCount: result.recipientCount,
          transfers: result.transfers,
          atomic: true,
        };
      }

      // For >20 recipients, use sequential transfers
      console.log(`Using sequential transfers for ${transfers.length} recipients`);
      const results = await this.batchTransfer(transfers);

      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      return {
        success: failed.length === 0,
        totalTransferred: successful.reduce((sum, r) => sum + r.amount, 0),
        successCount: successful.length,
        failedCount: failed.length,
        results,
        atomic: false,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        results: [],
      };
    }
  }
}

// Export singleton instance
export const solanaTransfer = new SolanaTransferService();
