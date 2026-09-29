import { beforeEach, describe, expect, it } from 'vitest';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  processHands,
  resetHandProcessing,
} from '../src/input/process-hands';

interface Point {
  x: number;
  y: number;
  z: number;
}

function makeHand(kind: 'raised' | 'open' | 'bent'): Point[] {
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
  if (kind === 'open') {
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

function resultFor(...hands: Array<{ label: string; kind: 'raised' | 'open' | 'bent' }>): HandLandmarkerResult {
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

  it('requires the other fingers to remain curled', () => {
    const open = processHands(resultFor({ label: 'Right', kind: 'open' }), 0).hands[0];
    const bent = processHands(resultFor({ label: 'Right', kind: 'bent' }), 33).hands[0];

    expect(open.indexRaised).toBe(true);
    expect(open.otherFingersCurled).toBe(false);
    expect(open.correction).toContain('Curl');
    expect(bent.indexRaised).toBe(false);
    expect(bent.correction).toContain('Raise');
  });

  it('ends casting after two release frames', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    const bent = resultFor({ label: 'Right', kind: 'bent' });
    for (let frame = 0; frame < 4; frame += 1) processHands(raised, frame * 33);

    const firstRelease = processHands(bent, 132).hands[0];
    const ended = processHands(bent, 165).hands[0];

    expect(firstRelease.isCasting).toBe(true);
    expect(firstRelease.justEnded).toBe(false);
    expect(ended.isCasting).toBe(false);
    expect(ended.justEnded).toBe(true);
  });

  it('tracks both hands independently', () => {
    const result = resultFor(
      { label: 'Left', kind: 'raised' },
      { label: 'Right', kind: 'raised' },
    );
    for (let frame = 0; frame < 3; frame += 1) processHands(result, frame * 33);
    const processed = processHands(result, 99);

    expect(processed.castingHands).toBe(2);
    expect(processed.hands.map((hand) => hand.label)).toEqual(['Left', 'Right']);
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

  it('clears a hand state when tracking temporarily disappears', () => {
    const raised = resultFor({ label: 'Right', kind: 'raised' });
    const missing = resultFor();
    for (let frame = 0; frame < 4; frame += 1) processHands(raised, frame * 33);

    expect(processHands(missing, 132).castingHands).toBe(0);
    const afterReturn = processHands(raised, 165).hands[0];
    expect(afterReturn.isCasting).toBe(false);
    expect(afterReturn.justStarted).toBe(false);
  });
});
