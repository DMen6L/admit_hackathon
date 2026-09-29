import { describe, expect, it } from 'vitest';
import { sampleAnimation, type AnimationClip } from '../src/assets/animation';

const clip: AnimationClip = {
  id: 'test', character: 'berik', state: 'cast', width: 80, height: 96,
  pivot: { x: 32, y: 90 }, loop: false, uniquePoses: 3, events: [],
  frames: [80, 120, 60].map((durationMs) => ({ path: '', durationMs })),
};

describe('animation clock', () => {
  it('uses elapsed time and respects variable frame boundaries', () => {
    expect(sampleAnimation(clip, 79).frame).toBe(0);
    expect(sampleAnimation(clip, 80).frame).toBe(1);
    expect(sampleAnimation(clip, 199).frame).toBe(1);
    expect(sampleAnimation(clip, 200).frame).toBe(2);
  });
  it('holds the last frame of completed one-shots', () => {
    expect(sampleAnimation(clip, 260)).toEqual({ frame: 2, finished: true });
    expect(sampleAnimation(clip, 5000)).toEqual({ frame: 2, finished: true });
  });
  it('wraps loops even after skipped rendering frames', () => {
    expect(sampleAnimation({ ...clip, loop: true }, 260)).toEqual({ frame: 0, finished: false });
    expect(sampleAnimation({ ...clip, loop: true }, 860).frame).toBe(1);
  });
  it('handles negative time and rejects empty animations', () => {
    expect(sampleAnimation(clip, -10).frame).toBe(0);
    expect(() => sampleAnimation({ ...clip, frames: [] }, 0)).toThrow();
  });
});
