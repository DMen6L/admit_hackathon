import { beforeEach, describe, expect, it } from 'vitest';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  processHands,
  resetHandProcessing,
} from '../src/input/process-hands';
import { replayCapture } from '../src/debug/replay';
import { ShapeEvaluator, DEFAULT_SHAPE_TEMPLATES } from '../src/shapes/shape-evaluator';
import { RecognitionCaptureSession, parseCapture, type CaptureFrame } from '../src/debug/recognition-capture';

interface Point {
  x: number;
  y: number;
  z: number;
}

function makeHand(kind: 'raised' | 'open' | 'bent' | 'side-open'): Point[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[0] = { x: 0.5, y: 0.7, z: 0 };
  points[1] = { x: 0.44, y: 0.68, z: 0 };
  points[2] = { x: 0.43, y: 0.63, z: 0 };
  points[3] = { x: 0.45, y: 0.65, z: 0 };
  points[4] = { x: 0.47, y: 0.67, z: 0 };

  points[5] = { x: 0.42, y: 0.58, z: 0 };
  points[6] = kind === 'bent'
    ? { x: 0.42, y: 0.43, z: 0 }
    : { x: 0.42, y: 0.42, z: 0 };
  points[7] = kind === 'bent'
    ? { x: 0.44, y: 0.47, z: 0 }
    : { x: 0.42, y: 0.28, z: 0 };
  points[8] = kind === 'bent'
    ? { x: 0.45, y: 0.52, z: 0 }
    : { x: 0.42, y: 0.15, z: 0 };

  // The remaining fingertips are either curled into the palm or extended.
  if (kind === 'open' || kind === 'side-open') {
    points[1] = { x: 0.38, y: 0.62, z: 0 };
    points[2] = { x: 0.32, y: 0.58, z: 0 };
    points[3] = { x: 0.29, y: 0.56, z: 0 };
    points[4] = { x: 0.25, y: 0.54, z: 0 };
    points[9] = { x: 0.50, y: 0.55, z: 0 };
    points[10] = { x: 0.51, y: 0.40, z: 0 };
    points[11] = { x: 0.52, y: 0.25, z: 0 };
    points[12] = { x: 0.53, y: 0.10, z: 0 };
    points[13] = { x: 0.58, y: 0.56, z: 0 };
    points[14] = { x: 0.62, y: 0.42, z: 0 };
    points[15] = { x: 0.66, y: 0.28, z: 0 };
    points[16] = { x: 0.69, y: 0.14, z: 0 };
    points[17] = { x: 0.65, y: 0.60, z: 0 };
    points[18] = { x: 0.70, y: 0.48, z: 0 };
    points[19] = { x: 0.75, y: 0.35, z: 0 };
    points[20] = { x: 0.78, y: 0.23, z: 0 };
    if (kind === 'side-open') {
      points[5].z = 0.25;
      points[17].z = -0.25;
    }
  } else {
    points[9] = { x: 0.50, y: 0.55, z: 0 };
    points[10] = { x: 0.51, y: 0.63, z: 0 };
    points[11] = { x: 0.51, y: 0.68, z: 0 };
    points[12] = { x: 0.51, y: 0.70, z: 0 };
    points[13] = { x: 0.52, y: 0.55, z: 0 };
    points[14] = { x: 0.53, y: 0.62, z: 0 };
    points[15] = { x: 0.53, y: 0.67, z: 0 };
    points[16] = { x: 0.53, y: 0.69, z: 0 };
    points[17] = { x: 0.54, y: 0.57, z: 0 };
    points[18] = { x: 0.55, y: 0.61, z: 0 };
    points[19] = { x: 0.55, y: 0.66, z: 0 };
    points[20] = { x: 0.55, y: 0.68, z: 0 };
  }
  return points;
}

function resultFor(...hands: Array<{ label: string; kind: 'raised' | 'open' | 'bent' | 'side-open' }>): HandLandmarkerResult {
  return {
    landmarks: hands.map(({ kind }) => makeHand(kind)),
    worldLandmarks: hands.map(({ kind }) => makeHand(kind)),
    handedness: hands.map(({ label }) => [{ categoryName: label, displayName: label, index: 0, score: 1 }]),
    handednesses: [],
  } as unknown as HandLandmarkerResult;
}

beforeEach(() => resetHandProcessing());

describe('raised-index casting recognition', () => {
  it('does not start casting before the pose is stable', () => {
    const result = resultFor({ label: 'Right', kind: 'raised' });

    for (let frame = 0; frame < 3; frame += 1) {
      const state = processHands(result, frame * 33).hands[0];
      expect(state.isRaised).toBe(true);
      expect(state.isCasting).toBe(false);
      expect(state.justStarted).toBe(false);
    }
  });

  it('starts casting once the raised index is held for four frames', () => {
    const result = resultFor({ label: 'Right', kind: 'raised' });

    for (let frame = 0; frame < 3; frame += 1) processHands(result, frame * 33);
    const started = processHands(result, 99).hands[0];
    const held = processHands(result, 132).hands[0];

    expect(started.isCasting).toBe(true);
    expect(started.justStarted).toBe(true);
    expect(held.isCasting).toBe(true);
    expect(held.justStarted).toBe(false);
  });

  it('uses elapsed time when frame rates vary', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    expect(processHands(raised, 0).hands[0].justStarted).toBe(false);
    expect(processHands(raised, 40).hands[0].justStarted).toBe(false);
    expect(processHands(raised, 120).hands[0].justStarted).toBe(true);
  });

  it('starts a cast after the shorter pose hold while rejecting a too-brief pose', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    expect(processHands(raised, 0).hands[0].justStarted).toBe(false);
    expect(processHands(raised, 70).hands[0].justStarted).toBe(false);
    expect(processHands(raised, 72).hands[0].justStarted).toBe(true);
  });

  it('accepts a slightly imperfect curled finger while still rejecting an open hand', () => {
    const almostCurled = resultFor({ label: 'Right', kind: 'raised' });
    for (const points of [almostCurled.landmarks[0], almostCurled.worldLandmarks[0]]) {
      points[12] = { x: 0.51, y: 0.623, z: 0 };
    }
    const pointing = processHands(almostCurled, 0).hands[0];
    expect(pointing.curledFingerCount).toBe(3);
    expect(pointing.poseValid).toBe(true);
    expect(processHands(resultFor({ label: 'Right', kind: 'open' }), 33).hands[0].poseValid).toBe(false);
  });

  it('releases after the shorter palm hold, but not immediately', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    const open = resultFor({ label: 'Right', kind: 'open' });
    processHands(raised, 0);
    processHands(raised, 72);
    expect(processHands(open, 100).hands[0].justEnded).toBe(true);
    expect(processHands(open, 170).hands[0].justReleased).toBe(false);
    expect(processHands(open, 172).hands[0].justReleased).toBe(true);
  });

  it('requires the other fingers to remain curled', () => {
    const open = processHands(resultFor({ label: 'Right', kind: 'open' }), 0).hands[0];
    const bent = processHands(resultFor({ label: 'Right', kind: 'bent' }), 33).hands[0];

    expect(open.indexRaised).toBe(true);
    expect(open.otherFingersCurled).toBe(false);
    expect(open.correction).toContain('Согните');
    expect(bent.indexRaised).toBe(false);
    expect(bent.correction).toContain('Выпрямите');
  });

  it('lets the thumb rest naturally during pointing and palm release', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    for (const points of [raised.landmarks[0], raised.worldLandmarks[0]]) {
      points[4] = { x: 0.12, y: 0.56, z: 0 };
    }
    for (const time of [0, 33, 66]) processHands(raised, time);
    const pointing = processHands(raised, 99).hands[0];
    expect(pointing.thumbRelaxed).toBe(false);
    expect(pointing.justStarted).toBe(true);

    const open = resultFor({ label: 'Right', kind: 'open' });
    for (const points of [open.landmarks[0], open.worldLandmarks[0]]) {
      points[4] = { x: 0.47, y: 0.67, z: 0 };
    }
    expect(processHands(open, 132).hands[0].justEnded).toBe(true);
    for (const time of [165, 198]) processHands(open, time);
    const released = processHands(open, 231).hands[0];
    expect(released.allFingersExtended).toBe(false);
    expect(released.releaseFingersExtended).toBe(true);
    expect(released.justReleased).toBe(true);
  });

  it('keeps a sideways pointing index active while the wrist rotates', () => {
    const rotated = resultFor({ label: 'Right', kind: 'raised' });
    for (const points of [rotated.landmarks[0], rotated.worldLandmarks[0]]) {
      for (const point of points) {
        const x = point.x;
        point.x = 1 - point.y;
        point.y = x;
      }
    }
    for (const time of [0, 33, 66]) processHands(rotated, time);
    const state = processHands(rotated, 99).hands[0];
    expect(state.indexRaised).toBe(true);
    expect(state.justStarted).toBe(true);
  });

  it('enters pending release after the pose is lost for 100 ms', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    const bent = resultFor({ label: 'Right', kind: 'bent' });
    for (let frame = 0; frame < 4; frame += 1) processHands(raised, frame * 33);

    const firstRelease = processHands(bent, 132).hands[0];
    const ended = processHands(bent, 252).hands[0];

    expect(firstRelease.isCasting).toBe(true);
    expect(firstRelease.justEnded).toBe(false);
    expect(ended.isCasting).toBe(false);
    expect(ended.justEnded).toBe(true);
    expect(ended.phase).toBe('awaiting-release');
    expect(ended.justReleased).toBe(false);
  });

  it('requires a stable open palm before releasing the spell', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    const bent = resultFor({ label: 'Right', kind: 'bent' });
    const open = resultFor({ label: 'Right', kind: 'open' });
    for (let frame = 0; frame < 4; frame += 1) processHands(raised, frame * 33);
    processHands(bent, 132);
    const pending = processHands(bent, 252).hands[0];
    expect(pending.phase).toBe('awaiting-release');
    expect(pending.releaseCorrection).toContain('Распрямите');

    for (let frame = 0; frame < 3; frame += 1) {
      const state = processHands(open, 265 + frame * 33).hands[0];
      expect(state.justReleased).toBe(false);
      expect(state.phase).toBe('awaiting-release');
    }
    const released = processHands(open, 364).hands[0];
    expect(released.releasePose).toBe(true);
    expect(released.justReleased).toBe(true);
    expect(released.phase).toBe('released');
  });

  it('requires all fingers and a camera-facing palm for release', () => {
    const open = processHands(resultFor({ label: 'Right', kind: 'open' }), 0).hands[0];
    const side = processHands(resultFor({ label: 'Right', kind: 'side-open' }), 33).hands[0];

    expect(open.extendedFingerCount).toBe(5);
    expect(open.allFingersExtended).toBe(true);
    expect(open.palmFacingCamera).toBe(true);
    expect(open.releasePose).toBe(true);
    expect(side.allFingersExtended).toBe(true);
    expect(side.palmFacingCamera).toBe(false);
    expect(side.releasePose).toBe(false);
    expect(side.releaseCorrection).toContain('ладонь');
  });

  it('cancels a pending release after the timeout', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    const bent = resultFor({ label: 'Right', kind: 'bent' });
    for (let frame = 0; frame < 4; frame += 1) processHands(raised, frame * 33);
    processHands(bent, 132);
    processHands(bent, 252);

    for (let time = 330; time < 1700; time += 100) processHands(bent, time);

    const cancelled = processHands(bent, 1800).hands[0];
    expect(cancelled.releaseCancelled).toBe(true);
    expect(cancelled.phase).toBe('idle');
  });

  it('tracks both hands independently', () => {
    const result = resultFor(
      { label: 'Left', kind: 'raised' },
      { label: 'Right', kind: 'raised' },
    );
    for (let frame = 0; frame < 3; frame += 1) processHands(result, frame * 33);
    const processed = processHands(result, 99);

    expect(processed.castingHands).toBe(2);
    expect(processed.hands.map((hand) => hand.label)).toEqual(['Левая рука', 'Правая рука']);
    expect(processed.hands.every((hand) => hand.justStarted)).toBe(true);
  });

  it('clears casting state when tracking is reset', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    for (let frame = 0; frame < 4; frame += 1) processHands(raised, frame * 33);

    resetHandProcessing();
    const next = processHands(raised, 200).hands[0];
    expect(next.isCasting).toBe(false);
    expect(next.justStarted).toBe(false);
  });

  it('preserves a hand state through a brief tracking gap', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    const missing = resultFor();
    for (let frame = 0; frame < 4; frame += 1) processHands(raised, frame * 33);

    expect(processHands(missing, 132).castingHands).toBe(0);
    const afterReturn = processHands(raised, 165).hands[0];
    expect(afterReturn.isCasting).toBe(true);
    expect(afterReturn.justStarted).toBe(false);
  });

  it('resumes the same stroke when the pointing pose briefly returns after release begins', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    const bent = resultFor({ label: 'Right', kind: 'bent' });
    for (const time of [0, 33, 66, 99]) processHands(raised, time);
    processHands(bent, 132);
    expect(processHands(bent, 252).hands[0].phase).toBe('awaiting-release');
    const resumed = processHands(raised, 265).hands[0];
    expect(resumed.phase).toBe('casting');
    expect(resumed.justStarted).toBe(false);
  });

  it('keeps hand identities when the detector changes array order', () => {
    const pair = resultFor({ label: 'Left', kind: 'raised' }, { label: 'Right', kind: 'bent' });
    pair.landmarks[0].forEach((point) => { point.x -= 0.2; });
    pair.landmarks[1].forEach((point) => { point.x += 0.2; });
    pair.worldLandmarks[0].forEach((point) => { point.x -= 0.2; });
    pair.worldLandmarks[1].forEach((point) => { point.x += 0.2; });
    for (const time of [0, 33, 66, 99]) processHands(pair, time);
    const reordered = resultFor({ label: 'Right', kind: 'bent' }, { label: 'Left', kind: 'raised' });
    reordered.landmarks[0].forEach((point) => { point.x += 0.2; });
    reordered.landmarks[1].forEach((point) => { point.x -= 0.2; });
    reordered.worldLandmarks[0].forEach((point) => { point.x += 0.2; });
    reordered.worldLandmarks[1].forEach((point) => { point.x -= 0.2; });
    const after = processHands(reordered, 132);
    expect(after.hands[1].id).toBe('hand-1');
    expect(after.hands[1].isCasting).toBe(true);
  });

  it('replays a complete pointing, drawing, and palm release into a triangle cast', () => {
    const frames: CaptureFrame[] = [];
    const add = (kind: 'raised' | 'open', x: number, y: number) => {
      const hand = makeHand(kind).map((point) => ({ ...point, x: point.x + x - 0.42, y: point.y + y - 0.15 }));
      frames.push({ elapsedMs: frames.length * 33, landmarks: [hand], worldLandmarks: [hand],
        labels: ['Right'], poses: [] });
    };
    const vertices = [{ x: 0.3, y: 0.35 }, { x: 0.5, y: 0.12 },
      { x: 0.7, y: 0.35 }, { x: 0.3, y: 0.35 }];
    for (let i = 0; i < 4; i += 1) add('raised', vertices[0].x, vertices[0].y);
    for (let edge = 0; edge < 3; edge += 1) {
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12;
        add('raised', vertices[edge].x * (1 - t) + vertices[edge + 1].x * t,
          vertices[edge].y * (1 - t) + vertices[edge + 1].y * t);
      }
    }
    for (let i = 0; i < 4; i += 1) add('open', vertices[0].x, vertices[0].y);
    const captureSession = new RecognitionCaptureSession();
    for (const frame of frames) {
      const results = {
        landmarks: frame.landmarks, worldLandmarks: frame.worldLandmarks,
        handedness: frame.labels.map((label) => [{ categoryName: label }]),
      } as unknown as HandLandmarkerResult;
      captureSession.recordFrame(results, processHands(results, frame.elapsedMs), frame.elapsedMs, 640, 640);
    }
    const capture = parseCapture(JSON.parse(JSON.stringify(captureSession.export())));
    expect(capture.frames.some((frame) => frame.poses[0]?.justStarted)).toBe(true);
    expect(capture.frames.some((frame) => frame.poses[0]?.justReleased)).toBe(true);
    const casts = replayCapture(capture, new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES));
    expect(casts).toHaveLength(1);
    expect(casts[0].evaluation.status).toBe('matched');
    expect(casts[0].evaluation.templateId).toBe('triangle');
    expect(casts[0].stroke.rawPoints?.length).toBeGreaterThan(20);
  });
});
