import type { CastingPhase } from '../input/process-hands';

export interface PathPoint {
  x: number;
  y: number;
}

export interface PathHandState {
  handIndex: number;
  label: string;
  phase: CastingPhase;
  isCasting: boolean;
  justStarted: boolean;
  justReleased: boolean;
  releaseCancelled: boolean;
}

export interface RecordedStroke {
  key: string;
  label: string;
  points: PathPoint[];
}

const INDEX_TIP = 8;
const MIN_POINT_DISTANCE = 0.008;
const SMOOTHING_ALPHA = 0.45;

function keyFor(hand: PathHandState): string {
  return `${hand.label}-${hand.handIndex}`;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalize(point: PathPoint): PathPoint {
  return { x: clamp(point.x), y: clamp(point.y) };
}

function distance(a: PathPoint, b: PathPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cloneStroke(stroke: RecordedStroke): RecordedStroke {
  return {
    key: stroke.key,
    label: stroke.label,
    points: stroke.points.map((point) => ({ ...point })),
  };
}

export class IndexPathRecorder {
  private readonly strokes = new Map<string, RecordedStroke>();

  update(hands: readonly PathHandState[], landmarks: readonly PathPoint[][]): RecordedStroke[] {
    const visibleKeys = new Set<string>();
    const completed: RecordedStroke[] = [];

    for (const hand of hands) {
      const key = keyFor(hand);
      visibleKeys.add(key);
      const stroke = this.strokes.get(key);

      if (hand.justReleased) {
        if (stroke && stroke.points.length > 0) completed.push(cloneStroke(stroke));
        this.strokes.delete(key);
        continue;
      }

      if (hand.releaseCancelled || hand.phase === 'idle') {
        this.strokes.delete(key);
        continue;
      }

      if (hand.phase === 'awaiting-release') continue;

      const tip = landmarks[hand.handIndex]?.[INDEX_TIP];
      if (!tip || !hand.isCasting) continue;

      const point = normalize(tip);
      let activeStroke = stroke;
      if (!activeStroke || hand.justStarted) {
        activeStroke = { key, label: hand.label, points: [] };
        this.strokes.set(key, activeStroke);
      }

      const previous = activeStroke.points.at(-1);
      if (!previous) {
        activeStroke.points.push(point);
        continue;
      }

      if (distance(previous, point) >= MIN_POINT_DISTANCE) {
        activeStroke.points.push({
          x: previous.x + (point.x - previous.x) * SMOOTHING_ALPHA,
          y: previous.y + (point.y - previous.y) * SMOOTHING_ALPHA,
        });
      }
    }

    for (const key of this.strokes.keys()) {
      if (!visibleKeys.has(key)) this.strokes.delete(key);
    }

    return completed;
  }

  getStrokes(): RecordedStroke[] {
    return [...this.strokes.values()].map(cloneStroke);
  }

  reset(): void {
    this.strokes.clear();
  }
}
