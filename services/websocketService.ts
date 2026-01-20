/**
 * WebSocket Service for Real-time Updates
 * Connects to backend WebSocket and handles events
 */

type EventCallback = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private isConnecting = false;

  /**
   * Get WebSocket URL based on current hostname
   */
  private getWsUrl(): string {
    if (typeof window === 'undefined') return 'ws://localhost:6002';

    const hostname = window.location.hostname;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    // If using Cloudflare tunnel
    if (hostname.endsWith('.trycloudflare.com')) {
      return 'wss://suite-five-quantity-unix.trycloudflare.com';
    }

    // If using localtunnel
    if (hostname.endsWith('.loca.lt')) {
      return 'wss://recoveryroom-api.loca.lt';
    }

    // Production (rfnd.fun) - use /ws path (nginx proxies to backend)
    if (hostname === 'rfnd.fun' || hostname === 'www.rfnd.fun') {
      return `${protocol}//${hostname}/ws`;
    }

    // Local development
    return `ws://${hostname}:6002`;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    const wsUrl = this.getWsUrl();
    console.log('Connecting to WebSocket:', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.emit('connected', {});
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket message:', data.type, data);
          this.emit(data.type, data);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnecting = false;
        this.ws = null;
        this.emit('disconnected', {});
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.isConnecting = false;
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to an event
   */
  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (e) {
        console.error(`Error in event listener for ${event}:`, e);
      }
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
export const wsService = new WebSocketService();

// Event types for TypeScript
export interface SpinStartEvent {
  type: 'SPIN_START';
  poolStats: Array<{ ticker: string; tokenAddress: string; subCount: number; color: string }>;
  duration: number;
  timestamp: number;
}

export interface SpinResultEvent {
  type: 'SPIN_RESULT';
  winner: string;
  prizePool: number;
  payouts: any[];
  timestamp: number;
}

export interface NewRoundEvent {
  type: 'NEW_ROUND';
  round: {
    roundId: number;
    startTime: number;
    endTime: number;
    timeRemaining: number;
  };
  timestamp: number;
}

export interface NewEntryEvent {
  type: 'NEW_ENTRY';
  entry: any;
  timestamp: number;
}
