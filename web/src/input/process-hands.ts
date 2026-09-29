import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';

/**
 * Entry point for our future browser-side gesture calculations.
 * Called once per processed camera frame, including frames with no hands.
 *
 * results.landmarks: 21 points per hand, in the unmirrored camera coordinates.
 * results.worldLandmarks: hand-relative 3D points.
 * results.handedness: the model's left/right classification for each hand.
 * timestampMs: monotonic time, useful for movement speed and hold duration.
 *
 * The preview alone is mirrored. Keep calculations in the original coordinates.
 * No spells or gesture rules are selected yet.
 */
export function processHands(
  _results: HandLandmarkerResult,
  _timestampMs: number,
): void {
  // Add custom gesture recognition and correction feedback here.
}
