import '../style.css';
import '../multiplayer/lobby.css';
import './tutorial.css';
import { ApiAuthService } from '../auth/auth-service';
import { createHandTracker } from '../vision/hand-tracker';
import { processHands, resetHandProcessing } from '../input/process-hands';
import { IndexPathRecorder, type PathPoint, type RecordedStroke } from '../drawing/path-recorder';
import { DEFAULT_SHAPE_TEMPLATES, ShapeEvaluator } from '../shapes/shape-evaluator';
import { TutorialFlow, LESSONS } from './tutorial-flow';
import { mountSoundToggle, SHAPE_SOUND, spellAudio } from '../audio/spell-audio';
import { BackgroundMusic } from '../audio/background-music';
import type { HandLandmarker } from '@mediapipe/tasks-vision';

const auth = new ApiAuthService(globalThis.fetch.bind(globalThis), window.localStorage, window.sessionStorage);
const flow = new TutorialFlow();
const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
const recorder = new IndexPathRecorder();
const get = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;
const pad = get<HTMLCanvasElement>('#tutorial-pad');
const padContext = pad.getContext('2d')!;
const video = get<HTMLVideoElement>('#tutorial-video');
const cameraCanvas = get<HTMLCanvasElement>('#tutorial-camera-path');
const cameraContext = cameraCanvas.getContext('2d')!;
const cameraStatus = get<HTMLElement>('#tutorial-camera-status');
const cameraStart = get<HTMLButtonElement>('#tutorial-camera-start');
const cameraStop = get<HTMLButtonElement>('#tutorial-camera-stop');
const feedback = get<HTMLElement>('#lesson-feedback');
const unmountSound = mountSoundToggle(get<HTMLButtonElement>('#sound-toggle'));
const music = new BackgroundMusic(spellAudio);
let pointerPoints: PathPoint[] = [];
let pointerId: number | undefined;
let tracker: HandLandmarker | undefined;
let stream: MediaStream | undefined;
let cameraFrame = 0;
let cameraSession = 0;
let lastVideoTime = -1;
let threatFrame = 0;

function fitCanvas(canvas: HTMLCanvasElement): void {
  const width = Math.round(canvas.clientWidth * devicePixelRatio);
  const height = Math.round(canvas.clientHeight * devicePixelRatio);
  if (width && height && (canvas.width !== width || canvas.height !== height)) {
    canvas.width = width;
    canvas.height = height;
  }
}

function paintStroke(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, points: readonly PathPoint[], color = '#f9d58d'): void {
  if (!points.length) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(4, canvas.width * .009);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.shadowColor = color;
  context.shadowBlur = 20;
  context.beginPath();
  context.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
  for (const point of points.slice(1)) context.lineTo(point.x * canvas.width, point.y * canvas.height);
  if (points.length === 1) context.arc(points[0].x * canvas.width, points[0].y * canvas.height, 3, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function render(): void {
  music.setActive(!flow.complete);
  const lesson = flow.lesson;
  const number = flow.index + 1;
  get<HTMLElement>('#lesson-number').textContent = `Lesson ${number} of ${LESSONS.length}`;
  get<HTMLProgressElement>('#lesson-progress').value = number;
  get<HTMLElement>('#lesson-progress-label').textContent = `${flow.index + (flow.passed ? 1 : 0)} completed`;
  get<HTMLElement>('#lesson-kicker').textContent = `${String(number).padStart(2, '0')} / ${lesson.timed ? 'Final trial' : 'Rune practice'}`;
  get<HTMLElement>('#lesson-glyph').textContent = lesson.glyph;
  get<HTMLElement>('#lesson-title').textContent = lesson.title;
  get<HTMLElement>('#lesson-instruction').textContent = lesson.instruction;
  get<HTMLElement>('#lesson-effect').textContent = lesson.effect;
  get<HTMLElement>('#lesson-tip').textContent = lesson.tip;
  const scene = get<HTMLElement>('#tutorial-scene');
  scene.dataset.result = flow.passed ? 'success' : 'idle';
  scene.dataset.threat = flow.threatEndsAt !== undefined ? 'active' : 'idle';
  get<HTMLElement>('#scene-rune').textContent = lesson.glyph;
  get<HTMLElement>('#scene-caption').textContent = flow.complete ? 'Shield raised. The fireball was blocked.'
    : flow.passed ? `${lesson.spell} landed. Your training opponent is ready for the next lesson.`
      : lesson.timed ? 'The rival will charge a fireball. Raise a Shield before it lands.'
        : `Cast ${lesson.spell} to practice its effect in the arena.`;
  feedback.textContent = flow.feedback.message;
  feedback.dataset.kind = flow.feedback.kind;
  get<HTMLButtonElement>('#continue-lesson').hidden = !flow.passed || flow.complete;
  get<HTMLElement>('#tutorial-finish').hidden = !flow.complete;
  get<HTMLButtonElement>('#start-threat').hidden = !lesson.timed || flow.passed || flow.threatEndsAt !== undefined;
  get<HTMLElement>('#threat-panel').hidden = flow.threatEndsAt === undefined || flow.passed;
  const template = DEFAULT_SHAPE_TEMPLATES.find((entry) => entry.id === lesson.shape)!;
  get<SVGPolylineElement>('#rune-guide-path').setAttribute('points', template.points.map((point) => `${point.x * 100},${point.y * 100}`).join(' '));
}

function submitStroke(stroke: RecordedStroke): void {
  if (flow.passed) return;
  const spell = SHAPE_SOUND[flow.lesson.shape];
  flow.cast(evaluator.evaluate(stroke), performance.now());
  if (flow.passed && spell) spellAudio.play(spell);
  render();
}

function pointFor(event: PointerEvent): PathPoint {
  const rect = pad.getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
}

pad.addEventListener('pointerdown', (event) => {
  if (pointerId !== undefined || flow.passed) return;
  pointerId = event.pointerId;
  pointerPoints = [pointFor(event)];
  fitCanvas(pad);
  pad.setPointerCapture(event.pointerId);
  paintStroke(padContext, pad, pointerPoints);
});
pad.addEventListener('pointermove', (event) => {
  if (event.pointerId !== pointerId) return;
  const next = pointFor(event);
  const previous = pointerPoints.at(-1)!;
  if (Math.hypot(next.x - previous.x, next.y - previous.y) < .003) return;
  pointerPoints.push(next);
  paintStroke(padContext, pad, pointerPoints);
});
pad.addEventListener('pointerup', (event) => {
  if (event.pointerId !== pointerId) return;
  pointerPoints.push(pointFor(event));
  pointerId = undefined;
  submitStroke({ key: 'pointer', label: 'Pointer', points: pointerPoints, aspectRatio: pad.clientWidth / pad.clientHeight });
});
pad.addEventListener('pointercancel', () => { pointerId = undefined; pointerPoints = []; padContext.clearRect(0, 0, pad.width, pad.height); });

get<HTMLButtonElement>('#continue-lesson').addEventListener('click', () => {
  if (!flow.continue()) return;
  pointerPoints = [];
  padContext.clearRect(0, 0, pad.width, pad.height);
  cameraContext.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
  render();
  get<HTMLElement>('#lesson-title').focus();
});

function updateThreat(): void {
  if (flow.threatEndsAt === undefined) return;
  const remaining = flow.threatEndsAt - performance.now();
  get<HTMLProgressElement>('#threat-progress').value = Math.max(0, Math.min(3000, 3000 - remaining));
  if (flow.tick(performance.now())) { render(); return; }
  threatFrame = requestAnimationFrame(updateThreat);
}

get<HTMLButtonElement>('#start-threat').addEventListener('click', () => {
  flow.startThreat(performance.now());
  render();
  cancelAnimationFrame(threatFrame);
  updateThreat();
});

function stopCamera(message = 'Camera stopped. You can keep drawing with a mouse or touch.'): void {
  cameraSession += 1;
  cancelAnimationFrame(cameraFrame);
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
  video.pause();
  video.srcObject = null;
  lastVideoTime = -1;
  recorder.reset();
  resetHandProcessing();
  cameraStart.disabled = false;
  cameraStop.disabled = true;
  get<HTMLElement>('#tutorial-camera-preview').hidden = true;
  cameraStatus.textContent = message;
}

function trackFrame(session: number): void {
  if (session !== cameraSession || !tracker || !stream) return;
  try {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      fitCanvas(cameraCanvas);
      const now = performance.now();
      const results = tracker.detectForVideo(video, now);
      const hands = processHands(results, now);
      const completed = recorder.update(hands.hands, results.landmarks, now, video.videoWidth / video.videoHeight);
      const active = recorder.getStrokes()[0];
      cameraContext.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
      if (active) paintStroke(cameraContext, cameraCanvas, active.points);
      for (const stroke of completed) submitStroke(stroke);
      const pending = hands.hands.find((hand) => hand.phase === 'awaiting-release');
      const pointing = hands.hands.find((hand) => hand.indexRaised);
      cameraStatus.textContent = pending?.releaseCorrection ?? (pending ? 'Open your palm to release.'
        : hands.castingHands ? 'Drawing your rune…' : pointing?.correction ?? (results.landmarks.length ? 'Point one index finger to draw.' : 'Hold one hand in view.'));
    }
    cameraFrame = requestAnimationFrame(() => trackFrame(session));
  } catch {
    stopCamera('Hand tracking stopped. Try starting the camera again, or use mouse/touch.');
  }
}

cameraStart.addEventListener('click', async () => {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = 'Camera needs localhost or HTTPS. Mouse/touch drawing still works.';
    return;
  }
  const session = ++cameraSession;
  cameraStart.disabled = true;
  cameraStop.disabled = false;
  cameraStatus.textContent = 'Requesting camera…';
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    if (session !== cameraSession) { acquired.getTracks().forEach((track) => track.stop()); return; }
    stream = acquired;
    acquired.getVideoTracks()[0]?.addEventListener('ended', () => { if (session === cameraSession) stopCamera('Camera disconnected.'); }, { once: true });
    video.srcObject = acquired;
    await video.play();
    if (session !== cameraSession) return;
    get<HTMLElement>('#tutorial-camera-preview').hidden = false;
    cameraStatus.textContent = 'Loading hand tracking…';
    tracker ??= await createHandTracker();
    if (session !== cameraSession) return;
    cameraStatus.textContent = 'Point one index finger to draw.';
    trackFrame(session);
  } catch {
    if (session === cameraSession) stopCamera('Camera could not start. Check permission, or use mouse/touch.');
  }
});
cameraStop.addEventListener('click', () => stopCamera());
window.addEventListener('pagehide', () => { stopCamera(); cancelAnimationFrame(threatFrame); tracker?.close(); tracker = undefined; music.dispose(); unmountSound(); });

void auth.restoreSession().then((user) => {
  if (!user) { window.location.replace(import.meta.env.BASE_URL); return; }
  get<HTMLElement>('#tutorial-session').hidden = true;
  get<HTMLElement>('#tutorial-screen').hidden = false;
  get<HTMLElement>('#lesson-title').tabIndex = -1;
  fitCanvas(pad);
  render();
}).catch(() => { get<HTMLElement>('#tutorial-session').textContent = 'Could not open the tutorial. Return to sign in and try again.'; });
