import type { CastingPhase } from '../input/process-hands';

export interface PathPoint {
  x: number;
  y: number;
}

export interface PathHandState {
  id?: string;
  handIndex: number;
  label: string;
  phase: CastingPhase;
  isCasting: boolean;
  justStarted: boolean;
  justReleased: boolean;
  releaseCancelled: boolean;
  poseValid?: boolean;
}

export interface TimedPathPoint extends PathPoint { elapsedMs: number }
export interface RecordedStroke {
  key: string;
  label: string;
  points: PathPoint[];
  rawPoints?: TimedPathPoint[];
  aspectRatio?: number;
}

const INDEX_TIP = 8;
const MIN_POINT_DISTANCE = 0.008;
const SMOOTHING_ALPHA = 0.45;
const TRACKING_GRACE_MS = 220;
const MAX_CONTINUATION_JUMP = 0.35;

function keyFor(hand: PathHandState): string {
  return hand.id ?? `${hand.label}-${hand.handIndex}`;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalize(point: PathPoint): PathPoint {
  return { x: clamp(point.x), y: clamp(point.y) };
}

function cloneStroke(stroke: RecordedStroke): RecordedStroke {
  return {
    key: stroke.key,
    label: stroke.label,
    points: stroke.points.map((point) => ({ ...point })),
    rawPoints: stroke.rawPoints?.map((point) => ({ ...point })),
    aspectRatio: stroke.aspectRatio,
  };
}

function adaptiveAlpha(distanceMoved: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return SMOOTHING_ALPHA;
  const seconds = Math.min(elapsedMs, 100) / 1000;
  const speed = distanceMoved / seconds;
  const cutoffHz = 3 + 12 * speed;
  return Math.min(0.95, seconds / (seconds + 1 / (2 * Math.PI * cutoffHz)));
}

export class IndexPathRecorder {
  private readonly strokes = new Map<string, RecordedStroke>();
  private readonly lastSeen = new Map<string, number>();

  update(hands: readonly PathHandState[], landmarks: readonly PathPoint[][], timestampMs = 0, aspectRatio = 1): RecordedStroke[] {
    const visibleKeys = new Set<string>();
    const completed: RecordedStroke[] = [];

    for (const hand of hands) {
      const key = keyFor(hand);
      visibleKeys.add(key);
      this.lastSeen.set(key, timestampMs);
      const stroke = this.strokes.get(key);

      if (hand.justReleased) {
        if (stroke && stroke.points.length > 0) completed.push(cloneStroke(stroke));
        this.strokes.delete(key);
        this.lastSeen.delete(key);
        continue;
      }

      if (hand.releaseCancelled || hand.phase === 'idle') {
        this.strokes.delete(key);
        this.lastSeen.delete(key);
        continue;
      }

      if (hand.phase === 'awaiting-release') continue;

      const tip = landmarks[hand.handIndex]?.[INDEX_TIP];
      if (!tip || !hand.isCasting || hand.poseValid === false) continue;

      const point = normalize(tip);
      let activeStroke = stroke;
      if (!activeStroke || hand.justStarted) {
        activeStroke = { key, label: hand.label, points: [], rawPoints: [], aspectRatio };
        this.strokes.set(key, activeStroke);
      }

      const lastRaw = activeStroke.rawPoints?.at(-1);
      if (lastRaw && Math.hypot((lastRaw.x - point.x) * aspectRatio, lastRaw.y - point.y) > MAX_CONTINUATION_JUMP) {
        this.strokes.delete(key);
        continue;
      }
      activeStroke.rawPoints?.push({ ...point, elapsedMs: timestampMs });

      const previous = activeStroke.points.at(-1);
      if (!previous) {
        activeStroke.points.push(point);
        continue;
      }

      if (Math.hypot((previous.x - point.x) * aspectRatio, previous.y - point.y) >= MIN_POINT_DISTANCE) {
        const alpha = adaptiveAlpha(
          lastRaw ? Math.hypot((lastRaw.x - point.x) * aspectRatio, lastRaw.y - point.y) : 0,
          lastRaw ? timestampMs - lastRaw.elapsedMs : 0,
        );
        activeStroke.points.push({
          x: previous.x + (point.x - previous.x) * alpha,
          y: previous.y + (point.y - previous.y) * alpha,
        });
      }
    }

    for (const key of this.strokes.keys()) {
      if (!visibleKeys.has(key) && timestampMs - (this.lastSeen.get(key) ?? timestampMs) > TRACKING_GRACE_MS) {
        this.strokes.delete(key);
        this.lastSeen.delete(key);
      }
    }

    return completed;
  }

  getStrokes(): RecordedStroke[] {
    return [...this.strokes.values()].map(cloneStroke);
  }

  reset(): void {
    this.strokes.clear();
    this.lastSeen.clear();
  }
}
