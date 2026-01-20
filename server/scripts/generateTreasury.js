#!/usr/bin/env node
/**
 * Generate Treasury Wallet Script
 * Creates a new Solana wallet and encrypts the private key
 * Run: node server/scripts/generateTreasury.js
 */

import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

function encrypt(plaintext, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([
    salt,
    iv,
    authTag,
    Buffer.from(encrypted, 'hex')
  ]);

  return combined.toString('base64');
}

function generatePassword(length = 32) {
  return crypto.randomBytes(length).toString('base64');
}

// Generate new keypair
const keypair = Keypair.generate();
const publicKey = keypair.publicKey.toBase58();
const privateKeyBase58 = bs58.encode(keypair.secretKey);

// Generate encryption password
const encryptionPassword = generatePassword();

// Encrypt the private key
const encryptedPrivateKey = encrypt(privateKeyBase58, encryptionPassword);

// Generate admin key
const adminKey = generatePassword(24);

console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
console.log('║           RECOVERY ROOM TREASURY WALLET GENERATED                 ║');
console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

console.log('═══════════════════════════════════════════════════════════════════');
console.log('  PUBLIC ADDRESS (Deposit SOL here):');
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`\n  ${publicKey}\n`);

console.log('═══════════════════════════════════════════════════════════════════');
console.log('  BACKUP PRIVATE KEY (Store securely, NEVER share):');
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`\n  ${privateKeyBase58}\n`);

// Create .env file content
const envContent = `# Recovery Room Server Configuration
# Generated: ${new Date().toISOString()}

# Server port
PORT=3002

# Solana RPC endpoint
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Treasury wallet (encrypted)
TREASURY_PRIVATE_KEY_ENCRYPTED=${encryptedPrivateKey}
ENCRYPTION_PASSWORD=${encryptionPassword}

# Admin key for protected endpoints
ADMIN_KEY=${adminKey}

# Prize pool settings (in SOL)
PRIZE_POOL_SOL=10
`;

// Write .env file
const envPath = path.join(process.cwd(), 'server', '.env');
fs.writeFileSync(envPath, envContent);

console.log('═══════════════════════════════════════════════════════════════════');
console.log('  .env FILE CREATED at server/.env');
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`\n  Admin Key: ${adminKey}\n`);

console.log('═══════════════════════════════════════════════════════════════════');
console.log('  NEXT STEPS:');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('\n  1. Send SOL to the public address above');
console.log('  2. Restart the server: npm run server');
console.log('  3. Treasury status will show CONFIGURED\n');

console.log('═══════════════════════════════════════════════════════════════════');
console.log('  SECURITY REMINDERS:');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('\n  - BACKUP the private key shown above');
console.log('  - NEVER commit server/.env to git');
console.log('  - Keep the admin key secret\n');
