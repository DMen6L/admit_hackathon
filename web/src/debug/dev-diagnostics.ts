import './dev-diagnostics.css';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandProcessingResult } from '../input/process-hands';
import type { PathPoint, RecordedStroke } from '../drawing/path-recorder';
import type { ShapeEvaluation, ShapeEvaluator } from '../shapes/shape-evaluator';
import { RecognitionCaptureSession, parseCapture } from './recognition-capture';
import { replayCapture } from './replay';

interface DiagnosticsOptions {
  shapeEvaluator: ShapeEvaluator;
  stopCamera: () => void;
  showCastResult: (evaluation: ShapeEvaluation) => unknown;
  resetStroke: () => void;
}

export interface DevDiagnostics {
  onFrame(results: HandLandmarkerResult, processed: HandProcessingResult, timestampMs: number,
    width: number, height: number, strokes: readonly RecordedStroke[]): void;
  onCast(stroke: RecordedStroke, evaluation: ShapeEvaluation, timestampMs: number): void;
  dispose(): void;
}

/** Loaded only by Vite's development entry path. */
export function mountDiagnostics(options: DiagnosticsOptions): DevDiagnostics {
  const panel = document.createElement('details');
  panel.className = 'diagnostics';
  panel.innerHTML = `
    <summary>Диагностика распознавания</summary>
    <div class="buttons">
      <button id="capture-toggle" type="button">Начать локальную запись</button>
      <button id="capture-download" type="button" disabled>Скачать запись</button>
      <button id="replay-open" type="button">Воспроизвести JSON-запись</button>
      <input id="replay-file" type="file" accept="application/json,.json" hidden>
    </div>
    <p id="debug-status">Запись выключена.</p>
    <canvas id="debug-path" width="320" height="240" aria-label="Последняя исходная и обработанная траектория"></canvas>
    <p>Серый: исходная траектория пальца. Золотой: обработанная траектория.</p>
    <pre id="debug-pose">Рука пока не обнаружена.</pre>
    <pre id="debug-candidates">Завершённых попыток пока нет.</pre>`;
  document.querySelector('.tracker')!.append(panel);

  const captureToggle = panel.querySelector<HTMLButtonElement>('#capture-toggle')!;
  const captureDownload = panel.querySelector<HTMLButtonElement>('#capture-download')!;
  const replayOpen = panel.querySelector<HTMLButtonElement>('#replay-open')!;
  const replayFile = panel.querySelector<HTMLInputElement>('#replay-file')!;
  const debugStatus = panel.querySelector<HTMLParagraphElement>('#debug-status')!;
  const debugCandidates = panel.querySelector<HTMLElement>('#debug-candidates')!;
  const debugPose = panel.querySelector<HTMLElement>('#debug-pose')!;
  const debugPath = panel.querySelector<HTMLCanvasElement>('#debug-path')!;
  const debugContext = debugPath.getContext('2d')!;
  const capture = new RecognitionCaptureSession();
  let captureEnabled = false;

  function drawDebugPath(stroke: RecordedStroke): void {
    debugPath.height = Math.round(debugPath.width / (stroke.aspectRatio ?? 4 / 3));
    debugContext.clearRect(0, 0, debugPath.width, debugPath.height);
    const draw = (points: readonly PathPoint[], color: string) => {
      if (points.length < 2) return;
      debugContext.beginPath();
      debugContext.strokeStyle = color;
      debugContext.lineWidth = 3;
      debugContext.moveTo(points[0].x * debugPath.width, points[0].y * debugPath.height);
      for (const point of points.slice(1)) debugContext.lineTo(point.x * debugPath.width, point.y * debugPath.height);
      debugContext.stroke();
    };
    draw(stroke.rawPoints ?? [], '#8796a8');
    draw(stroke.points, '#ffd166');
  }

  function showDiagnostics(stroke: RecordedStroke, evaluation: ShapeEvaluation): void {
    drawDebugPath(stroke);
    debugCandidates.textContent = JSON.stringify({
      result: evaluation.status,
      selected: evaluation.templateId,
      matchScore: evaluation.score,
      ambiguous: evaluation.ambiguous,
      candidates: evaluation.candidates,
    }, null, 2);
  }

  captureToggle.addEventListener('click', () => {
    captureEnabled = !captureEnabled;
    if (captureEnabled) {
      capture.reset();
      options.resetStroke();
    }
    captureToggle.textContent = captureEnabled ? 'Остановить локальную запись' : 'Начать локальную запись';
    captureDownload.disabled = captureEnabled;
    debugStatus.textContent = captureEnabled ? 'Точки кисти записываются локально.' : 'Запись готова к скачиванию.';
  });
  captureDownload.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(capture.export())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'recognition-capture.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  replayOpen.addEventListener('click', () => replayFile.click());
  replayFile.addEventListener('change', () => {
    const file = replayFile.files?.[0];
    if (!file) return;
    void file.text().then((contents) => {
      const imported = parseCapture(JSON.parse(contents));
      options.stopCamera();
      captureEnabled = false;
      captureToggle.textContent = 'Начать локальную запись';
      const casts = replayCapture(imported, options.shapeEvaluator);
      const last = casts.at(-1);
      if (last) {
        showDiagnostics(last.stroke, last.evaluation);
        options.showCastResult(last.evaluation);
      } else {
        const partial = imported.partialStrokes?.find((stroke) => stroke.points.length > 0);
        if (partial) drawDebugPath(partial);
        debugCandidates.textContent = 'Нет завершённого заклинания. Проверьте историю поз, положение пальца и раскрытие ладони.';
      }
      debugPose.textContent = JSON.stringify(imported.frames.at(-1)?.poses ?? [], null, 2);
      debugStatus.textContent = `Воспроизведено заклинаний: ${casts.length}.`;
    }).catch((error: unknown) => {
      debugStatus.textContent = `Ошибка воспроизведения: ${error instanceof Error ? error.message : 'некорректная запись'}`;
    }).finally(() => { replayFile.value = ''; });
  });

  return {
    dispose() { panel.remove(); },
    onFrame(results, processed, timestampMs, width, height, strokes) {
      if (panel.open) {
        debugPose.textContent = JSON.stringify(processed.hands.map((hand) => ({
          id: hand.id, phase: hand.phase, indexRaised: hand.indexRaised,
          otherFingersCurled: hand.otherFingersCurled, thumbRelaxed: hand.thumbRelaxed,
          palmFacingCamera: hand.palmFacingCamera, releasePose: hand.releasePose,
        })), null, 2);
        const active = strokes.at(-1);
        if (active) drawDebugPath(active);
      }
      if (captureEnabled && !capture.recordFrame(results, processed, timestampMs, width, height, strokes)) {
        captureEnabled = false;
        captureToggle.textContent = 'Начать локальную запись';
        captureDownload.disabled = false;
        debugStatus.textContent = 'Записано 900 кадров. Скачайте запись и начните новую.';
      }
    },
    onCast(stroke, evaluation, timestampMs) {
      showDiagnostics(stroke, evaluation);
      if (captureEnabled) capture.recordCast(stroke, evaluation, timestampMs);
    },
  };
}
