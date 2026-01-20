#!/usr/bin/env node
/**
 * Encrypt Private Key Script
 * Run: node server/scripts/encryptKey.js
 *
 * This will prompt for your private key and encryption password,
 * then output the encrypted value to add to your .env file.
 */

import crypto from 'crypto';
import readline from 'readline';

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log('\n=== Recovery Room Private Key Encryption ===\n');
  console.log('This tool will encrypt your Solana private key for secure storage.\n');

  const privateKey = await question('Enter your Solana private key (base58): ');

  if (!privateKey || privateKey.length < 40) {
    console.error('\nError: Invalid private key format');
    process.exit(1);
  }

  let password = await question('Enter encryption password (or press Enter to generate one): ');

  if (!password) {
    password = generatePassword();
    console.log(`\nGenerated password: ${password}`);
  }

  const encrypted = encrypt(privateKey, password);

  console.log('\n=== Add these to your .env file ===\n');
  console.log(`TREASURY_PRIVATE_KEY_ENCRYPTED=${encrypted}`);
  console.log(`ENCRYPTION_PASSWORD=${password}`);
  console.log('\n=== IMPORTANT ===');
  console.log('1. Never commit .env to git');
  console.log('2. Keep a backup of your original private key');
  console.log('3. Store the encryption password separately from the encrypted key');
  console.log('');

  rl.close();
}

main().catch(console.error);
