import type { ClientMessage, ServerMessage } from '../../types/multiplayer';

export type MessageHandler = (msg: ServerMessage) => void;
export type CloseHandler = (event: CloseEvent) => void;

const CONNECT_TIMEOUT_MS = 8000;
/** El servidor corta sockets sin tráfico a los 120 s: mandar ping antes. */
const KEEPALIVE_MS = 30_000;
const MAX_INCOMING_BYTES = 64 * 1024;

const SERVER_TYPES = new Set<ServerMessage['type']>([
  'pong',
  'room_created',
  'room_joined',
  'room_updated',
  'room_settings',
  'chat',
  'game_starting',
  'opponent_progress',
  'opponent_note_hit',
  'apply_attack',
  'opponent_eliminated',
  'rematch_requested',
  'error',
  'room_closing',
  'room_closed'
]);

function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_INCOMING_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const msg = data as { type?: unknown; payload?: unknown };
  if (typeof msg.type !== 'string' || !SERVER_TYPES.has(msg.type as ServerMessage['type'])) return null;
  if (!msg.payload || typeof msg.payload !== 'object') return null;
  return data as ServerMessage;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<MessageHandler> = new Set();
  private closeHandlers: Set<CloseHandler> = new Set();
  private clockOffsetMs = 0; // offset = server_time - client_time
  private rttMs = 0;
  private keepalive: number | null = null;

  constructor(url = 'ws://localhost:3001/ws') {
    this.url = url;
  }

  public get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (error === undefined) resolve();
        else reject(error);
      };
      const timer = window.setTimeout(() => {
        finish(new Error('Tiempo de conexión agotado'));
        this.ws?.close();
      }, CONNECT_TIMEOUT_MS);

      try {
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.onopen = () => {
          this.calibrateClock();
          this.startKeepalive();
          finish();
        };

        ws.onmessage = (event) => {
          const data = parseServerMessage(event.data);
          if (!data) {
            console.warn('[MultiplayerClient] Mensaje del servidor ignorado');
            return;
          }
          this.handleInternal(data);
          for (const handler of this.handlers) {
            try {
              handler(data);
            } catch (e) {
              console.error('[MultiplayerClient] Handler error:', e);
            }
          }
        };

        ws.onerror = (err) => {
          console.error('[MultiplayerClient] WebSocket error:', err);
          finish(err);
        };

        ws.onclose = (event) => {
          this.stopKeepalive();
          finish(new Error('Conexión cerrada'));
          if (this.ws === ws) this.ws = null;
          for (const handler of this.closeHandlers) handler(event);
        };
      } catch (err) {
        finish(err);
      }
    });
  }

  public subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Avisos de desconexión (servidor caído, red, timeout). */
  public onClose(handler: CloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  public send(msg: ClientMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    console.warn('[MultiplayerClient] Cannot send message, socket not open');
    return false;
  }

  public disconnect(): void {
    this.stopKeepalive();
    this.closeHandlers.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepalive = window.setInterval(() => this.calibrateClock(), KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepalive !== null) {
      window.clearInterval(this.keepalive);
      this.keepalive = null;
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
      if (typeof client_ts !== 'number' || typeof server_ts !== 'number') return;
      const rtt = now - client_ts;
      // Ignorar pongs absurdos (reloj cambiado, respuesta vieja).
      if (rtt < 0 || rtt > 30_000) return;
      this.rttMs = rtt;
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
