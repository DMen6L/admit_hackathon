import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandProcessingResult } from '../input/process-hands';
import type { RecordedStroke } from '../drawing/path-recorder';
import type { ShapeEvaluation } from '../shapes/shape-evaluator';

export interface CaptureFrame {
  elapsedMs: number;
  landmarks: Array<Array<{ x: number; y: number; z: number }>>;
  worldLandmarks: Array<Array<{ x: number; y: number; z: number }>>;
  labels: string[];
  poses: Array<{ id: string; phase: string; indexRaised: boolean; releasePose: boolean; justStarted: boolean; justReleased: boolean }>;
}

export interface CaptureCast {
  elapsedMs: number;
  stroke: RecordedStroke;
  evaluation: ShapeEvaluation;
}

export interface RecognitionCapture {
  schemaVersion: 1;
  width: number;
  height: number;
  frames: CaptureFrame[];
  casts: CaptureCast[];
  partialStrokes?: RecordedStroke[];
}

/** Kept in memory until the player explicitly downloads the JSON. No camera pixels are stored. */
export class RecognitionCaptureSession {
  static readonly MAX_FRAMES = 900;
  private startedAt?: number;
  private frames: CaptureFrame[] = [];
  private casts: CaptureCast[] = [];
  private partialStrokes: RecordedStroke[] = [];
  private width = 0;
  private height = 0;

  recordFrame(results: HandLandmarkerResult, processed: HandProcessingResult, nowMs: number, width: number, height: number,
    strokes: readonly RecordedStroke[] = []): boolean {
    if (this.frames.length >= RecognitionCaptureSession.MAX_FRAMES) return false;
    this.startedAt ??= nowMs;
    this.width = width;
    this.height = height;
    const clone = (hands: typeof results.landmarks) => hands.map((hand) => hand.map((p) => ({ x: p.x, y: p.y, z: p.z })));
    this.frames.push({
      elapsedMs: nowMs - this.startedAt,
      landmarks: clone(results.landmarks),
      worldLandmarks: clone(results.worldLandmarks),
      labels: results.landmarks.map((_, i) => results.handedness[i]?.[0]?.categoryName ?? `Hand ${i + 1}`),
      poses: processed.hands.map((hand) => ({
        id: hand.id, phase: hand.phase, indexRaised: hand.indexRaised, releasePose: hand.releasePose,
        justStarted: hand.justStarted, justReleased: hand.justReleased,
      })),
    });
    if (strokes.length > 0) this.partialStrokes = structuredClone([...strokes]);
    return true;
  }

  recordCast(stroke: RecordedStroke, evaluation: ShapeEvaluation, nowMs: number): void {
    this.casts.push({ elapsedMs: nowMs - (this.startedAt ?? nowMs), stroke: structuredClone(stroke), evaluation: structuredClone(evaluation) });
    this.partialStrokes = this.partialStrokes.filter((partial) => partial.key !== stroke.key);
  }

  export(): RecognitionCapture {
    return { schemaVersion: 1, width: this.width, height: this.height, frames: structuredClone(this.frames),
      casts: structuredClone(this.casts), partialStrokes: structuredClone(this.partialStrokes) };
  }

  reset(): void {
    this.startedAt = undefined;
    this.frames = [];
    this.casts = [];
    this.partialStrokes = [];
    this.width = 0;
    this.height = 0;
  }
}

export function parseCapture(value: unknown): RecognitionCapture {
  if (!value || typeof value !== 'object') throw new Error('Invalid capture');
  const capture = value as Partial<RecognitionCapture>;
  if (capture.schemaVersion !== 1 || !Array.isArray(capture.frames) || !Array.isArray(capture.casts)
    || !Number.isFinite(capture.width) || !Number.isFinite(capture.height)
    || (capture.width ?? 0) <= 0 || (capture.height ?? 0) <= 0
    || capture.frames.some((frame) => !Number.isFinite(frame.elapsedMs) || !Array.isArray(frame.landmarks)
      || !Array.isArray(frame.worldLandmarks) || !Array.isArray(frame.labels))) {
    throw new Error('Unsupported or malformed capture');
  }
  return capture as RecognitionCapture;
}
