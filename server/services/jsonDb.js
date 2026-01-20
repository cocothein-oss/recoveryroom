/**
 * JSON File Database Service
 * Simple file-based database with safe read/write operations
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const ROUND_DURATION = 60 * 60 * 1000; // 1 hour

// In-memory locks to prevent concurrent writes
const fileLocks = new Map();

/**
 * Acquire a lock for a file
 */
async function acquireLock(filePath) {
  while (fileLocks.get(filePath)) {
    await new Promise(r => setTimeout(r, 10));
  }
  fileLocks.set(filePath, true);
}

/**
 * Release a lock for a file
 */
function releaseLock(filePath) {
  fileLocks.delete(filePath);
}

/**
 * Safely read a JSON file
 */
async function readJsonFile(filePath, defaultValue = null) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return defaultValue;
    }
    console.error(`Error reading ${filePath}:`, error);
    return defaultValue;
  }
}

/**
 * Safely write a JSON file with locking
 */
async function writeJsonFile(filePath, data) {
  await acquireLock(filePath);
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } finally {
    releaseLock(filePath);
  }
}

// ============ User Operations ============

/**
 * Get user data by wallet address
 */
export async function getUser(walletAddress) {
  const filePath = path.join(DATA_DIR, 'users', `${walletAddress}.json`);
  return await readJsonFile(filePath, null);
}

/**
 * Save user data
 */
export async function saveUser(walletAddress, userData) {
  const filePath = path.join(DATA_DIR, 'users', `${walletAddress}.json`);
  await writeJsonFile(filePath, {
    walletAddress,
    ...userData,
    updatedAt: Date.now(),
  });
}

/**
 * Get user's cached wallet analysis
 */
export async function getUserCache(walletAddress) {
  const user = await getUser(walletAddress);
  if (!user || !user.analyzedTokens) return null;

  // Check if cache is valid (30 minutes)
  const CACHE_DURATION = 30 * 60 * 1000;
  if (Date.now() - user.lastAnalyzedAt > CACHE_DURATION) {
    return null;
  }

  return {
    tokens: user.analyzedTokens,
    swapCount: user.swapCount || 0,
    lastAnalyzedAt: user.lastAnalyzedAt,
    noValidTokens: user.noValidTokens || false,
  };
}

/**
 * Save user's wallet analysis cache
 */
export async function saveUserCache(walletAddress, tokens, swapCount, noValidTokens = false) {
  const user = await getUser(walletAddress) || { walletAddress };
  await saveUser(walletAddress, {
    ...user,
    analyzedTokens: tokens,
    swapCount,
    lastAnalyzedAt: Date.now(),
    noValidTokens,
  });
}

// ============ Round Operations ============

/**
 * Get current round info
 */
export async function getCurrentRound() {
  const filePath = path.join(DATA_DIR, 'current_round.json');
  let round = await readJsonFile(filePath, null);

  // Create new round if none exists or expired
  if (!round || Date.now() >= round.endTime) {
    round = await createNewRound();
  }

  return round;
}

/**
 * Create a new round aligned to hour boundaries
 */
async function createNewRound() {
  const now = Date.now();
  const hourStart = Math.floor(now / ROUND_DURATION) * ROUND_DURATION;

  const round = {
    roundId: Math.floor(hourStart / ROUND_DURATION),
    startTime: hourStart,
    endTime: hourStart + ROUND_DURATION,
    createdAt: now,
  };

  const filePath = path.join(DATA_DIR, 'current_round.json');
  await writeJsonFile(filePath, round);

  // Also initialize round entries file
  const entriesPath = path.join(DATA_DIR, 'rounds', `round_${round.roundId}.json`);
  const existingEntries = await readJsonFile(entriesPath, null);
  if (!existingEntries) {
    await writeJsonFile(entriesPath, {
      roundId: round.roundId,
      entries: [],
      poolStats: [],
    });
  }

  console.log(`Created new round: ${round.roundId}`);
  return round;
}

/**
 * Get time remaining in current round (seconds)
 */
export async function getTimeRemaining() {
  const round = await getCurrentRound();
  const remaining = Math.max(0, round.endTime - Date.now());
  return Math.floor(remaining / 1000);
}

/**
 * Force reset round with fresh 1-hour timer (for testing)
 */
export async function forceNewRound() {
  const now = Date.now();
  const newRoundId = Math.floor(now / 1000); // Use timestamp as unique ID

  const round = {
    roundId: newRoundId,
    startTime: now,
    endTime: now + ROUND_DURATION, // Full 1 hour from now
    createdAt: now,
  };

  const filePath = path.join(DATA_DIR, 'current_round.json');
  await writeJsonFile(filePath, round);

  // Initialize round entries file
  const entriesPath = path.join(DATA_DIR, 'rounds', `round_${round.roundId}.json`);
  await writeJsonFile(entriesPath, {
    roundId: round.roundId,
    entries: [],
    poolStats: [],
  });

  console.log(`Force created new round: ${round.roundId} (1 hour timer started)`);
  return round;
}

// ============ Participation Operations ============

/**
 * Check if user has participated in current round
 */
export async function hasParticipated(walletAddress) {
  const round = await getCurrentRound();
  const user = await getUser(walletAddress);

  if (!user || !user.currentRoundParticipation) return false;
  return user.currentRoundParticipation.roundId === round.roundId;
}

/**
 * Get user's participated tokens for current round
 */
export async function getParticipatedTokens(walletAddress) {
  const round = await getCurrentRound();
  const user = await getUser(walletAddress);

  if (!user || !user.currentRoundParticipation) return [];
  if (user.currentRoundParticipation.roundId !== round.roundId) return [];

  return user.currentRoundParticipation.tokens || [];
}

/**
 * Record user participation
 */
export async function recordParticipation(walletAddress, tokens) {
  const round = await getCurrentRound();
  const user = await getUser(walletAddress) || { walletAddress };

  await saveUser(walletAddress, {
    ...user,
    currentRoundParticipation: {
      roundId: round.roundId,
      tokens,
      timestamp: Date.now(),
    },
  });
}

/**
 * Atomic participation - checks and records in one operation to prevent race conditions
 * Returns { success: true } or { success: false, error: string }
 */
export async function participateAtomic(walletAddress, tokens) {
  const round = await getCurrentRound();
  const user = await getUser(walletAddress) || { walletAddress, participationCount: 0 };

  // Check if already participated in this round
  if (user.currentRoundParticipation && user.currentRoundParticipation.roundId === round.roundId) {
    return { success: false, error: 'Already participated in this round' };
  }

  // Record participation atomically and increment count
  await saveUser(walletAddress, {
    ...user,
    participationCount: (user.participationCount || 0) + 1,
    currentRoundParticipation: {
      roundId: round.roundId,
      tokens: tokens.map(t => t.id || t.tokenAddress),
      timestamp: Date.now(),
    },
  });

  return { success: true };
}

// ============ Live Entries Operations ============

/**
 * Get live entries for current round
 */
export async function getLiveEntries() {
  const round = await getCurrentRound();
  const filePath = path.join(DATA_DIR, 'rounds', `round_${round.roundId}.json`);
  const data = await readJsonFile(filePath, { entries: [] });
  return data.entries || [];
}

/**
 * Add a live entry
 */
export async function addLiveEntry(entry) {
  const round = await getCurrentRound();
  const filePath = path.join(DATA_DIR, 'rounds', `round_${round.roundId}.json`);

  await acquireLock(filePath);
  try {
    const data = await readJsonFile(filePath, { roundId: round.roundId, entries: [], poolStats: [] });

    // Add new entry at the beginning
    data.entries = [entry, ...data.entries].slice(0, 100);

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return data.entries;
  } finally {
    releaseLock(filePath);
  }
}

// ============ Pool Stats Operations ============

/**
 * Get pool stats for current round
 */
export async function getPoolStats() {
  const round = await getCurrentRound();
  const filePath = path.join(DATA_DIR, 'rounds', `round_${round.roundId}.json`);
  const data = await readJsonFile(filePath, { poolStats: [] });
  return data.poolStats || [];
}

/**
 * Update pool stats
 */
export async function updatePoolToken(ticker, tokenAddress, color) {
  const round = await getCurrentRound();
  const filePath = path.join(DATA_DIR, 'rounds', `round_${round.roundId}.json`);

  await acquireLock(filePath);
  try {
    const data = await readJsonFile(filePath, { roundId: round.roundId, entries: [], poolStats: [] });

    const existingIndex = data.poolStats.findIndex(p => p.ticker === ticker);
    if (existingIndex >= 0) {
      data.poolStats[existingIndex].subCount += 1;
    } else {
      data.poolStats.push({
        ticker,
        tokenAddress,
        subCount: 1,
        color,
      });
    }

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return data.poolStats;
  } finally {
    releaseLock(filePath);
  }
}

// ============ Round Results & Prize Distribution ============

/**
 * Complete a round and distribute prizes
 */
export async function completeRound(roundId, winnerTicker, vrfResult, prizePoolSol) {
  const filePath = path.join(DATA_DIR, 'rounds', `round_${roundId}.json`);

  await acquireLock(filePath);
  try {
    const data = await readJsonFile(filePath, null);
    if (!data) {
      throw new Error(`Round ${roundId} not found`);
    }

    // Find all entries for the winning token
    const winningEntries = data.entries.filter(e => e.lossTicker === winnerTicker);

    if (winningEntries.length === 0) {
      data.result = {
        winnerTicker,
        vrfResult,
        prizePoolSol,
        completedAt: Date.now(),
        payouts: [],
        totalWinners: 0,
      };
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      return data.result;
    }

    // Calculate total holdings for proportional distribution
    const totalHoldings = winningEntries.reduce((sum, e) => sum + e.heldAmount, 0);

    // Calculate payouts proportionally based on holdings
    const payouts = winningEntries.map(entry => {
      const proportion = entry.heldAmount / totalHoldings;
      const payoutSol = prizePoolSol * proportion;

      return {
        walletAddress: entry.walletAddress,
        ticker: entry.lossTicker,
        holdings: entry.heldAmount,
        proportion: proportion,
        payoutSol: payoutSol,
        timestamp: Date.now(),
      };
    });

    // Store round result
    data.result = {
      winnerTicker,
      vrfResult,
      prizePoolSol,
      completedAt: Date.now(),
      payouts,
      totalWinners: payouts.length,
      totalHoldings,
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');

    // Update user winnings
    for (const payout of payouts) {
      await addUserWinning(payout.walletAddress, {
        roundId,
        ticker: payout.ticker,
        payoutSol: payout.payoutSol,
        proportion: payout.proportion,
        timestamp: payout.timestamp,
      });
    }

    return data.result;
  } finally {
    releaseLock(filePath);
  }
}

/**
 * Get round result
 */
export async function getRoundResult(roundId) {
  const filePath = path.join(DATA_DIR, 'rounds', `round_${roundId}.json`);
  const data = await readJsonFile(filePath, null);
  return data?.result || null;
}

/**
 * Add winning to user's history
 */
export async function addUserWinning(walletAddress, winning) {
  const user = await getUser(walletAddress) || { walletAddress };

  const winnings = user.winnings || [];
  winnings.unshift(winning);

  // Keep last 100 winnings
  const trimmedWinnings = winnings.slice(0, 100);

  // Update total winnings
  const totalWinningsSol = trimmedWinnings.reduce((sum, w) => sum + w.payoutSol, 0);

  await saveUser(walletAddress, {
    ...user,
    winnings: trimmedWinnings,
    totalWinningsSol,
  });
}

/**
 * Get user's total winnings
 */
export async function getUserWinnings(walletAddress) {
  const user = await getUser(walletAddress);
  return {
    totalWinningsSol: user?.totalWinningsSol || 0,
    winnings: user?.winnings || [],
  };
}

/**
 * Get current prize pool (for testing, returns fixed 10 SOL)
 */
export async function getPrizePool() {
  // In production, this would calculate from actual deposits
  return {
    amountSol: 10,
    currency: 'SOL',
  };
}

// ============ Swap Data Storage (for fast scanning) ============

/**
 * Save processed swap data for a wallet (for instant retrieval on repeat scans)
 */
export async function saveSwapData(walletAddress, swapData) {
  const filePath = path.join(DATA_DIR, 'swaps', `${walletAddress}.json`);

  await acquireLock(filePath);
  try {
    // Ensure swaps directory exists
    await fs.mkdir(path.join(DATA_DIR, 'swaps'), { recursive: true });

    const data = {
      walletAddress,
      swaps: swapData.swaps,
      positions: swapData.positions,
      lastUpdated: Date.now(),
      txCount: swapData.swaps?.length || 0,
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Saved ${data.txCount} swaps for ${walletAddress}`);
  } finally {
    releaseLock(filePath);
  }
}

/**
 * Get stored swap data for a wallet
 */
export async function getSwapData(walletAddress) {
  const filePath = path.join(DATA_DIR, 'swaps', `${walletAddress}.json`);
  const data = await readJsonFile(filePath, null);

  if (!data) return null;

  // Check if data is stale (older than 1 hour)
  const maxAge = 60 * 60 * 1000; // 1 hour
  if (Date.now() - data.lastUpdated > maxAge) {
    return null; // Return null to trigger fresh scan
  }

  return data;
}

// ============ Transfer History & Logging ============

/**
 * Store transfer result for a completed round
 */
export async function storeTransferResult(roundId, transferResult) {
  const filePath = path.join(DATA_DIR, 'rounds', `round_${roundId}.json`);

  await acquireLock(filePath);
  try {
    const data = await readJsonFile(filePath, null);
    if (!data || !data.result) {
      throw new Error(`Round ${roundId} result not found`);
    }

    // Add transfer details to round result
    data.result.transfer = {
      success: transferResult.success,
      signature: transferResult.signature || null,
      totalTransferred: transferResult.totalTransferred || 0,
      transferredAt: Date.now(),
      error: transferResult.error || null,
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Stored transfer result for round ${roundId}`);

    return data.result;
  } finally {
    releaseLock(filePath);
  }
}

/**
 * Update user winnings with transaction signature
 */
export async function updateUserWinningWithTx(walletAddress, roundId, signature) {
  const user = await getUser(walletAddress);
  if (!user || !user.winnings) return;

  const winnings = user.winnings.map(w => {
    if (w.roundId === roundId) {
      return { ...w, txSignature: signature, transferredAt: Date.now() };
    }
    return w;
  });

  await saveUser(walletAddress, { ...user, winnings });
}

/**
 * Log transfer to persistent transfer history
 */
export async function logTransfer(transferData) {
  const filePath = path.join(DATA_DIR, 'transfer_history.json');

  await acquireLock(filePath);
  try {
    const history = await readJsonFile(filePath, { transfers: [] });

    const logEntry = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      roundId: transferData.roundId,
      signature: transferData.signature,
      totalAmount: transferData.totalAmount,
      recipientCount: transferData.recipientCount,
      recipients: transferData.recipients, // Array of { wallet, amount }
      success: transferData.success,
      error: transferData.error || null,
      timestamp: Date.now(),
    };

    history.transfers.unshift(logEntry);

    // Keep last 1000 transfers
    history.transfers = history.transfers.slice(0, 1000);

    await fs.writeFile(filePath, JSON.stringify(history, null, 2), 'utf8');
    console.log(`Logged transfer: ${logEntry.id}`);

    return logEntry;
  } finally {
    releaseLock(filePath);
  }
}

/**
 * Get transfer history
 */
export async function getTransferHistory(limit = 100) {
  const filePath = path.join(DATA_DIR, 'transfer_history.json');
  const history = await readJsonFile(filePath, { transfers: [] });
  return history.transfers.slice(0, limit);
}

/**
 * Get round history (completed rounds with results)
 */
export async function getRoundHistory(limit = 50) {
  const roundsDir = path.join(DATA_DIR, 'rounds');

  try {
    const files = await fs.readdir(roundsDir).catch(() => []);

    // Filter round files and sort by round ID descending
    const roundFiles = files
      .filter(f => f.startsWith('round_') && f.endsWith('.json'))
      .map(f => ({
        file: f,
        roundId: parseInt(f.replace('round_', '').replace('.json', '')),
      }))
      .sort((a, b) => b.roundId - a.roundId)
      .slice(0, limit);

    const rounds = [];
    for (const { file, roundId } of roundFiles) {
      const filePath = path.join(roundsDir, file);
      const data = await readJsonFile(filePath, null);

      if (data && data.result) {
        rounds.push({
          roundId: data.roundId,
          winnerTicker: data.result.winnerTicker,
          prizePoolSol: data.result.prizePoolSol || 0,
          totalWinners: data.result.totalWinners || 0,
          totalHoldings: data.result.totalHoldings || 0,
          completedAt: data.result.completedAt,
          vrfResult: data.result.vrfResult,
          txSignature: data.result.transfer?.signature || null,
          participantCount: data.entries?.length || 0,
          tokenCount: data.poolStats?.length || 0,
        });
      }
    }

    return rounds;
  } catch (error) {
    console.error('Error getting round history:', error);
    return [];
  }
}

/**
 * Get platform-wide statistics
 */
export async function getPlatformStats() {
  const usersDir = path.join(DATA_DIR, 'users');
  const roundsDir = path.join(DATA_DIR, 'rounds');

  try {
    // Count users with participation history or winnings
    const userFiles = await fs.readdir(usersDir).catch(() => []);
    let totalWinners = 0;
    const uniqueParticipants = new Set();

    for (const file of userFiles) {
      if (file.endsWith('.json')) {
        const filePath = path.join(usersDir, file);
        const user = await readJsonFile(filePath, null);
        if (user) {
          // Count users who have ever participated (have participationCount or winnings)
          if (user.participationCount > 0 || (user.winnings && user.winnings.length > 0)) {
            uniqueParticipants.add(user.walletAddress);
          }
          if (user.winnings && user.winnings.length > 0) {
            totalWinners++;
          }
        }
      }
    }

    // Also count unique participants from completed rounds
    const roundFiles = await fs.readdir(roundsDir).catch(() => []);
    let totalSolDistributed = 0;
    let completedRounds = 0;

    for (const file of roundFiles) {
      if (file.startsWith('round_') && file.endsWith('.json')) {
        const filePath = path.join(roundsDir, file);
        const round = await readJsonFile(filePath, null);
        if (round) {
          // Count unique participants from round entries
          if (round.entries && round.entries.length > 0) {
            for (const entry of round.entries) {
              if (entry.walletAddress) {
                uniqueParticipants.add(entry.walletAddress);
              }
            }
          }
          // Count completed rounds and SOL distributed
          if (round.result) {
            completedRounds++;
            totalSolDistributed += round.result.prizePoolSol || 0;
          }
        }
      }
    }

    return {
      totalParticipants: uniqueParticipants.size,
      totalWinners,
      totalSolDistributed,
      completedRounds,
    };
  } catch (error) {
    console.error('Error getting platform stats:', error);
    return {
      totalParticipants: 0,
      totalWinners: 0,
      totalSolDistributed: 0,
      completedRounds: 0,
    };
  }
}

/**
 * Get leaderboard data
 * @param {string} type - 'comeback' (by total SOL won) or 'god' (by win count)
 * @param {number} limit - Number of entries to return
 */
export async function getLeaderboard(type = 'comeback', limit = 20) {
  const usersDir = path.join(DATA_DIR, 'users');

  try {
    const userFiles = await fs.readdir(usersDir).catch(() => []);
    const users = [];

    for (const file of userFiles) {
      if (file.endsWith('.json')) {
        const filePath = path.join(usersDir, file);
        const user = await readJsonFile(filePath, null);

        if (user && user.winnings && user.winnings.length > 0) {
          const totalWinnings = user.totalWinningsSol || 0;
          const winCount = user.winnings.length;

          // Calculate win streak (consecutive wins from most recent)
          let winStreak = 0;
          const sortedWinnings = [...user.winnings].sort((a, b) => b.timestamp - a.timestamp);
          for (const win of sortedWinnings) {
            if (win.payoutSol > 0) {
              winStreak++;
            } else {
              break;
            }
          }

          users.push({
            walletAddress: user.walletAddress,
            totalWinningsSol: totalWinnings,
            winCount: winCount,
            winStreak: winStreak,
            lastWinTimestamp: sortedWinnings[0]?.timestamp || 0,
          });
        }
      }
    }

    // Sort based on type
    if (type === 'comeback') {
      // Sort by total SOL won (descending)
      users.sort((a, b) => b.totalWinningsSol - a.totalWinningsSol);
    } else if (type === 'god') {
      // Sort by win count, then by total winnings as tiebreaker
      users.sort((a, b) => {
        if (b.winCount !== a.winCount) {
          return b.winCount - a.winCount;
        }
        return b.totalWinningsSol - a.totalWinningsSol;
      });
    }

    return users.slice(0, limit);
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    return [];
  }
}

/**
 * Reset for new round - clears participation but PRESERVES historical data
 * - Preserves: transfer_history.json, completed round results, user winnings
 * - Clears: current round participation, live entries, pool stats
 */
export async function resetForNewRound() {
  const usersDir = path.join(DATA_DIR, 'users');

  try {
    // Clear only currentRoundParticipation from users, keep winnings
    const userFiles = await fs.readdir(usersDir).catch(() => []);
    for (const file of userFiles) {
      if (file.endsWith('.json')) {
        const filePath = path.join(usersDir, file);
        const user = await readJsonFile(filePath, null);
        if (user) {
          // Keep winnings, clear only participation
          user.currentRoundParticipation = null;
          await writeJsonFile(filePath, user);
        }
      }
    }

    // Delete current_round.json (will create new one)
    await fs.unlink(path.join(DATA_DIR, 'current_round.json')).catch(() => {});

    // NOTE: We do NOT delete:
    // - transfer_history.json (audit trail)
    // - Completed round files (historical data for stats)

    console.log('Reset for new round (preserved historical data)');
  } catch (error) {
    console.error('Error resetting for new round:', error);
  }
}

/**
 * Clear ALL data (complete reset for testing)
 */
export async function clearAllData() {
  const usersDir = path.join(DATA_DIR, 'users');
  const roundsDir = path.join(DATA_DIR, 'rounds');

  try {
    const userFiles = await fs.readdir(usersDir).catch(() => []);
    for (const file of userFiles) {
      await fs.unlink(path.join(usersDir, file));
    }

    const roundFiles = await fs.readdir(roundsDir).catch(() => []);
    for (const file of roundFiles) {
      await fs.unlink(path.join(roundsDir, file));
    }

    await fs.unlink(path.join(DATA_DIR, 'current_round.json')).catch(() => {});
    // Also clear transfer history on full reset
    await fs.unlink(path.join(DATA_DIR, 'transfer_history.json')).catch(() => {});

    console.log('Cleared ALL data (complete reset)');
  } catch (error) {
    console.error('Error clearing data:', error);
  }
}
