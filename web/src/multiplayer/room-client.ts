import { isCastAck, isMatchState, ONLINE_SPELL_IDS, websocketRoomUrl, type CastAck, type MatchState, type OnlineSpellId } from './protocol';

export interface RoomClientEvents {
  onState(state: MatchState): void;
  onCastAck(ack: CastAck): void;
  onCastRejected(code: string, seq: number): void;
  onStatus(message: string): void;
  onError(message: string): void;
}

/** One ordered socket per room seat. Rendering uses server deadlines, never packet arrival as game time. */
export class RoomClient {
  private socket?: WebSocket;
  private pingTimer?: number;
  private reconnectTimer?: number;
  private attempts = 0;
  private seq = 0;
  private revision = -1;
  private disposed = false;
  private offsetMs = 0;
  private hasOffset = false;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly code: string,
    private readonly token: string,
    private readonly events: RoomClientEvents,
  ) {}

  serverNow(): number { return Date.now() + this.offsetMs; }

  connect(): void {
    if (this.disposed) return;
    const socket = new WebSocket(websocketRoomUrl(this.apiBaseUrl, this.code));
    this.socket = socket;
    this.seq = 0;
    this.revision = -1;
    this.events.onStatus(this.attempts ? 'Reconnecting to your duel…' : 'Connecting to your duel…');
    socket.addEventListener('open', () => {
      this.attempts = 0;
      socket.send(JSON.stringify({ type: 'authenticate', token: this.token }));
      this.pingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping', v: 1, clientTimeMs: Date.now() }));
      }, 3000);
    });
    socket.addEventListener('message', (event) => {
      let message: unknown;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (!message || typeof message !== 'object') return;
      const data = message as Record<string, unknown>;
      if (isMatchState(message)) {
        if (message.revision <= this.revision) return;
        this.revision = message.revision;
        if (!this.hasOffset) { this.offsetMs = message.serverTimeMs - Date.now(); this.hasOffset = true; }
        this.events.onState(message);
      } else if (isCastAck(message)) {
        this.events.onCastAck(message);
      } else if (data.type === 'pong' && typeof data.clientTimeMs === 'number' && typeof data.serverTimeMs === 'number') {
        const estimate = data.serverTimeMs - (data.clientTimeMs + Date.now()) / 2;
        this.offsetMs = this.hasOffset ? this.offsetMs * .8 + estimate * .2 : estimate;
        this.hasOffset = true;
      } else if (data.type === 'error') {
        if (typeof data.seq === 'number') this.events.onCastRejected(String(data.code ?? 'unknown error'), data.seq);
        this.events.onError(`Cast rejected: ${String(data.code ?? 'unknown error')}`);
      }
    });
    socket.addEventListener('close', (event) => {
      if (this.pingTimer !== undefined) window.clearInterval(this.pingTimer);
      if (this.disposed) return;
      if (event.code === 1008) {
        this.events.onError('Room access expired or was denied. Return to practice and sign in again.');
        return;
      }
      this.attempts += 1;
      const delay = Math.min(4000, 400 * 2 ** Math.min(this.attempts, 4));
      this.events.onStatus('Connection lost. Reconnecting…');
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    });
    socket.addEventListener('error', () => this.events.onStatus('Network connection interrupted.'));
  }

  cast(spellId: string): number | false {
    if (!(ONLINE_SPELL_IDS as readonly string[]).includes(spellId)) return false;
    if (this.socket?.readyState !== WebSocket.OPEN || this.revision < 0) return false;
    const seq = ++this.seq;
    this.socket.send(JSON.stringify({ type: 'cast', v: 1, seq, spellId: spellId as OnlineSpellId }));
    return seq;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pingTimer !== undefined) window.clearInterval(this.pingTimer);
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}
