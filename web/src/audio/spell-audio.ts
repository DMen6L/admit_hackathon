import type { Spell } from '../duel/demo-duel';

interface Note {
  from: number;
  to: number;
  at: number;
  duration: number;
  wave: OscillatorType;
  volume: number;
}

/** Short, deliberately quiet cues. No external audio asset or network request is needed. */
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

const STORAGE_KEY = 'wizard-duel:sound-muted';

class SpellAudio {
  private context: AudioContext | undefined;
  private muted = false;
  private readonly listeners = new Set<(muted: boolean) => void>();

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

  play(spell: Spell): void {
    if (this.muted) return;
    void this.unlock().then(() => {
      const context = this.context;
      if (!context || context.state !== 'running' || this.muted) return;
      const start = context.currentTime + .008;
      for (const note of SPELL_SOUNDS[spell]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = start + note.at;
        const end = at + note.duration;
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
    });
  }
}

export const spellAudio = new SpellAudio();

/** Call once per page; browser audio unlocks on the first user interaction. */
export function mountSoundToggle(button: HTMLButtonElement): () => void {
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
