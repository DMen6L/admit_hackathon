import { describe, expect, it } from 'vitest';
import { SHAPE_SOUND, SPELL_SOUNDS } from '../src/audio/spell-audio';
import { DEFAULT_SHAPE_TEMPLATES } from '../src/shapes/shape-evaluator';
import { confirmedSpellSounds } from '../src/audio/online-sounds';
import type { MatchState } from '../src/multiplayer/protocol';

const baseState: MatchState = {
  type: 'state', v: 1, revision: 1, serverTimeMs: 0, phase: 'active',
  connectedSeats: [0, 1], winner: null, attacks: [], impacts: [],
  players: [
    { seat: 0, login: 'one', health: 100, castReadyAtMs: 0, shieldReadyAtMs: 0, shieldUntilMs: 0 },
    { seat: 1, login: 'two', health: 100, castReadyAtMs: 0, shieldReadyAtMs: 0, shieldUntilMs: 0 },
  ],
};

describe('spell audio cues', () => {
  it('covers every recognized rune with a distinct, short sound pattern', () => {
    const shapes = DEFAULT_SHAPE_TEMPLATES.map((template) => template.id);
    expect(Object.keys(SHAPE_SOUND).sort()).toEqual(shapes.sort());
    expect(new Set(Object.values(SHAPE_SOUND)).size).toBe(6);
    const profiles = Object.values(SPELL_SOUNDS);
    expect(profiles).toHaveLength(6);
    expect(new Set(profiles.map((notes) => JSON.stringify(notes))).size).toBe(6);
    for (const notes of profiles) {
      expect(notes.length).toBeGreaterThan(0);
      expect(Math.max(...notes.map((note) => note.at + note.duration))).toBeLessThan(1);
      expect(notes.every((note) => note.from > 0 && note.to > 0 && note.volume > 0 && note.volume <= .11)).toBe(true);
    }
  });

  it('sounds only new server-confirmed attacks and shields', () => {
    const cast: MatchState = {
      ...baseState, revision: 2,
      attacks: [{ seat: 1, spellId: 'rune.triangle', startedAtMs: 100, releaseAtMs: 3100, impactAtMs: 3900 }],
      players: [baseState.players[0], { ...baseState.players[1], shieldUntilMs: 4500 }],
    };
    expect(confirmedSpellSounds(undefined, cast)).toEqual([]);
    expect(confirmedSpellSounds(baseState, cast)).toEqual(['fireball', 'shield']);
    expect(confirmedSpellSounds(cast, cast)).toEqual([]);
  });
});
