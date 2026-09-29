import './style.css';
import { DrawingUtils, HandLandmarker } from '@mediapipe/tasks-vision';
import { createHandTracker } from './vision/hand-tracker';
import { processHands, resetHandProcessing } from './input/process-hands';

const video = document.querySelector<HTMLVideoElement>('#camera')!;
const canvas = document.querySelector<HTMLCanvasElement>('#landmarks')!;
const context = canvas.getContext('2d')!;
const drawing = new DrawingUtils(context);
const startButton = document.querySelector<HTMLButtonElement>('#start')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const handCount = document.querySelector<HTMLSpanElement>('#hand-count')!;
const castingStatus = document.querySelector<HTMLSpanElement>('#casting-status')!;
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
  context.clearRect(0, 0, canvas.width, canvas.height);
  placeholder.hidden = false;
  handCount.textContent = '0 hands detected';
  castingStatus.textContent = 'Casting: waiting for a hand';
  delete castingStatus.dataset.active;
  startButton.disabled = false;
  stopButton.disabled = true;
  setStatus(message);
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
        preview.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      }

      const timestampMs = performance.now();
      const results = tracker.detectForVideo(video, timestampMs);
      context.clearRect(0, 0, canvas.width, canvas.height);

      const processedHands = processHands(results, timestampMs);
      for (const [handIndex, landmarks] of results.landmarks.entries()) {
        const casting = processedHands.hands[handIndex];
        drawing.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
          color: casting?.isCasting ? '#ffd166' : '#85e3c7', lineWidth: 3,
        });
        drawing.drawLandmarks(landmarks, {
          color: '#ffffff', fillColor: casting?.isCasting ? '#ffd166' : '#85e3c7', radius: 4, lineWidth: 1,
        });
        if (casting?.isCasting) drawCastingIndicator(landmarks);
      }

      const count = results.landmarks.length;
      handCount.textContent = `${count} ${count === 1 ? 'hand' : 'hands'} detected`;
      const castingHands = processedHands.hands.filter((hand) => hand.isCasting);
      const startedHands = processedHands.hands.filter((hand) => hand.justStarted);
      if (startedHands.length > 0) {
        const labels = startedHands.map((hand) => hand.label).join(' + ');
        castingStatus.textContent = `Casting started · ${labels}`;
        castingStatus.dataset.active = 'true';
      } else if (castingHands.length > 0) {
        const labels = castingHands.map((hand) => hand.label).join(' + ');
        castingStatus.textContent = `Casting active · ${labels}`;
        castingStatus.dataset.active = 'true';
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopCamera();
    void trackerLoading?.then((loaded) => loaded.close()).catch(() => {});
  });
}
