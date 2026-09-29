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
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;
const WRIST = 0;

const CAST_START_MS = 90;
const POSE_GAP_MS = 100;
const PALM_HOLD_MS = 90;
const TRACKING_GRACE_MS = 220;
const RESUME_WINDOW_MS = 350;
const RELEASE_TIMEOUT_MS = 1500;
const INDEX_EXTENSION_RATIO = 1.08;
const CURLED_FINGER_RATIO = 1.08;
const THUMB_PALM_RATIO = 1.25;
const EXTENDED_FINGER_RATIO = 1.08;
const PALM_FACING_COSINE = 0.45;

export type CastingPhase = 'idle' | 'casting' | 'awaiting-release' | 'released';

export interface CastingDiagnostics {
  indexRaised: boolean;
  otherFingersCurled: boolean;
  thumbRelaxed: boolean;
  curledFingerCount: number;
  correction?: string;
  extendedFingerCount: number;
  allFingersExtended: boolean;
  releaseFingersExtended: boolean;
  palmFacingCamera: boolean;
  releasePose: boolean;
  releaseCorrection?: string;
}

export interface CastingHandState extends CastingDiagnostics {
  id: string;
  poseValid: boolean;
  handIndex: number;
  label: string;
  phase: CastingPhase;
  isRaised: boolean;
  isCasting: boolean;
  justStarted: boolean;
  justEnded: boolean;
  releaseStarted: boolean;
  justReleased: boolean;
  releaseCancelled: boolean;
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
  id: string;
  label: string;
  wrist: Point;
  lastSeenMs: number;
  candidateSinceMs: number;
  poseLostSinceMs: number;
  palmSinceMs: number;
  isCasting: boolean;
  phase: CastingPhase;
  awaitingSinceMs: number;
}

const previousCasting = new Map<string, CastingState>();
let nextHandId = 1;

export function resetHandProcessing(): void {
  previousCasting.clear();
  nextHandId = 1;
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

function fingerIsExtended(points: Point[], pipIndex: number, tipIndex: number): boolean {
  return distance(points[WRIST], points[tipIndex]) > distance(points[WRIST], points[pipIndex]) * EXTENDED_FINGER_RATIO;
}

function palmFacingCamera(points: Point[]): boolean {
  const index = {
    x: points[INDEX_MCP].x - points[WRIST].x,
    y: points[INDEX_MCP].y - points[WRIST].y,
    z: (points[INDEX_MCP].z ?? 0) - (points[WRIST].z ?? 0),
  };
  const pinky = {
    x: points[PINKY_MCP].x - points[WRIST].x,
    y: points[PINKY_MCP].y - points[WRIST].y,
    z: (points[PINKY_MCP].z ?? 0) - (points[WRIST].z ?? 0),
  };
  const normal = {
    x: index.y * pinky.z - index.z * pinky.y,
    y: index.z * pinky.x - index.x * pinky.z,
    z: index.x * pinky.y - index.y * pinky.x,
  };
  const magnitude = Math.hypot(normal.x, normal.y, normal.z);
  return magnitude > Number.EPSILON && Math.abs(normal.z) / magnitude >= PALM_FACING_COSINE;
}

function correctionFor(diagnostics: CastingDiagnostics): string | undefined {
  if (!diagnostics.indexRaised) return 'Straighten your index finger';
  if (!diagnostics.otherFingersCurled) return 'Curl your middle, ring, and pinky fingers';
  return undefined;
}

function releaseCorrectionFor(diagnostics: CastingDiagnostics): string | undefined {
  if (!diagnostics.releaseFingersExtended) return 'Extend your four fingers to release';
  if (!diagnostics.palmFacingCamera) return 'Turn your palm toward the camera';
  return undefined;
}

/**
 * Recognize a stable raised-index casting pose and a deliberate open-palm release.
 *
 * The index must extend upward while the middle, ring, and pinky remain curled.
 * Casting ends only after the hand leaves that pose; a stable camera-facing open
 * palm then confirms the release. Distances use world landmarks when available.
 */
export function processHands(
  results: HandLandmarkerResult,
  timestampMs: number,
): HandProcessingResult {
  const claimed = new Set<string>();
  const hands = results.landmarks.map((landmarks, handIndex) => {
    const world = results.worldLandmarks[handIndex];
    const metricPoints = world?.length === landmarks.length ? world : landmarks;
    const handScale = distance(metricPoints[WRIST], metricPoints[MIDDLE_MCP]);
    const indexTipDistance = distance(metricPoints[WRIST], metricPoints[INDEX_TIP]);
    const indexPipDistance = distance(metricPoints[WRIST], metricPoints[INDEX_PIP]);
    // The pointing hand may rotate while tracing a rune. Judge joint extension
    // without requiring the fingertip to stay above the knuckle on screen.
    const indexRaised = indexTipDistance > indexPipDistance * INDEX_EXTENSION_RATIO
      && distance(metricPoints[INDEX_MCP], metricPoints[INDEX_TIP])
        > distance(metricPoints[INDEX_MCP], metricPoints[INDEX_PIP]) * 1.35;

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
    const extended = [
      fingerIsExtended(metricPoints, INDEX_PIP, INDEX_TIP),
      fingerIsExtended(metricPoints, MIDDLE_PIP, MIDDLE_TIP),
      fingerIsExtended(metricPoints, RING_PIP, RING_TIP),
      fingerIsExtended(metricPoints, PINKY_PIP, PINKY_TIP),
    ];
    const thumbExtended = distance(metricPoints[WRIST], metricPoints[THUMB_TIP])
      > distance(metricPoints[WRIST], metricPoints[THUMB_IP]) * EXTENDED_FINGER_RATIO
      && distance(metricPoints[THUMB_TIP], metricPoints[INDEX_MCP]) > handScale * 0.55;
    const extendedFingerCount = extended.filter(Boolean).length + (thumbExtended ? 1 : 0);
    const allFingersExtended = extendedFingerCount === 5;
    const releaseFingersExtended = extended.every(Boolean);
    const palmIsFacingCamera = palmFacingCamera(metricPoints);
    const releasePose = releaseFingersExtended && palmIsFacingCamera;
    const diagnostics: CastingDiagnostics = {
      indexRaised,
      otherFingersCurled,
      thumbRelaxed,
      curledFingerCount,
      extendedFingerCount,
      allFingersExtended,
      releaseFingersExtended,
      palmFacingCamera: palmIsFacingCamera,
      releasePose,
    };
    diagnostics.correction = correctionFor(diagnostics);
    diagnostics.releaseCorrection = releaseCorrectionFor(diagnostics);
    const qualifies = indexRaised && otherFingersCurled;
    const label = handLabel(results, handIndex);
    const wrist = landmarks[WRIST];
    const available = [...previousCasting.values()]
      .filter((candidate) => !claimed.has(candidate.id) && timestampMs - candidate.lastSeenMs <= TRACKING_GRACE_MS)
      .map((candidate) => ({ candidate, gap: Math.hypot((candidate.wrist.x - wrist.x) * 1.4, candidate.wrist.y - wrist.y) }))
      .filter(({ gap }) => gap <= 0.22)
      .sort((a, b) => a.gap - b.gap);
    const state = available[0]?.candidate ?? {
      id: `hand-${nextHandId++}`,
      label,
      wrist: { ...wrist },
      lastSeenMs: timestampMs,
      candidateSinceMs: -1,
      poseLostSinceMs: -1,
      palmSinceMs: -1,
      isCasting: false,
      phase: 'idle' as CastingPhase,
      awaitingSinceMs: 0,
    };
    claimed.add(state.id);
    state.label = label;
    state.wrist = { ...wrist };
    state.lastSeenMs = timestampMs;
    let justStarted = false;
    let justEnded = false;
    let releaseStarted = false;
    let justReleased = false;
    let releaseCancelled = false;

    if (state.phase === 'released') state.phase = 'idle';

    if (state.phase === 'casting') {
      if (qualifies) {
        state.poseLostSinceMs = -1;
      } else {
        if (state.poseLostSinceMs < 0) state.poseLostSinceMs = timestampMs;
        if (timestampMs - state.poseLostSinceMs >= POSE_GAP_MS || releasePose) {
          state.isCasting = false;
          state.phase = 'awaiting-release';
          state.awaitingSinceMs = timestampMs;
          state.palmSinceMs = releasePose ? timestampMs : -1;
          justEnded = true;
          releaseStarted = true;
        }
      }
    } else if (state.phase === 'awaiting-release') {
      if (timestampMs - state.awaitingSinceMs >= RELEASE_TIMEOUT_MS) {
        state.phase = 'idle';
        state.awaitingSinceMs = 0;
        state.palmSinceMs = -1;
        releaseCancelled = true;
      } else if (releasePose) {
        if (state.palmSinceMs < 0) state.palmSinceMs = timestampMs;
        if (timestampMs - state.palmSinceMs >= PALM_HOLD_MS) {
          state.phase = 'released';
          state.palmSinceMs = -1;
          justReleased = true;
        }
      } else if (qualifies && timestampMs - state.awaitingSinceMs <= RESUME_WINDOW_MS) {
        state.phase = 'casting';
        state.isCasting = true;
        state.poseLostSinceMs = -1;
      } else {
        state.palmSinceMs = -1;
      }
    } else if (qualifies) {
      if (state.candidateSinceMs < 0) state.candidateSinceMs = timestampMs;
      if (timestampMs - state.candidateSinceMs >= CAST_START_MS) {
        state.isCasting = true;
        state.phase = 'casting';
        justStarted = true;
      }
    } else {
      state.candidateSinceMs = -1;
    }
    previousCasting.set(state.id, state);

    return {
      ...diagnostics,
      id: state.id,
      poseValid: qualifies,
      handIndex,
      label,
      phase: state.phase,
      isRaised: indexRaised,
      isCasting: state.isCasting,
      justStarted,
      justEnded,
      releaseStarted,
      justReleased,
      releaseCancelled,
      indexExtension: handScale > Number.EPSILON
        ? indexTipDistance / handScale
        : Number.POSITIVE_INFINITY,
      handScale,
    };
  });

  for (const [key, state] of previousCasting) {
    if (!claimed.has(key) && timestampMs - state.lastSeenMs > TRACKING_GRACE_MS) previousCasting.delete(key);
  }

  return {
    hands,
    castingHands: hands.filter((hand) => hand.isCasting).length,
  };
}
