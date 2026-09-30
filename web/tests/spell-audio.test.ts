import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RECORDED_SOUNDS, SHAPE_SOUND, SPELL_SOUNDS, SpellAudio } from '../src/audio/spell-audio';
import { DEFAULT_SHAPE_TEMPLATES } from '../src/shapes/shape-evaluator';
import { confirmedSpellSounds, releasedAttackSounds } from '../src/audio/online-sounds';
import { opponentSoundDelayMs } from '../src/audio/sound-timing';
import { ONLINE_SPELL_IDS, type MatchState } from '../src/multiplayer/protocol';

const baseState: MatchState = {
  type: 'state', v: 1, revision: 1, serverTimeMs: 0, phase: 'active',
  connectedSeats: [0, 1], winner: null, attacks: [], casts: [], impacts: [],
  players: [
    { seat: 0, login: 'one', health: 100, castReadyAtMs: 0, shieldReadyAtMs: 0, shieldUntilMs: 0, slowNextAttack: false },
    { seat: 1, login: 'two', health: 100, castReadyAtMs: 0, shieldReadyAtMs: 0, shieldUntilMs: 0, slowNextAttack: false },
  ],
};

describe('spell audio cues', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it('sounds only immediate confirmed effects, not attack warnings', () => {
    const cast: MatchState = {
      ...baseState, revision: 2,
      casts: [
        { id: 2, seat: 1, spellId: 'rune.triangle', atMs: 100 },
        { id: 3, seat: 0, spellId: 'rune.circle', atMs: 200 },
        { id: 4, seat: 0, spellId: 'rune.square', atMs: 300 },
      ],
    };
    expect(confirmedSpellSounds(undefined, cast)).toEqual([]);
    expect(confirmedSpellSounds(baseState, cast)).toEqual(['shield', 'time-lock']);
    expect(confirmedSpellSounds(cast, cast)).toEqual([]);
  });

  it('does not play attack sounds at the start of an online warning', () => {
    const next: MatchState = {
      ...baseState,
      casts: ONLINE_SPELL_IDS.map((spellId, index) => ({ id: index + 2, seat: index % 2, spellId, atMs: 100 + index })),
    };
    expect(confirmedSpellSounds(baseState, next)).toEqual(['shield', 'time-lock']);
  });

  it('plays each online attack once at release, even if Time Lock delays it', () => {
    const played = new Set<string>();
    const warned = new Set<string>();
    const attack: MatchState = {
      ...baseState,
      attacks: [
        { seat: 0, spellId: 'rune.triangle', startedAtMs: 100, releaseAtMs: 3100, impactAtMs: 3900, slowed: false },
        { seat: 1, spellId: 'rune.lightning', startedAtMs: 200, releaseAtMs: 3200, impactAtMs: 3700, slowed: false },
      ],
    };
    expect(releasedAttackSounds(attack, 3099, played, warned, 0)).toEqual([]);
    warned.add('1:200');
    attack.attacks[0].releaseAtMs = 4600;
    attack.attacks[0].impactAtMs = 5400;
    expect(releasedAttackSounds(attack, 3200, played, warned, 0)).toEqual([]);
    expect(releasedAttackSounds(attack, 3201, played, warned, 0)).toEqual([]);
    expect(releasedAttackSounds(attack, 3249, played, warned, 0)).toEqual([]);
    expect(releasedAttackSounds(attack, 3250, played, warned, 0)).toEqual([{ spell: 'lightning', remainingMs: 450 }]);
    expect(releasedAttackSounds(attack, 3251, played, warned, 0)).toEqual([]);
    expect(releasedAttackSounds(attack, 4601, played, warned, 0)).toEqual([{ spell: 'fireball', remainingMs: 799 }]);
    expect(releasedAttackSounds(attack, 4700, played, warned, 0)).toEqual([]);
  });

  it('does not play an opponent attack if its warning was never shown', () => {
    const played = new Set<string>();
    const late: MatchState = {
      ...baseState,
      attacks: [{ seat: 1, spellId: 'rune.triangle', startedAtMs: 100,
        releaseAtMs: 3100, impactAtMs: 3900, slowed: false }],
    };
    expect(releasedAttackSounds(late, 3300, played, new Set(), 0)).toEqual([]);
    expect(played.has('1:100')).toBe(true);
    expect(releasedAttackSounds(late, 3400, played, new Set(['1:100']), 0)).toEqual([]);
  });

  it('keeps the opponent audio gap brief even for fast projectiles', () => {
    expect(opponentSoundDelayMs(3000, 3200)).toBe(20);
    expect(opponentSoundDelayMs(3000, 3800)).toBe(80);
  });

  it('bundles a distinct audio recording for every spell', () => {
    expect(Object.keys(RECORDED_SOUNDS).sort()).toEqual(Object.values(SHAPE_SOUND).sort());
    for (const settings of Object.values(RECORDED_SOUNDS)) {
      if (!settings) continue;
      const file = readFileSync(new URL(`../public/assets/audio/${settings.file}`, import.meta.url));
      expect(file.length).toBeGreaterThan(10_000);
      if (settings.file.endsWith('.wav')) {
        expect(file.toString('ascii', 0, 4)).toBe('RIFF');
        expect(file.toString('ascii', 8, 12)).toBe('WAVE');
        expect(file.readUInt32LE(4) + 8).toBe(file.length);
      } else if (settings.file.endsWith('.ogg')) {
        expect(file.toString('ascii', 0, 4)).toBe('OggS');
      } else {
        expect(file.toString('ascii', 0, 3)).toBe('ID3');
      }
    }
  });

  it('plays a preloaded recording with its selected trim and gain', async () => {
    const starts: unknown[][] = [];
    let oscillators = 0;
    const gainValues: number[] = [];
    const parameter = {
      setValueAtTime(value: number) { gainValues.push(value); },
      linearRampToValueAtTime(value: number) { gainValues.push(value); },
      exponentialRampToValueAtTime() {},
    };
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      async resume() {}
      async decodeAudioData() {
        const samples = new Float32Array(4500);
        samples.fill(.1, 500, 2500);
        return { duration: 4.5, length: samples.length, sampleRate: 1000,
          numberOfChannels: 1, getChannelData: () => samples };
      }
      createBufferSource() {
        return { buffer: null, connect() {}, start(...args: unknown[]) { starts.push(args); }, disconnect() {}, onended: null };
      }
      createGain() { return { gain: parameter, connect() {}, disconnect() {} }; }
      createDynamicsCompressor() {
        return { threshold: { value: 0 }, ratio: { value: 0 }, connect() {}, disconnect() {} };
      }
      createOscillator() { oscillators += 1; return {}; }
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext, localStorage: { getItem: () => null } });
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const audio = new SpellAudio();
    await audio.preload();
    audio.play('shield');
    await Promise.resolve();
    expect(starts).toHaveLength(1);
    expect(starts[0][0]).toBe(.008);
    expect(starts[0][1]).toBeCloseTo(.49);
    expect(starts[0][2]).toBe(2);
    expect(gainValues).toContain(RECORDED_SOUNDS.shield?.gain);
    expect(oscillators).toBe(0);
    audio.play('fireball', 500);
    await Promise.resolve();
    expect(starts[1][2]).toBe(.5);
  });

  it('schedules audio for every spell and stays silent when muted', async () => {
    let oscillators = 0;
    const parameter = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      createOscillator() {
        oscillators += 1;
        return { frequency: parameter, type: 'sine', connect: (gain: object) => gain, start() {}, stop() {}, disconnect() {} };
      }
      createGain() { return { gain: parameter, connect() {}, disconnect() {} }; }
      async resume() {}
    }
    vi.stubGlobal('window', { AudioContext: FakeAudioContext, localStorage: { getItem: () => null, setItem() {} } });
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const audio = new SpellAudio();
    for (const spell of Object.values(SHAPE_SOUND)) {
      audio.play(spell);
      await Promise.resolve();
    }
    expect(oscillators).toBe(Object.values(SPELL_SOUNDS).reduce((total, notes) => total + notes.length, 0));
    audio.setMuted(true);
    audio.play('fireball');
    await Promise.resolve();
    expect(oscillators).toBe(Object.values(SPELL_SOUNDS).reduce((total, notes) => total + notes.length, 0));
  });

  it('does not play an attack after a delayed audio unlock outlasts its flight', async () => {
    let finishResume = () => {};
    let now = 0;
    let oscillators = 0;
    class FakeAudioContext {
      state = 'suspended';
      async resume() {
        await new Promise<void>((resolve) => { finishResume = resolve; });
        this.state = 'running';
      }
      createOscillator() { oscillators += 1; return {}; }
    }
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('window', { AudioContext: FakeAudioContext, localStorage: { getItem: () => null } });
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const audio = new SpellAudio();
    audio.play('fireball', 300);
    now = 350;
    finishResume();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(oscillators).toBe(0);
  });
});
