import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundMusic } from '../src/audio/background-music';
import { audioAssetUrl } from '../src/audio/audio-asset-url';

describe('background music', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the live dev-server audio path and encodes the supplied filename', () => {
    expect(audioAssetUrl('[trimmed] videoplayback.wav')).toBe('/public/assets/audio/%5Btrimmed%5D%20videoplayback.wav');
  });

  it('loops only while active, visible, and sound is enabled', async () => {
    const listeners = new Map<string, EventListener>();
    const page = {
      hidden: false,
      addEventListener(type: string, listener: EventListener) { listeners.set(type, listener); },
      removeEventListener(type: string) { listeners.delete(type); },
    };
    vi.stubGlobal('document', page);
    let setMuted: (muted: boolean) => void = () => {};
    const sound = {
      subscribe(listener: (muted: boolean) => void) {
        setMuted = listener;
        listener(false);
        return vi.fn();
      },
    };
    const track = {
      paused: true,
      loop: false,
      volume: 1,
      preload: 'auto',
      play: vi.fn(async () => { track.paused = false; }),
      pause: vi.fn(() => { track.paused = true; }),
    };
    const music = new BackgroundMusic(sound, track as unknown as HTMLAudioElement);
    expect(track.loop).toBe(true);
    expect(track.volume).toBe(.04);
    expect(track.preload).toBe('none');
    expect(track.play).not.toHaveBeenCalled();

    music.setActive(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(track.play).toHaveBeenCalledTimes(1);
    music.setActive(false);
    expect(track.paused).toBe(true);
    music.setActive(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(track.play).toHaveBeenCalledTimes(2);
    setMuted(true);
    expect(track.paused).toBe(true);
    setMuted(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(track.play).toHaveBeenCalledTimes(3);
    page.hidden = true;
    listeners.get('visibilitychange')?.({} as Event);
    expect(track.paused).toBe(true);
    page.hidden = false;
    listeners.get('visibilitychange')?.({} as Event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(track.play).toHaveBeenCalledTimes(4);
    music.dispose();
    expect(track.paused).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it('retries after autoplay is blocked by the browser', async () => {
    const listeners = new Map<string, EventListener>();
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener(type: string, listener: EventListener) { listeners.set(type, listener); },
      removeEventListener(type: string) { listeners.delete(type); },
    });
    let attempts = 0;
    const track = {
      paused: true, loop: false, volume: 1, preload: 'auto',
      play: vi.fn(() => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('NotAllowedError'));
        track.paused = false;
        return Promise.resolve();
      }),
      pause: vi.fn(),
    };
    const music = new BackgroundMusic({ subscribe(listener) { listener(false); return () => {}; } }, track as unknown as HTMLAudioElement);
    music.setActive(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(track.play).toHaveBeenCalledTimes(1);
    listeners.get('pointerdown')?.({} as Event);
    await Promise.resolve();
    expect(track.play).toHaveBeenCalledTimes(2);
    music.dispose();
  });
});
