/**
 * API Routes for Recovery Room
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PublicKey } from '@solana/web3.js';
import * as db from '../services/jsonDb.js';
import { solanaTransfer } from '../services/solanaTransfer.js';
import { broadcastSpinStart, broadcastSpinResult, broadcastNewRound, broadcastNewEntry, broadcastPoolUpdate } from '../services/websocket.js';
import { pumpfunService } from '../services/pumpfunService.js';

const router = express.Router();

// ============ Validation Helpers ============

/**
 * Validate Solana wallet address
 */
function isValidSolanaAddress(address) {
  if (!address || typeof address !== 'string') return false;
  try {
    new PublicKey(address);
    return address.length >= 32 && address.length <= 44;
  } catch {
    return false;
  }
}

/**
 * Validate admin key
 */
function isValidAdminKey(key) {
  return key && key === process.env.ADMIN_KEY;
}

/**
 * Sanitize ticker (alphanumeric, max 20 chars)
 */
function sanitizeTicker(ticker) {
  if (!ticker || typeof ticker !== 'string') return '';
  return ticker.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20).toUpperCase();
}

/**
 * Validate color format (hex or hsl)
 */
function isValidColor(color) {
  if (!color || typeof color !== 'string') return false;
  // Allow hex colors or hsl format
  return /^#[0-9A-Fa-f]{6}$/.test(color) || /^hsl\(\d+,\s*\d+%,\s*\d+%\)$/.test(color);
}

// ============ Rate Limiting ============

const rateLimitStore = new Map();

/**
 * Simple in-memory rate limiter
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs - Time window in milliseconds
 */
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    const record = rateLimitStore.get(key);

    // Reset if window expired
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + windowMs;
      return next();
    }

    // Check limit
    if (record.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    record.count++;
    next();
  };
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Rate limit middleware instances
const participateLimiter = rateLimit(5, 60 * 1000);    // 5 requests per minute
const cacheLimiter = rateLimit(10, 60 * 1000);         // 10 requests per minute
const generalLimiter = rateLimit(60, 60 * 1000);       // 60 requests per minute

// ============ Health Check ============

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ============ Platform Stats ============

/**
 * GET /api/stats
 * Get platform-wide statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await db.getPlatformStats();

    // Get current pot balance from creator wallet (primary) or treasury (fallback)
    let currentPotSol = 0;
    let walletSource = 'none';
    try {
      if (pumpfunService.isConfigured()) {
        const balanceInfo = await pumpfunService.getDistributableBalance();
        currentPotSol = balanceInfo.distributable;
        walletSource = 'creator';
      } else {
        const balanceInfo = await solanaTransfer.getDistributableBalance();
        currentPotSol = balanceInfo.distributable;
        walletSource = 'treasury';
      }
    } catch (err) {
      console.error('Could not get wallet balance for stats:', err.message);
    }

    res.json({
      success: true,
      data: {
        ...stats,
        currentPotSol,
        walletSource,
      },
    });
  } catch (error) {
    console.error('Error getting platform stats:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

/**
 * GET /api/leaderboard
 * Get leaderboard data
 * Query params: type ('comeback' or 'god'), limit (default 20)
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const type = req.query.type === 'god' ? 'god' : 'comeback';
    const limit = parseInt(req.query.limit) || 20;

    const leaderboard = await db.getLeaderboard(type, limit);

    res.json({
      success: true,
      data: leaderboard,
    });
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({ success: false, error: 'Failed to get leaderboard' });
  }
});

// ============ Round Endpoints ============

/**
 * GET /api/round
 * Get current round info and time remaining
 */
router.get('/round', async (req, res) => {
  try {
    const round = await db.getCurrentRound();
    const timeRemaining = await db.getTimeRemaining();

    res.json({
      success: true,
      data: {
        ...round,
        timeRemaining,
      },
    });
  } catch (error) {
    console.error('Error getting round:', error);
    res.status(500).json({ success: false, error: 'Failed to get round info' });
  }
});

// ============ User Endpoints ============

/**
 * GET /api/user/:walletAddress
 * Get user data including cache and participation status
 */
router.get('/user/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;

    // Validate wallet address
    if (!isValidSolanaAddress(walletAddress)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }

    const [user, cache, hasParticipated, participatedTokens] = await Promise.all([
      db.getUser(walletAddress),
      db.getUserCache(walletAddress),
      db.hasParticipated(walletAddress),
      db.getParticipatedTokens(walletAddress),
    ]);

    res.json({
      success: true,
      data: {
        user,
        cache,
        hasParticipated,
        participatedTokens,
      },
    });
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ success: false, error: 'Failed to get user' });
  }
});

/**
 * POST /api/user/:walletAddress/cache
 * Save user's wallet analysis cache
 */
router.post('/user/:walletAddress/cache', cacheLimiter, async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const { tokens, swapCount, noValidTokens } = req.body;

    if (!tokens || !Array.isArray(tokens)) {
      return res.status(400).json({ success: false, error: 'Invalid tokens data' });
    }

    await db.saveUserCache(walletAddress, tokens, swapCount || 0, noValidTokens || false);

    res.json({
      success: true,
      message: 'Cache saved successfully',
    });
  } catch (error) {
    console.error('Error saving cache:', error);
    res.status(500).json({ success: false, error: 'Failed to save cache' });
  }
});

// ============ Participation Endpoints ============

/**
 * POST /api/participate
 * Submit participation for current round
 */
router.post('/participate', participateLimiter, async (req, res) => {
  try {
    const { walletAddress, tokens } = req.body;

    // Basic validation
    if (!walletAddress || !tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid participation data' });
    }

    // Validate wallet address
    if (!isValidSolanaAddress(walletAddress)) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }

    // Token count limit
    if (tokens.length > 3) {
      return res.status(400).json({ success: false, error: 'Maximum 3 tokens allowed' });
    }

    // Check for duplicate token addresses in submission
    const tokenAddresses = tokens.map(t => t.tokenAddress);
    const uniqueAddresses = [...new Set(tokenAddresses)];
    if (uniqueAddresses.length !== tokens.length) {
      return res.status(400).json({ success: false, error: 'Duplicate tokens not allowed' });
    }

    // Validate each token
    for (const token of tokens) {
      if (!isValidSolanaAddress(token.tokenAddress)) {
        return res.status(400).json({ success: false, error: 'Invalid token address' });
      }
      if (typeof token.lossAmount !== 'number' || token.lossAmount < 0) {
        return res.status(400).json({ success: false, error: 'Invalid loss amount' });
      }
      if (typeof token.holdings !== 'number' || token.holdings <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid holdings amount' });
      }
    }

    // Atomic participation check and record (prevent race condition)
    const participationResult = await db.participateAtomic(walletAddress, tokens);
    if (!participationResult.success) {
      return res.status(400).json({
        success: false,
        error: participationResult.error || 'Already participated in this round',
        alreadyParticipated: true,
      });
    }

    // Add live entries and update pool stats
    const entries = [];
    for (const token of tokens) {
      const sanitizedTicker = sanitizeTicker(token.ticker) || 'UNKNOWN';
      const entry = {
        id: uuidv4(),
        walletAddress,
        lossTicker: sanitizedTicker,
        tokenAddress: token.tokenAddress,
        lossAmount: Math.abs(token.lossAmount),
        heldAmount: Math.abs(token.holdings),
        color: isValidColor(token.color) ? token.color : `hsl(${Math.random() * 360}, 70%, 50%)`,
        timestamp: Date.now(),
      };

      await db.addLiveEntry(entry);
      await db.updatePoolToken(sanitizedTicker, token.tokenAddress, entry.color);
      entries.push(entry);
    }

    res.json({
      success: true,
      message: 'Participation recorded',
      entries,
    });
  } catch (error) {
    console.error('Error recording participation:', error);
    res.status(500).json({ success: false, error: 'Failed to record participation' });
  }
});

/**
 * GET /api/participation/:walletAddress
 * Check participation status for current round
 */
router.get('/participation/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const [hasParticipated, participatedTokens] = await Promise.all([
      db.hasParticipated(walletAddress),
      db.getParticipatedTokens(walletAddress),
    ]);

    res.json({
      success: true,
      data: {
        hasParticipated,
        participatedTokens,
      },
    });
  } catch (error) {
    console.error('Error checking participation:', error);
    res.status(500).json({ success: false, error: 'Failed to check participation' });
  }
});

// ============ Live Feed Endpoints ============

/**
 * GET /api/live-feed
 * Get live entries for current round
 */
router.get('/live-feed', async (req, res) => {
  try {
    const entries = await db.getLiveEntries();

    res.json({
      success: true,
      data: entries,
    });
  } catch (error) {
    console.error('Error getting live feed:', error);
    res.status(500).json({ success: false, error: 'Failed to get live feed' });
  }
});

// ============ Pool Stats Endpoints ============

/**
 * GET /api/pool-stats
 * Get pool statistics for current round
 */
router.get('/pool-stats', async (req, res) => {
  try {
    const poolStats = await db.getPoolStats();

    res.json({
      success: true,
      data: poolStats,
    });
  } catch (error) {
    console.error('Error getting pool stats:', error);
    res.status(500).json({ success: false, error: 'Failed to get pool stats' });
  }
});

// ============ Prize Pool Endpoints ============

/**
 * GET /api/prize-pool
 * Get current prize pool amount
 */
router.get('/prize-pool', async (req, res) => {
  try {
    const prizePool = await db.getPrizePool();

    res.json({
      success: true,
      data: prizePool,
    });
  } catch (error) {
    console.error('Error getting prize pool:', error);
    res.status(500).json({ success: false, error: 'Failed to get prize pool' });
  }
});

// Track completed rounds to prevent double-completion
const completedRounds = new Set();

/**
 * POST /api/round/complete
 * Complete round and distribute prizes (called after wheel spin)
 * Automatically transfers SOL to winners proportionally
 * Protected: Can only complete each round once
 */
router.post('/round/complete', async (req, res) => {
  try {
    const { winnerTicker, vrfResult } = req.body;

    if (!winnerTicker) {
      return res.status(400).json({ success: false, error: 'Winner ticker required' });
    }

    // Sanitize winner ticker
    const sanitizedWinner = sanitizeTicker(winnerTicker);
    if (!sanitizedWinner) {
      return res.status(400).json({ success: false, error: 'Invalid winner ticker' });
    }

    const round = await db.getCurrentRound();

    // Prevent double-completion of the same round
    if (completedRounds.has(round.roundId)) {
      return res.status(400).json({
        success: false,
        error: 'Round already completed',
        roundId: round.roundId,
      });
    }

    // Verify winner ticker exists in pool stats
    const poolStats = await db.getPoolStats();
    const winnerExists = poolStats.some(p => sanitizeTicker(p.ticker) === sanitizedWinner);
    if (poolStats.length > 0 && !winnerExists) {
      return res.status(400).json({
        success: false,
        error: 'Winner ticker not found in current pool',
      });
    }

    // Mark round as completing (prevent race condition)
    completedRounds.add(round.roundId);

    // Get distributable balance from creator wallet (PumpFun fees wallet)
    let prizePoolSol = 0;
    let useCreatorWallet = pumpfunService.isConfigured();

    try {
      if (useCreatorWallet) {
        // Use PumpFun creator wallet for distribution
        const balanceInfo = await pumpfunService.getDistributableBalance();
        prizePoolSol = balanceInfo.distributable;
        console.log(`Creator wallet balance: ${balanceInfo.total} SOL, distributable: ${prizePoolSol} SOL`);
      } else {
        // Fallback to treasury wallet
        const balanceInfo = await solanaTransfer.getDistributableBalance();
        prizePoolSol = balanceInfo.distributable;
      }
    } catch (err) {
      console.error('Could not get wallet balance:', err.message);
    }

    // Complete round and calculate payouts (even if prize is 0, still store the result)
    const result = await db.completeRound(
      round.roundId,
      sanitizedWinner,
      vrfResult || null,
      prizePoolSol
    );

    // Distribute SOL to winners (only if there are participants)
    let transferResult = null;
    if (result.payouts && result.payouts.length > 0) {
      console.log(`Processing prize distribution to ${result.payouts.length} winners...`);

      if (useCreatorWallet) {
        // Use creator wallet with auto-claim: claim fees first, then distribute
        console.log('Using creator wallet with auto-claim...');
        transferResult = await pumpfunService.claimAndDistribute(result.payouts);
      } else {
        // Fallback to treasury
        console.log('Using treasury wallet...');
        transferResult = await solanaTransfer.distributePrizes(result.payouts);
      }

      if (transferResult.success) {
        console.log(`Transfer successful! Signature: ${transferResult.signature || 'multiple'}`);

        // Store transfer result in round file
        await db.storeTransferResult(round.roundId, transferResult);

        // Update each user's winning record with transaction signature
        for (const payout of result.payouts) {
          await db.updateUserWinningWithTx(
            payout.walletAddress,
            round.roundId,
            transferResult.signature
          );
        }

        // Use actual distributed amount from claimAndDistribute (not wallet balance)
        const actualDistributed = transferResult.totalDistributed || transferResult.prizePool || prizePoolSol;

        // Log to transfer history
        await db.logTransfer({
          roundId: round.roundId,
          signature: transferResult.signature,
          totalAmount: actualDistributed,
          recipientCount: result.payouts.length,
          recipients: result.payouts.map(p => ({
            wallet: p.walletAddress,
            amount: p.payoutSol,
          })),
          success: true,
        });
      } else {
        console.error('Transfer failed:', transferResult.error);

        // Log failed transfer
        await db.logTransfer({
          roundId: round.roundId,
          signature: null,
          totalAmount: prizePoolSol,
          recipientCount: result.payouts.length,
          recipients: result.payouts.map(p => ({
            wallet: p.walletAddress,
            amount: p.payoutSol,
          })),
          success: false,
          error: transferResult.error,
        });
      }
    }

    // Use actual distributed amount for response
    const finalPrizePool = transferResult?.totalDistributed || transferResult?.prizePool || prizePoolSol;

    res.json({
      success: true,
      data: {
        roundId: round.roundId,
        ...result,
        prizePoolSol: finalPrizePool, // Use actual claimed/distributed amount
        transfer: transferResult,
      },
    });
  } catch (error) {
    console.error('Error completing round:', error);
    res.status(500).json({ success: false, error: 'Failed to complete round' });
  }
});

/**
 * GET /api/round/:roundId/result
 * Get result of a specific round
 */
router.get('/round/:roundId/result', async (req, res) => {
  try {
    const { roundId } = req.params;
    const result = await db.getRoundResult(parseInt(roundId));

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error getting round result:', error);
    res.status(500).json({ success: false, error: 'Failed to get round result' });
  }
});

/**
 * GET /api/rounds/history
 * Get history of completed rounds
 */
router.get('/rounds/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const rounds = await db.getRoundHistory(limit);

    res.json({
      success: true,
      data: rounds,
    });
  } catch (error) {
    console.error('Error getting round history:', error);
    res.status(500).json({ success: false, error: 'Failed to get round history' });
  }
});

// ============ Transfer History (Public) ============

/**
 * GET /api/transfer/history
 * Get public transfer history for transparency page
 */
router.get('/transfer/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const transfers = await db.getTransferHistory(limit);

    res.json({
      success: true,
      data: transfers,
    });
  } catch (error) {
    console.error('Error getting transfer history:', error);
    res.status(500).json({ success: false, error: 'Failed to get transfer history' });
  }
});

// ============ User Winnings Endpoints ============

/**
 * GET /api/winnings/:walletAddress
 * Get user's winnings history and total
 */
router.get('/winnings/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const winnings = await db.getUserWinnings(walletAddress);

    res.json({
      success: true,
      data: winnings,
    });
  } catch (error) {
    console.error('Error getting winnings:', error);
    res.status(500).json({ success: false, error: 'Failed to get winnings' });
  }
});

// ============ Swap Data Endpoints (for fast scanning) ============

/**
 * GET /api/swaps/:walletAddress
 * Get stored swap data for instant retrieval
 */
router.get('/swaps/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const swapData = await db.getSwapData(walletAddress);

    if (!swapData) {
      return res.json({
        success: true,
        data: null,
        message: 'No cached swap data found',
      });
    }

    res.json({
      success: true,
      data: swapData,
    });
  } catch (error) {
    console.error('Error getting swap data:', error);
    res.status(500).json({ success: false, error: 'Failed to get swap data' });
  }
});

/**
 * POST /api/swaps/:walletAddress
 * Save processed swap data for future fast retrieval
 */
router.post('/swaps/:walletAddress', cacheLimiter, async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const { swaps, positions } = req.body;

    if (!swaps || !Array.isArray(swaps)) {
      return res.status(400).json({ success: false, error: 'Invalid swap data' });
    }

    await db.saveSwapData(walletAddress, { swaps, positions });

    res.json({
      success: true,
      message: 'Swap data saved',
    });
  } catch (error) {
    console.error('Error saving swap data:', error);
    res.status(500).json({ success: false, error: 'Failed to save swap data' });
  }
});

// ============ Admin Endpoints ============

/**
 * GET /api/admin/transfers
 * Get transfer history (admin only)
 */
router.get('/admin/transfers', async (req, res) => {
  try {
    const { adminKey } = req.query;

    if (!isValidAdminKey(adminKey)) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const limit = parseInt(req.query.limit) || 100;
    const transfers = await db.getTransferHistory(limit);

    res.json({
      success: true,
      data: transfers,
    });
  } catch (error) {
    console.error('Error getting transfer history:', error);
    res.status(500).json({ success: false, error: 'Failed to get transfer history' });
  }
});

/**
 * POST /api/admin/clear
 * Reset for new round - preserves historical data (stats, transfers, winnings)
 */
router.post('/admin/clear', async (req, res) => {
  try {
    // Reset participation but PRESERVE historical data
    await db.resetForNewRound();

    // Start fresh round with full 1-hour timer
    const newRound = await db.forceNewRound();

    console.log('Reset for new round (preserved history):', newRound.roundId);

    // Broadcast new round to all connected clients
    broadcastNewRound(newRound);

    res.json({
      success: true,
      message: 'New round started (history preserved)',
      round: newRound,
    });
  } catch (error) {
    console.error('Error resetting for new round:', error);
    res.status(500).json({ success: false, error: 'Failed to reset for new round' });
  }
});

/**
 * POST /api/admin/spin-start
 * Broadcasts spin animation start to all clients
 */
router.post('/admin/spin-start', async (req, res) => {
  try {
    const { duration = 10000 } = req.body;

    // Get current pool stats for the wheel
    const poolStats = await db.getPoolStats();

    // Broadcast spin start to all clients
    broadcastSpinStart(poolStats, duration);

    res.json({
      success: true,
      message: 'Spin started and broadcast to all clients',
      poolStats,
      duration,
    });
  } catch (error) {
    console.error('Error starting spin:', error);
    res.status(500).json({ success: false, error: 'Failed to start spin' });
  }
});

/**
 * POST /api/admin/spin-result
 * Broadcasts spin result to all clients
 */
router.post('/admin/spin-result', async (req, res) => {
  try {
    const { winner, prizePool, payouts } = req.body;

    if (!winner) {
      return res.status(400).json({ success: false, error: 'Winner ticker is required' });
    }

    // Broadcast spin result to all clients
    broadcastSpinResult(winner, prizePool, payouts);

    res.json({
      success: true,
      message: 'Spin result broadcast to all clients',
      winner,
    });
  } catch (error) {
    console.error('Error broadcasting spin result:', error);
    res.status(500).json({ success: false, error: 'Failed to broadcast spin result' });
  }
});

// ============ PumpFun Fee Endpoints ============

/**
 * GET /api/pumpfun/wallet
 * Get creator wallet balance for prize distribution
 */
router.get('/pumpfun/wallet', async (req, res) => {
  try {
    const balance = await pumpfunService.getDistributableBalance();
    const isConfigured = pumpfunService.isConfigured();

    res.json({
      success: true,
      data: {
        ...balance,
        configured: isConfigured,
      },
    });
  } catch (error) {
    console.error('Error getting creator wallet balance:', error);
    res.status(500).json({ success: false, error: 'Failed to get wallet balance' });
  }
});

/**
 * POST /api/pumpfun/claim
 * Manually trigger creator fee claim from PumpFun
 */
router.post('/pumpfun/claim', async (req, res) => {
  try {
    console.log('Manual fee claim requested...');
    const result = await pumpfunService.claimCreatorFees();

    res.json({
      success: result.success,
      data: result,
    });
  } catch (error) {
    console.error('Error claiming creator fees:', error);
    res.status(500).json({ success: false, error: 'Failed to claim fees' });
  }
});

/**
 * GET /api/pumpfun/fees
 * Get PumpFun creator fee data for prize pool
 */
router.get('/pumpfun/fees', async (req, res) => {
  try {
    const feeData = await pumpfunService.getTokenFeeData();

    if (!feeData) {
      return res.json({
        success: true,
        data: {
          estimatedFeesUsd: 0,
          estimatedFeesSol: 0,
          volume1h: 0,
          volume24h: 0,
          priceUsd: 0,
          bondingCurveSol: 0,
        },
      });
    }

    res.json({
      success: true,
      data: {
        token: feeData.token,
        estimatedFees1h: feeData.fees?.estimatedFees1h || 0,
        estimatedFees24h: feeData.fees?.estimatedFees24h || 0,
        volume1h: feeData.trading?.volume1h || 0,
        volume24h: feeData.trading?.volume24h || 0,
        priceUsd: feeData.trading?.priceUsd || 0,
        priceNative: feeData.trading?.priceNative || 0,
        marketCap: feeData.trading?.marketCap || 0,
        bondingCurve: feeData.bondingCurve,
        timestamp: feeData.timestamp,
      },
    });
  } catch (error) {
    console.error('Error getting PumpFun fee data:', error);
    res.status(500).json({ success: false, error: 'Failed to get fee data' });
  }
});

/**
 * GET /api/pumpfun/prize-pool
 * Get current prize pool amount based on PumpFun fees
 */
router.get('/pumpfun/prize-pool', async (req, res) => {
  try {
    const prizePool = await pumpfunService.getPrizePoolAmount();

    res.json({
      success: true,
      data: prizePool,
    });
  } catch (error) {
    console.error('Error getting prize pool:', error);
    res.status(500).json({ success: false, error: 'Failed to get prize pool' });
  }
});

/**
 * POST /api/admin/full-reset
 * Complete reset - clears ALL data including history (use with caution)
 */
router.post('/admin/full-reset', async (req, res) => {
  try {
    // Clear everything including history
    await db.clearAllData();

    // Start fresh round
    const newRound = await db.forceNewRound();

    console.log('Full reset - all data cleared:', newRound.roundId);

    res.json({
      success: true,
      message: 'Full reset complete - all data cleared',
      round: newRound,
    });
  } catch (error) {
    console.error('Error with full reset:', error);
    res.status(500).json({ success: false, error: 'Failed to perform full reset' });
  }
});

export default router;
