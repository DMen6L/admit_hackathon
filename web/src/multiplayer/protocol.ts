export type RoomPhase = 'waiting' | 'active' | 'finished';
export const ONLINE_SPELL_IDS = [
  'rune.triangle', 'rune.circle', 'rune.lightning',
  'rune.hourglass', 'rune.square', 'rune.line',
] as const;
export type OnlineSpellId = typeof ONLINE_SPELL_IDS[number];

export interface CastAck {
  type: 'cast_ack';
  v: 1;
  seq: number;
  spellId: OnlineSpellId;
  acceptedAtMs: number;
  revision: number;
}

export interface MatchState {
  type: 'state';
  v: 1;
  revision: number;
  serverTimeMs: number;
  phase: RoomPhase;
  players: Array<{ seat: number; userId?: string; login: string; displayName?: string; health: number; castReadyAtMs: number; shieldReadyAtMs: number; shieldUntilMs: number; slowNextAttack: boolean }>;
  attacks: Array<{ seat: number; spellId: OnlineSpellId; startedAtMs: number; releaseAtMs: number; impactAtMs: number; slowed: boolean }>;
  casts: Array<{ id: number; seat: number; spellId: OnlineSpellId; atMs: number }>;
  impacts: Array<{ seat: number; spellId: OnlineSpellId; atMs: number; blocked: boolean }>;
  connectedSeats: number[];
  winner: number | null;
}

export function isMatchState(value: unknown): value is MatchState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<MatchState>;
  return state.type === 'state' && state.v === 1 && Number.isSafeInteger(state.revision)
    && typeof state.serverTimeMs === 'number' && ['waiting', 'active', 'finished'].includes(state.phase ?? '')
    && Array.isArray(state.players) && Array.isArray(state.attacks) && Array.isArray(state.casts) && Array.isArray(state.impacts)
    && Array.isArray(state.connectedSeats);
}

export function isCastAck(value: unknown): value is CastAck {
  if (!value || typeof value !== 'object') return false;
  const ack = value as Partial<CastAck>;
  return ack.type === 'cast_ack' && ack.v === 1
    && typeof ack.seq === 'number' && Number.isSafeInteger(ack.seq) && ack.seq > 0 && typeof ack.spellId === 'string'
    && (ONLINE_SPELL_IDS as readonly string[]).includes(ack.spellId)
    && typeof ack.acceptedAtMs === 'number' && Number.isSafeInteger(ack.revision);
}

export function websocketRoomUrl(apiBaseUrl: string, code: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws/rooms/${encodeURIComponent(code)}`;
  url.search = '';
  return url.toString();
}
