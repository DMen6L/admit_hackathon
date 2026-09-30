import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

export class HandTrackerAssetError extends Error {
  constructor(public readonly assetRoot: string, cause: unknown) {
    super(`Hand-tracking assets could not be loaded from ${assetRoot}.`, { cause });
    this.name = 'HandTrackerAssetError';
  }
}

export function isHandTrackerAssetError(error: unknown): error is HandTrackerAssetError {
  return error instanceof HandTrackerAssetError;
}

export async function createHandTracker(): Promise<HandLandmarker> {
  const base = import.meta.env.BASE_URL;
  try {
    const vision = await FilesetResolver.forVisionTasks(`${base}wasm`);
    return await HandLandmarker.createFromOptions(vision, {
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
  } catch (error) {
    throw new HandTrackerAssetError(`${base}wasm`, error);
  }
}
