import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHAPE_TEMPLATES,
  ShapeEvaluator,
  type ShapeTemplate,
} from '../src/shapes/shape-evaluator';
import type { PathPoint } from '../src/drawing/path-recorder';

const triangle = DEFAULT_SHAPE_TEMPLATES.find((template) => template.id === 'triangle')!;
const circle = DEFAULT_SHAPE_TEMPLATES.find((template) => template.id === 'circle')!;
const lightning = DEFAULT_SHAPE_TEMPLATES.find((template) => template.id === 'zigzag')!;

function transform(points: readonly PathPoint[], scale: number, offset: PathPoint): PathPoint[] {
  return points.map((point) => ({
    x: point.x * scale + offset.x,
    y: point.y * scale + offset.y,
  }));
}

describe('shape evaluator', () => {
  it('matches a template after translation and scale changes', () => {
    const evaluator = new ShapeEvaluator([triangle]);
    const evaluation = evaluator.evaluate(transform(triangle.points, 2.4, { x: 4, y: -3 }));

    expect(evaluation.status).toBe('matched');
    expect(evaluation.templateId).toBe('triangle');
    expect(evaluation.score).toBeGreaterThan(0.82);
    expect(evaluation.correction).toBeUndefined();
  });

  it('accepts a slightly open closed shape', () => {
    const evaluator = new ShapeEvaluator([triangle]);
    const incomplete = [
      ...triangle.points.slice(0, 3),
      { x: 0.28, y: 0.73 },
    ];
    const evaluation = evaluator.evaluate(incomplete);

    expect(evaluation.status).toBe('matched');
    expect(evaluation.correction).toBeUndefined();
    expect(evaluation.diagnostics.closureError).toBeGreaterThan(0);
  });

  it('keeps a slightly imperfect triangle out of the lightning class', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    const imperfect = [
      ...triangle.points.slice(0, 3),
      { x: 0.31, y: 0.70 },
    ];
    const overshooting = [
      ...triangle.points.slice(0, 3),
      { x: 0.16, y: 0.80 },
    ];

    const evaluation = evaluator.evaluate(imperfect);
    const overshootEvaluation = evaluator.evaluate(overshooting);

    expect(evaluation.templateId).toBe('triangle');
    expect(evaluation.status).not.toBe('unrecognized');
    expect(overshootEvaluation.templateId).toBe('triangle');
    expect(overshootEvaluation.status).not.toBe('unrecognized');
  });

  it('still recognizes lightning when the endpoints are clearly separated', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    const evaluation = evaluator.evaluate(lightning.points);

    expect(evaluation.status).toBe('matched');
    expect(evaluation.templateId).toBe('zigzag');
  });

  it('does not use lightning as a fallback for an open triangle', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    const openTriangle = [
      { x: 0.25, y: 0.75 },
      { x: 0.38, y: 0.47 },
      { x: 0.50, y: 0.20 },
      { x: 0.62, y: 0.47 },
      { x: 0.75, y: 0.75 },
    ];

    const evaluation = evaluator.evaluate(openTriangle);

    expect(evaluation.status).toBe('unrecognized');
    expect(evaluation.templateId).toBeUndefined();
  });

  it('reports an ambiguous endpoint as a triangle near miss instead of lightning', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    const ambiguousEndpoint = [
      ...triangle.points.slice(0, 3),
      { x: 0.45, y: 0.55 },
    ];

    const evaluation = evaluator.evaluate(ambiguousEndpoint);

    expect(evaluation.status).toBe('near-miss');
    expect(evaluation.templateId).toBe('triangle');
  });

  it('matches a broad noisy path without exact point tracing', () => {
    const evaluator = new ShapeEvaluator([triangle]);
    const noisy = [
      { x: 0.22, y: 0.73 },
      { x: 0.35, y: 0.46 },
      { x: 0.51, y: 0.18 },
      { x: 0.68, y: 0.43 },
      { x: 0.79, y: 0.73 },
      { x: 0.62, y: 0.76 },
      { x: 0.41, y: 0.74 },
      { x: 0.22, y: 0.73 },
    ];
    const evaluation = evaluator.evaluate(noisy);

    expect(evaluation.status).toBe('matched');
    expect(evaluation.score).toBeGreaterThanOrEqual(0.60);
  });

  it('recognizes a circle using radial consistency', () => {
    const evaluator = new ShapeEvaluator([circle]);
    const evaluation = evaluator.evaluate(circle.points);

    expect(evaluation.status).toBe('matched');
    expect(evaluation.templateId).toBe('circle');
    expect(evaluation.diagnostics.radialError).toBeLessThan(0.2);
  });

  it('tolerates uneven circle samples while rejecting a partial arc', () => {
    const evaluator = new ShapeEvaluator([circle]);
    const unevenCircle = circle.points.filter((_, index) => index % 3 !== 1);
    const partialArc = circle.points.slice(0, 16);

    expect(evaluator.evaluate(unevenCircle).status).toBe('matched');
    expect(evaluator.evaluate(partialArc).status).toBe('unrecognized');
  });

  it('keeps flexible templates tolerant of reversed drawing direction', () => {
    const evaluator = new ShapeEvaluator([lightning]);
    const reversed = [...lightning.points].reverse();
    const evaluation = evaluator.evaluate(reversed);

    expect(evaluation.status).toBe('matched');
  });

  it('supports a strict direction requirement when a template declares one', () => {
    const upward: ShapeTemplate = {
      id: 'upward-line',
      name: 'Upward line',
      topology: 'open',
      expectedCorners: 0,
      closure: 'ignored',
      direction: 'up',
      points: [
        { x: 0.5, y: 0.8 },
        { x: 0.5, y: 0.2 },
      ],
    };
    const evaluator = new ShapeEvaluator([upward]);
    const evaluation = evaluator.evaluate([
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.4 },
      { x: 0.5, y: 0.6 },
      { x: 0.5, y: 0.8 },
    ]);

    expect(evaluation.status).toBe('near-miss');
    expect(evaluation.diagnostics.directionError).toBeGreaterThan(0.35);
    expect(evaluation.correction).toContain('direction');
  });

  it('does not treat a closed loop as an open lightning gesture', () => {
    const evaluator = new ShapeEvaluator([lightning]);
    const evaluation = evaluator.evaluate([
      { x: 0.2, y: 0.7 },
      { x: 0.4, y: 0.25 },
      { x: 0.6, y: 0.7 },
      { x: 0.8, y: 0.25 },
      { x: 0.2, y: 0.7 },
    ]);

    expect(evaluation.status).not.toBe('matched');
  });

  it('does not label an unsupported square as a triangle', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    const square = [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
      { x: 0.25, y: 0.25 },
    ];
    const evaluation = evaluator.evaluate(square);

    expect(evaluation.status).toBe('unrecognized');
    expect(evaluation.templateId).toBeUndefined();
    expect(evaluation.templateName).toBeUndefined();
    expect(evaluation.score).toBe(0);
  });

  it('supports templates that explicitly allow rotation', () => {
    const rotating: ShapeTemplate = {
      id: 'rotating-line',
      name: 'Rotating line',
      allowRotation: true,
      points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }],
    };
    const evaluator = new ShapeEvaluator([rotating]);
    const evaluation = evaluator.evaluate([
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.4 },
      { x: 0.5, y: 0.6 },
      { x: 0.5, y: 0.8 },
    ]);

    expect(evaluation.status).toBe('matched');
  });

  it('rejects a path that is too short to evaluate', () => {
    const evaluator = new ShapeEvaluator([triangle]);
    const evaluation = evaluator.evaluate([
      { x: 0.5, y: 0.5 },
      { x: 0.505, y: 0.505 },
    ]);

    expect(evaluation.status).toBe('insufficient');
    expect(evaluation.score).toBe(0);
  });
});
