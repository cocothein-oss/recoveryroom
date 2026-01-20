/**
 * VRF Crank Service
 * Automatically triggers VRF requests when rounds end
 *
 * In production, this should run as a separate service or use:
 * - Clockwork (Solana automation)
 * - AWS Lambda / GCP Cloud Functions
 * - Dedicated crank server
 */

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  RPC_ENDPOINT: process.env.SOL_RPC_ENDPOINT || 'https://api.devnet.solana.com',
  PROGRAM_ID: 'RecovRoomVRF111111111111111111111111111111',
  CRANK_INTERVAL_MS: 30000, // Check every 30 seconds

  // Switchboard Devnet addresses
  ORACLE_QUEUE: 'uPeihMuj5Ehn6WS8L5HJuKDd5DXXWATM3hQi6Ykx4SE',
  QUEUE_AUTHORITY: '2KgowxogBrGqRcgXQEmqFvC3PGtCu66qERNJevYW8Ajh',
  PROGRAM_STATE: 'sbattyXrzedoNATfc4L31wC9Mhxsi3BmQ4xhomdpZj3',
};

// IDL import (simplified for crank)
const IDL = {
  version: "0.1.0",
  name: "recovery_room",
  instructions: [
    {
      name: "requestRandomness",
      accounts: [
        { name: "protocolState", isMut: true, isSigner: false },
        { name: "roundState", isMut: true, isSigner: false },
        { name: "vrf", isMut: true, isSigner: false },
        { name: "oracleQueue", isMut: true, isSigner: false },
        { name: "queueAuthority", isMut: false, isSigner: false },
        { name: "dataBuffer", isMut: true, isSigner: false },
        { name: "permission", isMut: false, isSigner: false },
        { name: "escrow", isMut: true, isSigner: false },
        { name: "payerWallet", isMut: true, isSigner: false },
        { name: "payer", isMut: true, isSigner: true },
        { name: "recentBlockhashes", isMut: false, isSigner: false },
        { name: "switchboardProgramState", isMut: false, isSigner: false },
        { name: "switchboardProgram", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "startRound",
      accounts: [
        { name: "protocolState", isMut: true, isSigner: false },
        { name: "roundState", isMut: true, isSigner: false },
        { name: "previousRound", isMut: false, isSigner: false, isOptional: true },
        { name: "payer", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
  ],
  accounts: [],
};

class VrfCrankService {
  constructor() {
    this.connection = new Connection(CONFIG.RPC_ENDPOINT, 'confirmed');
    this.programId = new PublicKey(CONFIG.PROGRAM_ID);
    this.crankWallet = null;
    this.program = null;
    this.isRunning = false;
  }

  /**
   * Initialize the crank with a keypair
   */
  async initialize(keypairPath) {
    try {
      // Load crank wallet keypair
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
      this.crankWallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));

      console.log(`Crank wallet: ${this.crankWallet.publicKey.toBase58()}`);

      // Check balance
      const balance = await this.connection.getBalance(this.crankWallet.publicKey);
      console.log(`Crank balance: ${balance / 1e9} SOL`);

      if (balance < 0.1 * 1e9) {
        console.warn('WARNING: Low crank balance! Top up to ensure VRF requests can be processed.');
      }

      // Initialize Anchor program
      const wallet = {
        publicKey: this.crankWallet.publicKey,
        signTransaction: async (tx) => {
          tx.partialSign(this.crankWallet);
          return tx;
        },
        signAllTransactions: async (txs) => {
          return txs.map(tx => {
            tx.partialSign(this.crankWallet);
            return tx;
          });
        },
      };

      const provider = new AnchorProvider(this.connection, wallet, { commitment: 'confirmed' });
      this.program = new Program(IDL, this.programId, provider);

      console.log('VRF Crank Service initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize crank:', error);
      return false;
    }
  }

  /**
   * Get Protocol PDA
   */
  getProtocolPDA() {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('protocol')],
      this.programId
    );
  }

  /**
   * Get Round PDA
   */
  getRoundPDA(roundId) {
    const roundIdBuffer = Buffer.alloc(8);
    roundIdBuffer.writeBigUInt64LE(BigInt(roundId));
    return PublicKey.findProgramAddressSync(
      [Buffer.from('round'), roundIdBuffer],
      this.programId
    );
  }

  /**
   * Check if current round has ended and needs VRF
   */
  async checkAndProcessRound() {
    try {
      const [protocolPda] = this.getProtocolPDA();

      // Fetch protocol state
      let protocolAccount;
      try {
        protocolAccount = await this.program.account.protocolState.fetch(protocolPda);
      } catch {
        console.log('Protocol not initialized yet');
        return;
      }

      const currentRoundId = protocolAccount.currentRound.toNumber();
      if (currentRoundId === 0) {
        console.log('No active round');
        return;
      }

      const [roundPda] = this.getRoundPDA(currentRoundId);
      const roundAccount = await this.program.account.roundState.fetch(roundPda);

      const now = Date.now();
      const endTime = roundAccount.endTime.toNumber() * 1000;
      const status = Object.keys(roundAccount.status)[0];

      console.log(`Round ${currentRoundId}: status=${status}, ends=${new Date(endTime).toISOString()}`);

      // Check if round has ended and is still active
      if (now >= endTime && status === 'active') {
        console.log(`Round ${currentRoundId} ended! Triggering VRF request...`);
        await this.requestVrf(currentRoundId);
      }

      // Check if VRF has been fulfilled and we need to consume it
      if (status === 'vrfRequested') {
        console.log(`Round ${currentRoundId} waiting for VRF fulfillment...`);
        // VRF consumption is handled by Switchboard callback
        // But we can check and manually trigger if needed
      }

      // Check if round is complete and we need to start a new one
      if (status === 'complete') {
        console.log(`Round ${currentRoundId} complete. Starting new round...`);
        await this.startNewRound();
      }

    } catch (error) {
      console.error('Error processing round:', error);
    }
  }

  /**
   * Request VRF for ended round
   */
  async requestVrf(roundId) {
    try {
      console.log(`Requesting VRF for round ${roundId}...`);

      const [protocolPda] = this.getProtocolPDA();
      const [roundPda] = this.getRoundPDA(roundId);

      // Note: In production, you'd need to set up proper Switchboard accounts
      // This is a simplified version showing the structure

      // For now, emit an event that the frontend can listen to
      console.log('VRF_REQUEST_NEEDED:', {
        roundId,
        roundPda: roundPda.toBase58(),
        timestamp: Date.now(),
      });

      // The actual VRF request would look like:
      /*
      await this.program.methods
        .requestRandomness()
        .accounts({
          protocolState: protocolPda,
          roundState: roundPda,
          vrf: vrfAccountPubkey,
          oracleQueue: new PublicKey(CONFIG.ORACLE_QUEUE),
          queueAuthority: new PublicKey(CONFIG.QUEUE_AUTHORITY),
          // ... other Switchboard accounts
        })
        .signers([this.crankWallet])
        .rpc();
      */

      return true;
    } catch (error) {
      console.error('Failed to request VRF:', error);
      return false;
    }
  }

  /**
   * Start a new round after previous completes
   */
  async startNewRound() {
    try {
      console.log('Starting new round...');

      const [protocolPda] = this.getProtocolPDA();
      const protocolAccount = await this.program.account.protocolState.fetch(protocolPda);
      const nextRoundId = protocolAccount.currentRound.toNumber() + 1;
      const [roundPda] = this.getRoundPDA(nextRoundId);

      // Previous round PDA (if any)
      const prevRoundId = protocolAccount.currentRound.toNumber();
      const [prevRoundPda] = prevRoundId > 0 ? this.getRoundPDA(prevRoundId) : [null];

      console.log('START_ROUND_NEEDED:', {
        nextRoundId,
        roundPda: roundPda.toBase58(),
        timestamp: Date.now(),
      });

      return true;
    } catch (error) {
      console.error('Failed to start new round:', error);
      return false;
    }
  }

  /**
   * Start the crank loop
   */
  start() {
    if (this.isRunning) {
      console.log('Crank already running');
      return;
    }

    this.isRunning = true;
    console.log(`Starting VRF Crank loop (interval: ${CONFIG.CRANK_INTERVAL_MS}ms)`);

    // Initial check
    this.checkAndProcessRound();

    // Start interval
    this.intervalId = setInterval(() => {
      this.checkAndProcessRound();
    }, CONFIG.CRANK_INTERVAL_MS);
  }

  /**
   * Stop the crank loop
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('VRF Crank stopped');
  }
}

// Export singleton
export const vrfCrank = new VrfCrankService();

// CLI entry point
const runCli = async () => {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
VRF Crank Service - Recovery Room

Usage:
  node vrfCrank.js [options]

Options:
  --keypair <path>    Path to crank wallet keypair JSON
  --help              Show this help message

Environment Variables:
  SOL_RPC_ENDPOINT    Solana RPC endpoint (default: devnet)
`);
    process.exit(0);
  }

  const keypairIndex = args.indexOf('--keypair');
  const keypairPath = keypairIndex >= 0 ? args[keypairIndex + 1] : null;

  if (!keypairPath) {
    console.log('Demo mode: No keypair provided. Crank will only monitor, not execute transactions.');
    console.log('Provide --keypair to enable transaction execution.');
  }

  if (keypairPath) {
    const initialized = await vrfCrank.initialize(keypairPath);
    if (!initialized) {
      console.error('Failed to initialize crank');
      process.exit(1);
    }
  }

  vrfCrank.start();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    vrfCrank.stop();
    process.exit(0);
  });
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}
