import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';

const THUMB_TIP = 4;
const THUMB_IP = 3;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_PIP = 18;
const PINKY_TIP = 20;
const WRIST = 0;

const RAISED_INDEX_START_FRAMES = 4;
const RAISED_INDEX_RELEASE_FRAMES = 2;
const INDEX_VERTICAL_MARGIN = 0.10;
const INDEX_EXTENSION_RATIO = 1.08;
const CURLED_FINGER_RATIO = 1.08;
const THUMB_PALM_RATIO = 1.25;

export interface CastingDiagnostics {
  indexRaised: boolean;
  otherFingersCurled: boolean;
  thumbRelaxed: boolean;
  curledFingerCount: number;
  correction?: string;
}

export interface CastingHandState extends CastingDiagnostics {
  handIndex: number;
  label: string;
  isRaised: boolean;
  isCasting: boolean;
  justStarted: boolean;
  justEnded: boolean;
  indexExtension: number;
  handScale: number;
}

export interface HandProcessingResult {
  hands: CastingHandState[];
  castingHands: number;
}

interface Point {
  x: number;
  y: number;
  z?: number;
}

interface CastingState {
  candidateFrames: number;
  releaseFrames: number;
  isCasting: boolean;
}

const previousCasting = new Map<string, CastingState>();

export function resetHandProcessing(): void {
  previousCasting.clear();
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

function handLabel(results: HandLandmarkerResult, handIndex: number): string {
  return results.handedness[handIndex]?.[0]?.categoryName ?? `Hand ${handIndex + 1}`;
}

function fingerIsCurled(points: Point[], pipIndex: number, tipIndex: number, handScale: number): boolean {
  const tipDistance = distance(points[WRIST], points[tipIndex]);
  const pipDistance = distance(points[WRIST], points[pipIndex]);
  const palmDistance = distance(points[MIDDLE_MCP], points[tipIndex]);
  return tipDistance <= pipDistance * CURLED_FINGER_RATIO
    && palmDistance <= handScale * 1.35;
}

function correctionFor(diagnostics: CastingDiagnostics): string | undefined {
  if (!diagnostics.indexRaised) return 'Raise your index finger';
  if (!diagnostics.otherFingersCurled) return 'Curl your middle, ring, and pinky fingers';
  if (!diagnostics.thumbRelaxed) return 'Relax your thumb toward your palm';
  return undefined;
}

/**
 * Recognize a stable raised-index casting pose from MediaPipe landmarks.
 *
 * The index must extend upward while the middle, ring, and pinky remain curled.
 * Distances use world landmarks when available; the image-space vertical check
 * keeps the definition tied to the player's visible raised finger.
 */
export function processHands(
  results: HandLandmarkerResult,
  _timestampMs: number,
): HandProcessingResult {
  const hands = results.landmarks.map((landmarks, handIndex) => {
    const world = results.worldLandmarks[handIndex];
    const metricPoints = world?.length === landmarks.length ? world : landmarks;
    const imagePoints = landmarks;
    const handScale = distance(metricPoints[WRIST], metricPoints[MIDDLE_MCP]);
    const imageHandScale = distance(imagePoints[WRIST], imagePoints[MIDDLE_MCP]);
    const indexTipDistance = distance(metricPoints[WRIST], metricPoints[INDEX_TIP]);
    const indexPipDistance = distance(metricPoints[WRIST], metricPoints[INDEX_PIP]);
    const indexExtension = handScale > Number.EPSILON
      ? indexTipDistance / handScale
      : Number.POSITIVE_INFINITY;
    const indexRaised = imagePoints[INDEX_PIP].y - imagePoints[INDEX_TIP].y
      > imageHandScale * INDEX_VERTICAL_MARGIN
      && imagePoints[INDEX_MCP].y - imagePoints[INDEX_PIP].y > imageHandScale * 0.02
      && indexTipDistance > indexPipDistance * INDEX_EXTENSION_RATIO;

    const curled = [
      fingerIsCurled(metricPoints, MIDDLE_PIP, MIDDLE_TIP, handScale),
      fingerIsCurled(metricPoints, RING_PIP, RING_TIP, handScale),
      fingerIsCurled(metricPoints, PINKY_PIP, PINKY_TIP, handScale),
    ];
    const curledFingerCount = curled.filter(Boolean).length;
    const otherFingersCurled = curledFingerCount === curled.length;
    const thumbRelaxed = distance(metricPoints[THUMB_TIP], metricPoints[MIDDLE_MCP])
      <= handScale * THUMB_PALM_RATIO
      || distance(metricPoints[WRIST], metricPoints[THUMB_TIP])
      <= distance(metricPoints[WRIST], metricPoints[THUMB_IP]) * CURLED_FINGER_RATIO;
    const diagnostics: CastingDiagnostics = {
      indexRaised,
      otherFingersCurled,
      thumbRelaxed,
      curledFingerCount,
    };
    diagnostics.correction = correctionFor(diagnostics);
    const qualifies = indexRaised && otherFingersCurled && thumbRelaxed;
    const label = handLabel(results, handIndex);
    const key = `${label}-${handIndex}`;
    const state = previousCasting.get(key) ?? {
      candidateFrames: 0,
      releaseFrames: 0,
      isCasting: false,
    };
    let justStarted = false;
    let justEnded = false;

    if (qualifies) {
      state.candidateFrames += 1;
      state.releaseFrames = 0;
      if (!state.isCasting && state.candidateFrames >= RAISED_INDEX_START_FRAMES) {
        state.isCasting = true;
        justStarted = true;
      }
    } else {
      state.candidateFrames = 0;
      if (state.isCasting) {
        state.releaseFrames += 1;
        if (state.releaseFrames >= RAISED_INDEX_RELEASE_FRAMES) {
          state.isCasting = false;
          justEnded = true;
        }
      } else {
        state.releaseFrames = 0;
      }
    }
    previousCasting.set(key, state);

    return {
      ...diagnostics,
      handIndex,
      label,
      isRaised: indexRaised,
      isCasting: state.isCasting,
      justStarted,
      justEnded,
      indexExtension,
      handScale,
    };
  });

  const visibleKeys = new Set(hands.map((hand) => `${hand.label}-${hand.handIndex}`));
  for (const key of previousCasting.keys()) {
    if (!visibleKeys.has(key)) previousCasting.delete(key);
  }

  return {
    hands,
    castingHands: hands.filter((hand) => hand.isCasting).length,
  };
}
