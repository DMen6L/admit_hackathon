export interface PathPoint {
  x: number;
  y: number;
}

export interface PathHandState {
  handIndex: number;
  label: string;
  isCasting: boolean;
  justStarted: boolean;
  justEnded: boolean;
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

export class IndexPathRecorder {
  private readonly strokes = new Map<string, RecordedStroke>();

  update(hands: readonly PathHandState[], landmarks: readonly PathPoint[][]): void {
    const visibleKeys = new Set<string>();

    for (const hand of hands) {
      const key = keyFor(hand);
      visibleKeys.add(key);

      if (hand.justEnded || !hand.isCasting) {
        this.strokes.delete(key);
        continue;
      }

      const tip = landmarks[hand.handIndex]?.[INDEX_TIP];
      if (!tip) continue;

      const point = normalize(tip);
      let stroke = this.strokes.get(key);
      if (!stroke || hand.justStarted) {
        stroke = { key, label: hand.label, points: [] };
        this.strokes.set(key, stroke);
      }

      const previous = stroke.points.at(-1);
      if (!previous) {
        stroke.points.push(point);
        continue;
      }

      if (distance(previous, point) >= MIN_POINT_DISTANCE) {
        stroke.points.push({
          x: previous.x + (point.x - previous.x) * SMOOTHING_ALPHA,
          y: previous.y + (point.y - previous.y) * SMOOTHING_ALPHA,
        });
      }
    }

    for (const key of this.strokes.keys()) {
      if (!visibleKeys.has(key)) this.strokes.delete(key);
    }
  }

  getStrokes(): RecordedStroke[] {
    return [...this.strokes.values()].map((stroke) => ({
      key: stroke.key,
      label: stroke.label,
      points: stroke.points.map((point) => ({ ...point })),
    }));
  }

  reset(): void {
    this.strokes.clear();
  }
}
