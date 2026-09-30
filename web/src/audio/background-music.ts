import type { SpellAudio } from './spell-audio';
import { audioAssetUrl } from './audio-asset-url';

const MUSIC_FILE = '[trimmed] videoplayback.wav';

/** One looping track per page, active only while gameplay or a tutorial is running. */
export class BackgroundMusic {
  private active = false;
  private muted = false;
  private interacted = false;
  private disposed = false;
  private pendingPlay: Promise<void> | undefined;
  private readonly unsubscribe: () => void;

  constructor(sound: Pick<SpellAudio, 'subscribe'>,
    private readonly audio: HTMLAudioElement = new Audio(audioAssetUrl(MUSIC_FILE))) {
    this.audio.loop = true;
    this.audio.volume = .04;
    this.audio.preload = 'none';
    this.unsubscribe = sound.subscribe((muted) => {
      this.muted = muted;
      this.sync();
    });
    document.addEventListener('pointerdown', this.interact);
    document.addEventListener('keydown', this.interact);
    document.addEventListener('visibilitychange', this.sync);
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    this.sync();
  }

  private readonly interact = () => {
    this.interacted = true;
    this.sync();
  };

  private readonly sync = () => {
    if (this.disposed || !this.active || this.muted || document.hidden) {
      this.audio.pause();
      return;
    }
    if (!this.interacted) return;
    if (!this.audio.paused || this.pendingPlay) return;
    try {
      let started = false;
      this.pendingPlay = this.audio.play().then(() => {
        started = true;
        if (this.disposed || !this.active || this.muted || document.hidden) this.audio.pause();
      }).catch(() => { /* Autoplay may be blocked; retry on the next user interaction. */ })
        .finally(() => {
          this.pendingPlay = undefined;
          if (started && this.active && !this.muted && !document.hidden && this.audio.paused) this.sync();
        });
    } catch { /* Keep the match playable if media playback is unavailable. */ }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.audio.pause();
    this.unsubscribe();
    document.removeEventListener('pointerdown', this.interact);
    document.removeEventListener('keydown', this.interact);
    document.removeEventListener('visibilitychange', this.sync);
  }
}
