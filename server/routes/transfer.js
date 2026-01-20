/**
 * Transfer API Routes
 * Handles SOL transfer operations
 */

import express from 'express';
import { solanaTransfer } from '../services/solanaTransfer.js';

const router = express.Router();

/**
 * GET /api/transfer/status
 * Check treasury wallet status and balance
 */
router.get('/status', async (req, res) => {
  try {
    const address = solanaTransfer.getTreasuryAddress();

    if (!address) {
      return res.json({
        success: true,
        data: {
          configured: false,
          balanceSol: 0,
          message: 'Treasury wallet not configured',
        },
      });
    }

    const balance = await solanaTransfer.getTreasuryBalance();

    res.json({
      success: true,
      data: {
        configured: true,
        address,
        balanceSol: balance,
      },
    });
  } catch (error) {
    console.error('Error getting transfer status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/transfer/balance
 * Get treasury balance for prize pool display (minus reserved for fees)
 */
router.get('/balance', async (req, res) => {
  try {
    const address = solanaTransfer.getTreasuryAddress();

    if (!address) {
      return res.json({
        success: true,
        data: {
          balanceSol: 0,
          totalBalance: 0,
          reservedForFees: 0,
          configured: false,
        },
      });
    }

    // Get distributable balance (reserves ~0.005 SOL for fees)
    const balanceInfo = await solanaTransfer.getDistributableBalance();

    res.json({
      success: true,
      data: {
        balanceSol: balanceInfo.distributable, // This is what can be distributed as prizes
        totalBalance: balanceInfo.totalBalance,
        reservedForFees: balanceInfo.reservedForFees,
        configured: true,
        address,
      },
    });
  } catch (error) {
    console.error('Error getting balance:', error);
    res.json({
      success: true,
      data: {
        balanceSol: 0,
        configured: false,
        error: error.message,
      },
    });
  }
});

/**
 * POST /api/transfer/single
 * Transfer SOL to a single recipient (admin only)
 */
router.post('/single', async (req, res) => {
  try {
    const { recipient, amount, adminKey } = req.body;

    // Simple admin key check (should be replaced with proper auth)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    if (!recipient || !amount) {
      return res.status(400).json({ success: false, error: 'Recipient and amount required' });
    }

    const result = await solanaTransfer.transfer(recipient, amount);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error in single transfer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/transfer/distribute
 * Distribute prizes to multiple winners (called after round completion)
 */
router.post('/distribute', async (req, res) => {
  try {
    const { payouts, adminKey } = req.body;

    // Simple admin key check
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    if (!payouts || !Array.isArray(payouts) || payouts.length === 0) {
      return res.status(400).json({ success: false, error: 'Payouts array required' });
    }

    const result = await solanaTransfer.distributePrizes(payouts);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error in prize distribution:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
