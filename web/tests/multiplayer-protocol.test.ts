import { describe, expect, it } from 'vitest';
import { isCastAck, isMatchState, ONLINE_SPELL_IDS, websocketRoomUrl } from '../src/multiplayer/protocol';
import { normalizeRoomCode, roomCodeFromSearch } from '../src/multiplayer/room-code';

describe('multiplayer protocol', () => {
  it('derives an authenticated socket endpoint without putting a token in the URL', () => {
    expect(websocketRoomUrl('http://127.0.0.1:8000', 'ABC123')).toBe('ws://127.0.0.1:8000/ws/rooms/ABC123');
    expect(websocketRoomUrl('https://game.example/api', 'ABC123')).toBe('wss://game.example/api/ws/rooms/ABC123');
  });

  it('rejects unrelated or old-version server messages before rendering', () => {
    const state = {
      type: 'state', v: 1, revision: 3, serverTimeMs: 1000, phase: 'active',
      players: [], attacks: [], casts: [], impacts: [], connectedSeats: [], winner: null,
    };
    expect(isMatchState(state)).toBe(true);
    expect(isMatchState({ ...state, v: 2 })).toBe(false);
    expect(isMatchState({ ...state, attacks: null })).toBe(false);
    expect(isMatchState({ ...state, casts: null })).toBe(false);
    expect(isMatchState({ type: 'error', v: 1 })).toBe(false);
    expect(ONLINE_SPELL_IDS).toHaveLength(6);
  });

  it('accepts a server cast acknowledgment and rejects malformed acknowledgments', () => {
    const ack = { type: 'cast_ack', v: 1, seq: 4, spellId: 'rune.triangle', acceptedAtMs: 1000, revision: 7 };
    expect(isCastAck(ack)).toBe(true);
    expect(isCastAck({ ...ack, spellId: 'unknown' })).toBe(false);
    expect(isCastAck({ ...ack, seq: -1 })).toBe(false);
    expect(isCastAck({ ...ack, acceptedAtMs: '1000' })).toBe(false);
  });
});

describe('room invitations', () => {
  it('normalizes six-character codes for join and post-sign-in redirects', () => {
    expect(normalizeRoomCode(' ab12cd ')).toBe('AB12CD');
    expect(roomCodeFromSearch('?room=ab12cd')).toBe('AB12CD');
    expect(roomCodeFromSearch('?room=1')).toBeUndefined();
    expect(normalizeRoomCode('../BAD')).toBeUndefined();
  });
});
