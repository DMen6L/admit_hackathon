import type { Spell } from '../duel/demo-duel';
import { audioAssetUrl } from './audio-asset-url';

interface Note {
  from: number;
  to: number;
  at: number;
  duration: number;
  wave: OscillatorType;
  volume: number;
}

/** Short synthesized cues for spells without recordings, or if a recording is unavailable. */
export const SPELL_SOUNDS: Readonly<Record<Spell, readonly Note[]>> = {
  spark: [
    { from: 660, to: 1040, at: 0, duration: .10, wave: 'triangle', volume: .10 },
    { from: 1320, to: 840, at: .035, duration: .12, wave: 'sine', volume: .055 },
  ],
  fireball: [
    { from: 170, to: 430, at: 0, duration: .26, wave: 'sawtooth', volume: .075 },
    { from: 280, to: 115, at: .13, duration: .32, wave: 'triangle', volume: .10 },
  ],
  shield: [
    { from: 330, to: 440, at: 0, duration: .30, wave: 'sine', volume: .11 },
    { from: 660, to: 880, at: .08, duration: .40, wave: 'sine', volume: .075 },
  ],
  lightning: [
    { from: 1180, to: 420, at: 0, duration: .095, wave: 'square', volume: .045 },
    { from: 860, to: 280, at: .095, duration: .11, wave: 'square', volume: .045 },
    { from: 1420, to: 560, at: .20, duration: .13, wave: 'square', volume: .045 },
  ],
  'time-lock': [
    { from: 740, to: 720, at: 0, duration: .27, wave: 'sine', volume: .09 },
    { from: 554, to: 540, at: .19, duration: .30, wave: 'sine', volume: .085 },
    { from: 440, to: 425, at: .38, duration: .40, wave: 'sine', volume: .07 },
  ],
  'twin-flare': [
    { from: 230, to: 390, at: 0, duration: .36, wave: 'triangle', volume: .09 },
    { from: 345, to: 590, at: .15, duration: .42, wave: 'sawtooth', volume: .045 },
    { from: 460, to: 190, at: .40, duration: .42, wave: 'triangle', volume: .10 },
  ],
};

export const SHAPE_SOUND: Readonly<Record<string, Spell>> = {
  line: 'spark', triangle: 'fireball', circle: 'shield', zigzag: 'lightning',
  square: 'time-lock', hourglass: 'twin-flare',
};

/** Recorded effects take priority; the synthesized cues remain an offline fallback. */
export const RECORDED_SOUNDS: Partial<Record<Spell, { file: string; gain: number }>> = {
  spark: { file: 'spark.wav', gain: 2 },
  fireball: { file: 'fireball.wav', gain: .85 },
  shield: { file: 'shield.wav', gain: 6 },
  lightning: { file: 'lightning.wav', gain: 2.6 },
  'time-lock': { file: 'time-lock.mp3', gain: 1.4 },
  'twin-flare': { file: 'twin-flare.ogg', gain: 1.6 },
};

const STORAGE_KEY = 'wizard-duel:sound-muted';
const MAX_SOUND_SECONDS = 2;

interface SoundSample { buffer: AudioBuffer; offset: number; duration: number }

/** Remove quiet lead-in so the audible effect starts at the game event. */
function audibleWindow(buffer: AudioBuffer): SoundSample {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const windowFrames = Math.max(1, Math.round(buffer.sampleRate * .01));
  const levels: number[] = [];
  for (let start = 0; start < buffer.length; start += windowFrames) {
    let power = 0;
    const end = Math.min(start + windowFrames, buffer.length);
    for (const channel of channels) {
      for (let frame = start; frame < end; frame++) power += channel[frame] ** 2;
    }
    levels.push(Math.sqrt(power / ((end - start) * channels.length)));
  }
  const threshold = Math.max(.002, Math.max(...levels) * .08);
  const firstAudible = levels.findIndex((level) => level >= threshold);
  const offset = firstAudible < 0 ? 0 : Math.max(0, firstAudible * windowFrames / buffer.sampleRate - .01);
  return { buffer, offset, duration: Math.min(MAX_SOUND_SECONDS, buffer.duration - offset) };
}

export class SpellAudio {
  private context: AudioContext | undefined;
  private muted = false;
  private readonly listeners = new Set<(muted: boolean) => void>();
  private readonly samples = new Map<Spell, SoundSample>();
  private readonly sampleLoads = new Map<Spell, Promise<void>>();

  constructor() {
    try { this.muted = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'true'; } catch { /* Private storage can be unavailable. */ }
  }

  get isMuted(): boolean { return this.muted; }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try { window.localStorage.setItem(STORAGE_KEY, String(muted)); } catch { /* Sound still works for this page. */ }
    this.listeners.forEach((listener) => listener(muted));
    if (!muted) void this.unlock();
  }

  subscribe(listener: (muted: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.muted);
    return () => this.listeners.delete(listener);
  }

  async unlock(): Promise<void> {
    if (this.muted || !('AudioContext' in window)) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* Keep gameplay working if audio is unavailable. */ }
  }

  async preload(): Promise<void> {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    const loads: Promise<void>[] = [];
    for (const [spell, settings] of Object.entries(RECORDED_SOUNDS) as [Spell, NonNullable<typeof RECORDED_SOUNDS[Spell]>][]) {
      const existing = this.sampleLoads.get(spell);
      if (existing) { loads.push(existing); continue; }
      const loading = fetch(audioAssetUrl(settings.file))
        .then((response) => { if (!response.ok) throw new Error('Audio unavailable'); return response.arrayBuffer(); })
        .then(async (data) => {
          this.context ??= new AudioContext();
          this.samples.set(spell, audibleWindow(await this.context.decodeAudioData(data)));
        })
        .catch(() => { /* A missing recording falls back to the synthesized cue. */ });
      this.sampleLoads.set(spell, loading);
      loads.push(loading);
    }
    await Promise.all(loads);
  }

  private playRecorded(spell: Spell, context: AudioContext, start: number, maxDurationSeconds: number): boolean {
    const sample = this.samples.get(spell);
    const settings = RECORDED_SOUNDS[spell];
    if (!sample || !settings) return false;
    const { buffer, offset } = sample;
    const duration = Math.min(sample.duration, maxDurationSeconds);
    if (duration <= .06) return false;
    try {
      const source = context.createBufferSource();
      const gain = context.createGain();
      const compressor = context.createDynamicsCompressor();
      const end = start + duration;
      source.buffer = buffer;
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.linearRampToValueAtTime(settings.gain, start + .02);
      gain.gain.setValueAtTime(settings.gain, end - Math.min(.08, duration / 4));
      gain.gain.linearRampToValueAtTime(.0001, end);
      compressor.threshold.value = -12;
      compressor.ratio.value = 8;
      source.connect(gain);
      gain.connect(compressor);
      compressor.connect(context.destination);
      source.start(start, offset, duration);
      source.onended = () => { source.disconnect(); gain.disconnect(); compressor.disconnect(); };
      return true;
    } catch { return false; }
  }

  play(spell: Spell, maxDurationMs = MAX_SOUND_SECONDS * 1000): void {
    if (this.muted || maxDurationMs <= 60) return;
    const schedule = (remainingMs: number) => {
      const context = this.context;
      if (!context || context.state !== 'running' || this.muted || remainingMs <= 60) return;
      const start = context.currentTime + .008;
      const maxDurationSeconds = Math.min(MAX_SOUND_SECONDS, remainingMs / 1000);
      if (this.playRecorded(spell, context, start, maxDurationSeconds)) return;
      for (const note of SPELL_SOUNDS[spell]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = start + note.at;
        const end = Math.min(at + note.duration, start + maxDurationSeconds);
        if (end <= at + .02) continue;
        oscillator.type = note.wave;
        oscillator.frequency.setValueAtTime(note.from, at);
        oscillator.frequency.exponentialRampToValueAtTime(note.to, end);
        gain.gain.setValueAtTime(.0001, at);
        gain.gain.exponentialRampToValueAtTime(note.volume, at + .018);
        gain.gain.exponentialRampToValueAtTime(.0001, end);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at);
        oscillator.stop(end + .02);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
    };
    if (this.context?.state === 'running') { schedule(maxDurationMs); return; }
    const requestedAt = performance.now();
    void this.unlock().then(() => schedule(maxDurationMs - (performance.now() - requestedAt)));
  }
}

export const spellAudio = new SpellAudio();

/** Call once per page; browser audio unlocks on the first user interaction. */
export function mountSoundToggle(button: HTMLButtonElement): () => void {
  void spellAudio.preload();
  const unsubscribe = spellAudio.subscribe((muted) => {
    button.textContent = muted ? 'Sound off' : 'Sound on';
    button.setAttribute('aria-pressed', String(!muted));
    button.setAttribute('aria-label', muted ? 'Enable spell sounds' : 'Mute spell sounds');
  });
  const toggle = () => spellAudio.setMuted(!spellAudio.isMuted);
  const unlock = () => { void spellAudio.unlock(); };
  button.addEventListener('click', toggle);
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  return () => {
    unsubscribe();
    button.removeEventListener('click', toggle);
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
}
