import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

export async function createHandTracker(): Promise<HandLandmarker> {
  const base = import.meta.env.BASE_URL;
  const vision = await FilesetResolver.forVisionTasks(`${base}wasm`);

  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `${base}models/hand_landmarker.task`,
      // Use the CPU delegate for this initial tracking prototype.
      delegate: 'CPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}
