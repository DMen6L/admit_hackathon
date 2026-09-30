export interface AnimationClip {
  id: string;
  character: string;
  state: string;
  width: number;
  height: number;
  pivot: { x: number; y: number };
  loop: boolean;
  uniquePoses: number;
  frames: { path: string; durationMs: number }[];
  /** Zero-based frame indices. These are visual cues, not authoritative game commands. */
  events: { frame: number; name: string }[];
}

export interface AssetManifest {
  version: 1;
  arena: string;
  clips: AnimationClip[];
  effects: EffectClip[];
}

export interface EffectClip {
  id: string;
  width: number;
  height: number;
  pivot: { x: number; y: number };
  frames: { path: string; durationMs: number }[];
}

/** Pure clock sampling keeps playback independent of rendering frame rate. */
export function sampleAnimation(clip: AnimationClip, elapsedMs: number): { frame: number; finished: boolean } {
  const duration = clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  if (!clip.frames.length || duration <= 0 || clip.frames.some((frame) => frame.durationMs <= 0)) {
    throw new Error('Длительность кадров анимации должна быть положительной.');
  }
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (!clip.loop && elapsed >= duration) return { frame: clip.frames.length - 1, finished: true };
  let time = clip.loop ? elapsed % duration : elapsed;
  for (const [frame, value] of clip.frames.entries()) {
    if (time < value.durationMs) return { frame, finished: false };
    time -= value.durationMs;
  }
  return { frame: clip.frames.length - 1, finished: false };
}
