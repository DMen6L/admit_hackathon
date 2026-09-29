import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { processHands, resetHandProcessing } from '../input/process-hands';
import { IndexPathRecorder, type RecordedStroke } from '../drawing/path-recorder';
import { ShapeEvaluator, type ShapeEvaluation } from '../shapes/shape-evaluator';
import type { RecognitionCapture } from './recognition-capture';

export interface ReplayCast { stroke: RecordedStroke; evaluation: ShapeEvaluation }

/** Replays the same pose, recorder, and evaluator pipeline from captured landmarks. */
export function replayCapture(capture: RecognitionCapture, evaluator: ShapeEvaluator): ReplayCast[] {
  resetHandProcessing();
  const recorder = new IndexPathRecorder();
  const casts: ReplayCast[] = [];
  for (const frame of capture.frames) {
    const results = {
      landmarks: frame.landmarks,
      worldLandmarks: frame.worldLandmarks,
      handedness: frame.labels.map((label) => [{ categoryName: label }]),
    } as unknown as HandLandmarkerResult;
    const processed = processHands(results, frame.elapsedMs);
    for (const stroke of recorder.update(processed.hands, results.landmarks, frame.elapsedMs, capture.width / capture.height)) {
      casts.push({ stroke, evaluation: evaluator.evaluate(stroke) });
    }
  }
  resetHandProcessing();
  return casts;
}
