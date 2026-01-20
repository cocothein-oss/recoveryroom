/**
 * GitHub Webhook Handler for Auto-Deploy
 * Listens for push events and triggers deployment
 */

import express from 'express';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = express.Router();

// Get webhook secret at runtime (not at module load time due to ES module hoisting)
const getWebhookSecret = () => process.env.GITHUB_WEBHOOK_SECRET || '';

/**
 * Verify GitHub webhook signature
 */
function verifySignature(payload, signature) {
  const secret = getWebhookSecret();
  if (!secret) {
    console.warn('GITHUB_WEBHOOK_SECRET not set - skipping signature verification');
    return true;
  }

  if (!signature) {
    return false;
  }

  const sig = Buffer.from(signature, 'utf8');
  const hmac = crypto.createHmac('sha256', secret);
  const digest = Buffer.from('sha256=' + hmac.update(payload).digest('hex'), 'utf8');

  return sig.length === digest.length && crypto.timingSafeEqual(digest, sig);
}

/**
 * Run deployment commands
 */
async function runDeploy() {
  const deployDir = process.env.DEPLOY_DIR || '/var/www/recoveryroom';
  const commands = [
    `cd ${deployDir}`,
    'git fetch origin master',
    'git reset --hard origin/master',
    'npm install',
    'npm run build',
    'pm2 restart all'
  ].join(' && ');

  console.log('Running deploy commands...');
  const { stdout, stderr } = await execAsync(commands, {
    timeout: 120000,  // 2 minute timeout
    maxBuffer: 10 * 1024 * 1024  // 10MB buffer
  });

  return { stdout, stderr };
}

/**
 * POST /webhook/github
 * GitHub webhook endpoint for push events
 */
router.post('/github', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];
  const delivery = req.headers['x-github-delivery'];

  console.log(`[Webhook] Received ${event} event (delivery: ${delivery})`);

  // Verify signature
  const payload = req.body.toString();
  if (!verifySignature(payload, signature)) {
    console.error('[Webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Only process push events to master branch
  if (event !== 'push') {
    console.log(`[Webhook] Ignoring ${event} event`);
    return res.json({ message: `Ignored ${event} event` });
  }

  let data;
  try {
    data = JSON.parse(payload);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Check if push is to master branch
  if (data.ref !== 'refs/heads/master') {
    console.log(`[Webhook] Ignoring push to ${data.ref}`);
    return res.json({ message: `Ignored push to ${data.ref}` });
  }

  // Respond immediately to GitHub (don't wait for deploy)
  res.json({ message: 'Deploy started', delivery });

  // Run deploy in background
  try {
    console.log('[Webhook] Starting deployment...');
    console.log(`[Webhook] Commit: ${data.head_commit?.message || 'unknown'}`);
    console.log(`[Webhook] Pusher: ${data.pusher?.name || 'unknown'}`);

    const result = await runDeploy();

    console.log('[Webhook] Deploy completed successfully');
    console.log('[Webhook] stdout:', result.stdout.slice(-500)); // Last 500 chars
    if (result.stderr) {
      console.warn('[Webhook] stderr:', result.stderr.slice(-500));
    }
  } catch (error) {
    console.error('[Webhook] Deploy failed:', error.message);
    if (error.stdout) console.log('[Webhook] stdout:', error.stdout.slice(-500));
    if (error.stderr) console.error('[Webhook] stderr:', error.stderr.slice(-500));
  }
});

/**
 * GET /webhook/status
 * Check webhook status
 */
router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    webhookConfigured: !!getWebhookSecret(),
    deployDir: process.env.DEPLOY_DIR || '/var/www/recoveryroom',
  });
});

/**
 * POST /webhook/manual
 * Manual deploy trigger (protected - requires secret header)
 */
router.post('/manual', async (req, res) => {
  const secret = req.headers['x-deploy-secret'];
  const webhookSecret = getWebhookSecret();

  if (!webhookSecret || secret !== webhookSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json({ message: 'Manual deploy started' });

  try {
    console.log('[Webhook] Manual deploy triggered');
    const result = await runDeploy();
    console.log('[Webhook] Manual deploy completed');
  } catch (error) {
    console.error('[Webhook] Manual deploy failed:', error.message);
  }
});

export default router;
