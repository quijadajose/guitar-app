import type { ClientMessage, ServerMessage } from '../../types/multiplayer';

export type MessageHandler = (msg: ServerMessage) => void;

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<MessageHandler> = new Set();
  private clockOffsetMs = 0; // offset = server_time - client_time
  private rttMs = 0;

  constructor(url = 'ws://localhost:3001/ws') {
    this.url = url;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.calibrateClock();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data: ServerMessage = JSON.parse(event.data);
            this.handleInternal(data);
            for (const handler of this.handlers) {
              handler(data);
            }
          } catch (e) {
            console.error('[MultiplayerClient] Error parsing message:', e);
          }
        };

        this.ws.onerror = (err) => {
          console.error('[MultiplayerClient] WebSocket error:', err);
          reject(err);
        };

        this.ws.onclose = () => {
          console.warn('[MultiplayerClient] WebSocket disconnected');
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  public subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[MultiplayerClient] Cannot send message, socket not open');
    }
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Calibración de reloj estilo NTP (calcula RTT y diferencia de reloj)
   */
  private calibrateClock(): void {
    const clientTs = Date.now();
    this.send({
      type: 'ping',
      payload: { client_ts: clientTs },
    });
  }

  private handleInternal(msg: ServerMessage): void {
    if (msg.type === 'pong') {
      const now = Date.now();
      const { client_ts, server_ts } = msg.payload;
      this.rttMs = now - client_ts;
      // Formula NTP: offset = (server_recv - client_send + server_recv - client_recv) / 2
      this.clockOffsetMs = Math.round(server_ts - (client_ts + this.rttMs / 2));
    }
  }

  /**
   * Obtiene la hora actual estimada del servidor en milisegundos de época
   */
  public getServerNow(): number {
    return Date.now() + this.clockOffsetMs;
  }

  public getLatency(): number {
    return Math.round(this.rttMs / 2);
  }
}
