/**
 * WebSocket Service for Real-time Updates
 * Broadcasts events to all connected clients
 */

import { WebSocketServer } from 'ws';

let wss = null;
const clients = new Set();

/**
 * Initialize WebSocket server
 */
export function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    clients.add(ws);

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to Recovery Room' }));

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clients.delete(ws);
    });
  });

  console.log('WebSocket server initialized');
  return wss;
}

/**
 * Broadcast message to all connected clients
 */
export function broadcast(event) {
  const message = JSON.stringify(event);
  let sentCount = 0;

  clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
      sentCount++;
    }
  });

  console.log(`Broadcast "${event.type}" to ${sentCount} clients`);
}

/**
 * Broadcast wheel spin start
 */
export function broadcastSpinStart(poolStats, duration = 10000) {
  broadcast({
    type: 'SPIN_START',
    poolStats,
    duration,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast wheel spin result
 */
export function broadcastSpinResult(winner, prizePool, payouts) {
  broadcast({
    type: 'SPIN_RESULT',
    winner,
    prizePool,
    payouts,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast new round started
 */
export function broadcastNewRound(round) {
  broadcast({
    type: 'NEW_ROUND',
    round: {
      roundId: round.roundId,
      startTime: round.startTime,
      endTime: round.endTime,
      timeRemaining: Math.floor((round.endTime - Date.now()) / 1000),
    },
    timestamp: Date.now(),
  });
}

/**
 * Broadcast new entry submitted
 */
export function broadcastNewEntry(entry) {
  broadcast({
    type: 'NEW_ENTRY',
    entry,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast pool stats update
 */
export function broadcastPoolUpdate(poolStats) {
  broadcast({
    type: 'POOL_UPDATE',
    poolStats,
    timestamp: Date.now(),
  });
}

/**
 * Get connected client count
 */
export function getClientCount() {
  return clients.size;
}
