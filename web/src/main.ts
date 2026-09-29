import './style.css';
import { DrawingUtils, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { createHandTracker } from './vision/hand-tracker';
import { processHands, resetHandProcessing, type HandProcessingResult } from './input/process-hands';
import { IndexPathRecorder, type RecordedStroke } from './drawing/path-recorder';
import { DEFAULT_SHAPE_TEMPLATES, ShapeEvaluator, type ShapeEvaluation } from './shapes/shape-evaluator';
import {
  resolveSpell,
  spellDefinitionFor,
  type SpellCastPayload,
} from './spells/spell-resolver';
import { presentCastResult } from './ui/cast-result';
import { AuthController } from './auth/auth-controller';
import { DemoAuthService } from './auth/auth-service';

interface DevDiagnostics {
  onFrame(results: HandLandmarkerResult, processed: HandProcessingResult, timestampMs: number,
    width: number, height: number, strokes: readonly RecordedStroke[]): void;
  onCast(stroke: RecordedStroke, evaluation: ShapeEvaluation, timestampMs: number): void;
  dispose(): void;
}

let diagnostics: DevDiagnostics | undefined;

const video = document.querySelector<HTMLVideoElement>('#camera')!;
const pathCanvas = document.querySelector<HTMLCanvasElement>('#path')!;
const canvas = document.querySelector<HTMLCanvasElement>('#landmarks')!;
const pathContext = pathCanvas.getContext('2d')!;
const context = canvas.getContext('2d')!;
const drawing = new DrawingUtils(context);
const pathRecorder = new IndexPathRecorder();
const shapeEvaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
const startButton = document.querySelector<HTMLButtonElement>('#start')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const handCount = document.querySelector<HTMLSpanElement>('#hand-count')!;
const castingStatus = document.querySelector<HTMLSpanElement>('#casting-status')!;
const resultCard = document.querySelector<HTMLElement>('#cast-result')!;
const resultIcon = document.querySelector<HTMLSpanElement>('#cast-result-icon')!;
const resultTitle = document.querySelector<HTMLElement>('#cast-result-title')!;
const resultDetail = document.querySelector<HTMLElement>('#cast-result-detail')!;
const resultSpell = document.querySelector<HTMLElement>('#cast-result-spell')!;
const resultRune = document.querySelector<HTMLElement>('#cast-result-rune')!;
const resultCorrection = document.querySelector<HTMLElement>('#cast-result-correction')!;
const placeholder = document.querySelector<HTMLParagraphElement>('#placeholder')!;
const preview = document.querySelector<HTMLDivElement>('.preview')!;

let tracker: HandLandmarker | undefined;
let trackerLoading: Promise<HandLandmarker> | undefined;
let stream: MediaStream | undefined;
let frameId = 0;
let session = 0;
let previousVideoTime = -1;

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.dataset.error = String(error);
}

function stopCamera(message = 'Camera stopped. You can start again.'): void {
  session += 1; // Invalidates pending camera requests and frame callbacks.
  cancelAnimationFrame(frameId);
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  video.pause();
  video.srcObject = null;
  previousVideoTime = -1;
  resetHandProcessing();
  pathRecorder.reset();
  clearCastResult();
  pathContext.clearRect(0, 0, pathCanvas.width, pathCanvas.height);
  context.clearRect(0, 0, canvas.width, canvas.height);
  placeholder.hidden = false;
  handCount.textContent = '0 hands detected';
  castingStatus.textContent = 'Casting: waiting for a hand';
  delete castingStatus.dataset.active;
  startButton.disabled = false;
  stopButton.disabled = true;
  setStatus(message);
}

function clearCastResult(): void {
  resultCard.hidden = true;
  delete resultCard.dataset.state;
  resultIcon.textContent = '';
  resultTitle.textContent = '';
  resultDetail.textContent = '';
  resultSpell.textContent = '';
  resultSpell.hidden = true;
  resultRune.textContent = '';
  resultRune.hidden = true;
  resultCorrection.textContent = '';
  resultCorrection.hidden = true;
}

function showCastResult(evaluation: ShapeEvaluation): SpellCastPayload | undefined {
  const presentation = presentCastResult(evaluation);
  const spellPayload = resolveSpell(evaluation);
  const spellDefinition = spellPayload ? spellDefinitionFor(spellPayload.spellId) : undefined;
  resultCard.hidden = false;
  resultCard.dataset.state = presentation.state;
  resultIcon.textContent = presentation.icon;
  resultTitle.textContent = presentation.title;
  resultDetail.textContent = presentation.detail;
  resultSpell.textContent = spellDefinition ? `Spell: ${spellDefinition.name}` : '';
  resultSpell.hidden = !spellDefinition;
  resultRune.textContent = spellDefinition
    ? `Rune reading: ${spellDefinition.runeInterpretation}`
    : '';
  resultRune.hidden = !spellDefinition;
  resultCorrection.hidden = !presentation.correction;
  resultCorrection.textContent = presentation.correction ?? '';
  return spellPayload;
}

function publishSpellCast(payload: SpellCastPayload | undefined): void {
  if (!payload) return;

  // A future WebSocket/fetch adapter can listen to this JSON-safe event.
  window.dispatchEvent(new CustomEvent<SpellCastPayload>('spell-cast', { detail: payload }));
}

function drawRecordedPaths(): void {
  pathContext.clearRect(0, 0, pathCanvas.width, pathCanvas.height);
  const lineWidth = Math.max(3, pathCanvas.width * 0.008);

  for (const stroke of pathRecorder.getStrokes()) {
    if (stroke.points.length === 0) continue;

    pathContext.save();
    pathContext.strokeStyle = '#ffd166';
    pathContext.fillStyle = '#ffd166';
    pathContext.lineWidth = lineWidth;
    pathContext.lineCap = 'round';
    pathContext.lineJoin = 'round';
    pathContext.shadowColor = 'rgba(255, 209, 102, 0.75)';
    pathContext.shadowBlur = lineWidth * 1.5;

    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      pathContext.beginPath();
      pathContext.arc(point.x * pathCanvas.width, point.y * pathCanvas.height, lineWidth / 2, 0, Math.PI * 2);
      pathContext.fill();
    } else {
      pathContext.beginPath();
      pathContext.moveTo(stroke.points[0].x * pathCanvas.width, stroke.points[0].y * pathCanvas.height);
      for (const point of stroke.points.slice(1)) {
        pathContext.lineTo(point.x * pathCanvas.width, point.y * pathCanvas.height);
      }
      pathContext.stroke();
    }
    pathContext.restore();
  }
}

function drawCastingIndicator(landmarks: Array<{ x: number; y: number }>): void {
  const indexMcp = landmarks[5];
  const indexTip = landmarks[8];
  if (!indexMcp || !indexTip) return;

  context.save();
  context.strokeStyle = '#ffd166';
  context.fillStyle = '#ffd166';
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(indexMcp.x * canvas.width, indexMcp.y * canvas.height);
  context.lineTo(indexTip.x * canvas.width, indexTip.y * canvas.height);
  context.stroke();
  for (const point of [indexMcp, indexTip]) {
    context.beginPath();
    context.arc(point.x * canvas.width, point.y * canvas.height, 8, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'Camera permission was denied. Allow camera access in your browser, then try again.';
      case 'NotFoundError':
        return 'No webcam was found. Connect a camera, then try again.';
      case 'NotReadableError':
        return 'The webcam could not start. Close other apps using it, then try again.';
      case 'SecurityError':
        return 'Camera access is blocked. Open this page on localhost or HTTPS.';
    }
  }
  return 'The camera could not start. Check your camera connection and browser permissions, then try again.';
}

function trackFrame(activeSession: number): void {
  if (activeSession !== session || !stream || !tracker) return;

  try {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== previousVideoTime) {
      previousVideoTime = video.currentTime;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        pathCanvas.width = video.videoWidth;
        pathCanvas.height = video.videoHeight;
        preview.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      }

      const timestampMs = performance.now();
      const results = tracker.detectForVideo(video, timestampMs);
      context.clearRect(0, 0, canvas.width, canvas.height);

      const processedHands = processHands(results, timestampMs);
      const completedStrokes = pathRecorder.update(processedHands.hands, results.landmarks, timestampMs, video.videoWidth / video.videoHeight);
      diagnostics?.onFrame(results, processedHands, timestampMs, video.videoWidth, video.videoHeight, pathRecorder.getStrokes());
      if (completedStrokes.length > 0) {
        for (const stroke of completedStrokes) {
          const evaluation = shapeEvaluator.evaluate(stroke);
          diagnostics?.onCast(stroke, evaluation, timestampMs);
          const spellPayload = showCastResult(evaluation);
          publishSpellCast(spellPayload);
        }
      }
      drawRecordedPaths();
      for (const [handIndex, landmarks] of results.landmarks.entries()) {
        const casting = processedHands.hands[handIndex];
        const landmarkColor = casting?.isCasting
          ? '#ffd166'
          : casting?.phase === 'awaiting-release' ? '#f2a65a' : '#85e3c7';
        drawing.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
          color: landmarkColor, lineWidth: 3,
        });
        drawing.drawLandmarks(landmarks, {
          color: '#ffffff', fillColor: landmarkColor, radius: 4, lineWidth: 1,
        });
        if (casting?.isCasting) drawCastingIndicator(landmarks);
      }

      const count = results.landmarks.length;
      handCount.textContent = `${count} ${count === 1 ? 'hand' : 'hands'} detected`;
      const castingHands = processedHands.hands.filter((hand) => hand.isCasting);
      const startedHands = processedHands.hands.filter((hand) => hand.justStarted);
      const pendingHands = processedHands.hands.filter((hand) => hand.phase === 'awaiting-release');
      const cancelledHands = processedHands.hands.filter((hand) => hand.releaseCancelled);
      if (startedHands.length > 0) {
        clearCastResult();
        const labels = startedHands.map((hand) => hand.label).join(' + ');
        castingStatus.textContent = `Casting started · ${labels}`;
        castingStatus.dataset.active = 'true';
      } else if (castingHands.length > 0) {
        const labels = castingHands.map((hand) => hand.label).join(' + ');
        castingStatus.textContent = `Writing path · ${labels}`;
        castingStatus.dataset.active = 'true';
      } else if (pendingHands.length > 0) {
        const correction = pendingHands.find((hand) => hand.releaseCorrection)?.releaseCorrection;
        castingStatus.textContent = correction ?? 'Show your palm to release';
        castingStatus.dataset.active = 'true';
      } else if (cancelledHands.length > 0) {
        castingStatus.textContent = 'Spell cancelled · show your palm to release';
        delete castingStatus.dataset.active;
      } else {
        const correction = processedHands.hands.find((hand) => hand.correction)?.correction;
        castingStatus.textContent = count > 0
          ? `Casting: ${correction ?? 'raise your index finger and curl the others'}`
          : 'Casting: waiting for a hand';
        delete castingStatus.dataset.active;
      }
      const message = count > 0
        ? 'Tracking your hands. Move your fingers and watch the landmarks follow.'
        : 'Camera is running. Hold your hands fully in view with enough light.';
      if (status.textContent !== message) setStatus(message);
    }
    frameId = requestAnimationFrame(() => trackFrame(activeSession));
  } catch (error) {
    console.error('Hand tracking failed:', error);
    stopCamera();
    tracker.close();
    tracker = undefined;
    trackerLoading = undefined;
    setStatus('Tracking stopped unexpectedly. Try starting the camera again.', true);
  }
}

async function startCamera(): Promise<void> {
  if (startButton.disabled) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus('Camera access needs a supported browser on localhost or HTTPS.', true);
    return;
  }

  const activeSession = ++session;
  startButton.disabled = true;
  stopButton.disabled = false;
  setStatus('Requesting camera access…');
  let stage: 'camera' | 'model' = 'camera';

  try {
    const nextStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    if (activeSession !== session) {
      nextStream.getTracks().forEach((track) => track.stop());
      return;
    }

    stream = nextStream;
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (activeSession === session) {
          stopCamera('The camera disconnected. Reconnect it and start again.');
        }
      }, { once: true });
    });
    video.srcObject = stream;
    await video.play();
    if (activeSession !== session) return;
    placeholder.hidden = true;
    stage = 'model';
    setStatus('Loading hand tracking…');

    // Share an in-flight load if the camera is stopped and restarted during setup.
    trackerLoading ??= createHandTracker().then((loaded) => {
      tracker = loaded;
      return loaded;
    }).catch((error: unknown) => {
      trackerLoading = undefined;
      throw error;
    });
    await trackerLoading;
    if (activeSession !== session) return;
    trackFrame(activeSession);
  } catch (error) {
    if (activeSession !== session) return;
    console.error('Could not start hand tracking:', error);
    stopCamera();
    setStatus(stage === 'model'
      ? 'The tracking model could not load. Check that setup finished, then reload and try again.'
      : cameraError(error), true);
  }
}

startButton.addEventListener('click', () => { void startCamera(); });
stopButton.addEventListener('click', () => stopCamera());
window.addEventListener('pagehide', () => stopCamera());

const authController = new AuthController(
  new DemoAuthService(window.localStorage, window.sessionStorage),
  { onSignOut: () => stopCamera('Signed out. Your camera has been released.') },
);
void authController.initialize();

if (import.meta.env.DEV) {
  void import('./debug/dev-diagnostics').then(({ mountDiagnostics }) => {
    diagnostics = mountDiagnostics({
      shapeEvaluator,
      stopCamera,
      showCastResult,
      resetStroke: () => {
        resetHandProcessing();
        pathRecorder.reset();
        pathContext.clearRect(0, 0, pathCanvas.width, pathCanvas.height);
      },
    });
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    diagnostics?.dispose();
    stopCamera();
    void trackerLoading?.then((loaded) => loaded.close()).catch(() => {});
  });
}
