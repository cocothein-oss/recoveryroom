/**
 * Recovery Room Backend Server
 * Simple Express server with JSON file database and WebSocket support
 */

// Load dotenv FIRST before any other imports
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

// Now import everything else (after env is loaded)
import express from 'express';
import cors from 'cors';
import http from 'http';
import apiRoutes from './routes/api.js';
import transferRoutes from './routes/transfer.js';
import { solanaTransfer } from './services/solanaTransfer.js';
import { initWebSocket } from './services/websocket.js';

const app = express();
const PORT = process.env.PORT || 6002;

// Middleware
app.use(cors({
  origin: true,  // Allow all origins for local network access
  credentials: true,
}));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api', apiRoutes);
app.use('/api/transfer', transferRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
  });
});

// Create HTTP server for Express + WebSocket
const server = http.createServer(app);

// Initialize services and start server
async function startServer() {
  // Initialize Solana transfer service
  const treasuryReady = await solanaTransfer.initialize();

  // Initialize WebSocket
  initWebSocket(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   Recovery Room Backend Server                        ║
║                                                       ║
║   Server running on: http://localhost:${PORT}           ║
║   API endpoint:      http://localhost:${PORT}/api       ║
║   WebSocket:         ws://localhost:${PORT}             ║
║                                                       ║
║   Endpoints:                                          ║
║   GET  /api/health          - Health check            ║
║   GET  /api/round           - Current round info      ║
║   GET  /api/user/:wallet    - User data               ║
║   POST /api/participate     - Submit entry            ║
║   GET  /api/live-feed       - Live entries            ║
║   GET  /api/pool-stats      - Pool statistics         ║
║   POST /api/admin/clear     - Clear all data          ║
║                                                       ║
║   Treasury: ${treasuryReady ? 'CONFIGURED' : 'NOT CONFIGURED'}                         ║
║   WebSocket: ENABLED                                  ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
    `);
  });
}

startServer();

export { server };
export default app;
