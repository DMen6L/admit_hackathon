import { describe, expect, it } from 'vitest';
import { IndexPathRecorder, type PathHandState, type PathPoint } from '../src/drawing/path-recorder';

function hand(overrides: Partial<PathHandState> = {}): PathHandState {
  return {
    handIndex: 0,
    label: 'Right',
    isCasting: false,
    justStarted: false,
    justEnded: false,
    ...overrides,
  };
}

function landmarks(point: PathPoint): PathPoint[][] {
  const handPoints = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  handPoints[8] = point;
  return [handPoints];
}

describe('index path recorder', () => {
  it('ignores index movement before casting starts', () => {
    const recorder = new IndexPathRecorder();

    recorder.update([hand()], landmarks({ x: 0.2, y: 0.2 }));

    expect(recorder.getStrokes()).toEqual([]);
  });

  it('starts and extends a stroke from the index fingertip', () => {
    const recorder = new IndexPathRecorder();
    const casting = hand({ isCasting: true, justStarted: true });

    recorder.update([casting], landmarks({ x: 0.2, y: 0.2 }));
    recorder.update([hand({ isCasting: true }),], landmarks({ x: 0.4, y: 0.3 }));

    const stroke = recorder.getStrokes()[0];
    expect(stroke.label).toBe('Right');
    expect(stroke.points).toHaveLength(2);
    expect(stroke.points[0]).toEqual({ x: 0.2, y: 0.2 });
    expect(stroke.points[1].x).toBeCloseTo(0.29);
    expect(stroke.points[1].y).toBeCloseTo(0.245);
  });

  it('filters tiny movements and clamps points to normalized coordinates', () => {
    const recorder = new IndexPathRecorder();
    recorder.update([hand({ isCasting: true, justStarted: true })], landmarks({ x: 1.2, y: -0.2 }));
    recorder.update([hand({ isCasting: true })], landmarks({ x: 1.204, y: -0.196 }));

    const stroke = recorder.getStrokes()[0];
    expect(stroke.points).toHaveLength(1);
    expect(stroke.points[0]).toEqual({ x: 1, y: 0 });
  });

  it('clears a stroke when casting ends or tracking disappears', () => {
    const recorder = new IndexPathRecorder();
    recorder.update([hand({ isCasting: true, justStarted: true })], landmarks({ x: 0.2, y: 0.2 }));
    recorder.update([hand({ justEnded: true })], landmarks({ x: 0.3, y: 0.3 }));
    expect(recorder.getStrokes()).toEqual([]);

    recorder.update([hand({ isCasting: true, justStarted: true })], landmarks({ x: 0.2, y: 0.2 }));
    recorder.update([], []);
    expect(recorder.getStrokes()).toEqual([]);
  });

  it('keeps left and right strokes independent', () => {
    const recorder = new IndexPathRecorder();
    recorder.update([
      hand({ label: 'Left', handIndex: 0, isCasting: true, justStarted: true }),
      hand({ label: 'Right', handIndex: 1, isCasting: true, justStarted: true }),
    ], [landmarks({ x: 0.2, y: 0.2 })[0], landmarks({ x: 0.8, y: 0.8 })[0]]);

    expect(recorder.getStrokes().map((stroke) => stroke.label)).toEqual(['Left', 'Right']);
  });

  it('resets every active stroke', () => {
    const recorder = new IndexPathRecorder();
    recorder.update([hand({ isCasting: true, justStarted: true })], landmarks({ x: 0.2, y: 0.2 }));

    recorder.reset();

    expect(recorder.getStrokes()).toEqual([]);
  });
});
