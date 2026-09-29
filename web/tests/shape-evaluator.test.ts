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

  it('accepts triangular sides despite template proportions, while rejecting an open flat outline', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    const path = (pairs: number[][]): PathPoint[] => pairs.map(([x, y]) => ({ x, y }));
    const rounded = path([
      [.503, 0], [.595, .064], [.878, .326], [.999, .461], [.961, .526],
      [.692, .552], [.324, .574], [.054, .584], [0, .542], [.112, .422],
      [.303, .253], [.49, .083], [.568, .013],
    ]);
    const flattened = path([
      [.629, 0], [.71, .11], [.921, .349], [1, .51], [.751, .535],
      [.289, .508], [0, .525], [.131, .462], [.355, .357], [.507, .239],
    ]);
    const broadClosed = path([
      [.634, 0], [.75, .122], [.966, .334], [.976, .444], [.689, .417],
      [.263, .389], [0, .407], [.121, .351], [.351, .259], [.547, .168], [.633, .06],
    ]);

    expect(evaluator.evaluate(rounded).status).toBe('matched');
    expect(evaluator.evaluate(rounded).templateId).toBe('triangle');
    expect(evaluator.evaluate(flattened).status).toBe('near-miss');
    expect(evaluator.evaluate(broadClosed).status).toBe('matched');
  });

  it('matches wide captured triangles with a short extra corner', () => {
    const widePaths = [
      [
        [.366, .344], [.372, .356], [.403, .401], [.436, .451], [.445, .469],
        [.442, .481], [.428, .490], [.402, .495], [.366, .500], [.326, .504],
        [.285, .505], [.249, .506], [.223, .507], [.205, .504], [.198, .495],
        [.203, .482], [.236, .442], [.289, .403], [.334, .365], [.351, .349],
      ],
      [
        [.432, .368], [.472, .411], [.501, .446], [.502, .455], [.497, .461],
        [.484, .467], [.463, .472], [.433, .477], [.400, .478], [.368, .476],
        [.341, .473], [.321, .474], [.313, .470], [.317, .461], [.345, .436],
        [.382, .407], [.416, .378], [.430, .367], [.442, .361],
      ],
    ];
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    for (const pairs of widePaths) {
      const evaluation = evaluator.evaluate({
        key: 'captured', label: 'Right', aspectRatio: 4 / 3,
        points: pairs.map(([x, y]) => ({ x, y })),
      });
      expect(evaluation.candidates?.find((candidate) => candidate.templateId === 'triangle')?.outlineError)
        .toBeGreaterThan(0.18);
      expect(evaluation.status).toBe('matched');
      expect(evaluation.templateId).toBe('triangle');
    }
  });

  it('routes a broad rounded rectangle to the square family rather than triangle', () => {
    const roundedRectangle: PathPoint[] = [
      [.732, .027], [.74, .081], [.882, .335], [.989, .618], [.949, .745],
      [.648, .751], [.257, .731], [.037, .726], [.005, .583], [.012, .349],
      [.076, .154], [.266, .037], [.554, 0], [.801, .022], [.882, .024],
    ].map(([x, y]) => ({ x, y }));
    expect(new ShapeEvaluator([triangle]).evaluate(roundedRectangle).status).not.toBe('matched');
    const fullEvaluation = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES).evaluate(roundedRectangle);
    expect(fullEvaluation.status).toBe('matched');
    expect(fullEvaluation.templateId).toBe('square');
  });

  it('recognizes a circle using radial consistency', () => {
    const evaluator = new ShapeEvaluator([circle]);
    const evaluation = evaluator.evaluate(circle.points);

    expect(evaluation.status).toBe('matched');
    expect(evaluation.templateId).toBe('circle');
    expect(evaluation.diagnostics.radialError).toBeLessThan(0.2);
  });

  it('uses camera aspect ratio to recognize a screen-space circle', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    const stretched = circle.points.map((point) => ({ x: point.x * 0.5625, y: point.y }));
    const evaluation = evaluator.evaluate({ key: 'a', label: 'Right', points: stretched, aspectRatio: 16 / 9 });
    expect(evaluation.status).toBe('matched');
    expect(evaluation.templateId).toBe('circle');
  });

  it('accepts mirrored lightning when the template permits reflection', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    const mirrored = lightning.points.map((point) => ({ x: 1 - point.x, y: point.y }));
    expect(evaluator.evaluate(mirrored).templateId).toBe('zigzag');
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

  it('recognizes a square without confusing it with a triangle', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    const square = [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
      { x: 0.25, y: 0.25 },
    ];
    const evaluation = evaluator.evaluate(square);

    expect(evaluation.status).toBe('matched');
    expect(evaluation.templateId).toBe('square');
  });

  it.each(['hourglass', 'square', 'line'])('recognizes the new %s rune in the full spell set', (id) => {
    const template = DEFAULT_SHAPE_TEMPLATES.find((shape) => shape.id === id)!;
    const evaluation = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES).evaluate(
      transform(template.points, 1.3, { x: 0.1, y: -0.2 }),
    );
    expect(evaluation.status).toBe('matched');
    expect(evaluation.templateId).toBe(id);
  });

  it('recognizes a hand-drawn hourglass as one continuous rune', () => {
    const stroke: PathPoint[] = [
      { x: .49, y: .51 }, { x: .23, y: .19 }, { x: .51, y: .22 }, { x: .79, y: .2 },
      { x: .52, y: .49 }, { x: .21, y: .78 }, { x: .5, y: .81 }, { x: .78, y: .8 }, { x: .49, y: .52 },
    ];
    const result = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES).evaluate(stroke);
    expect(result.status).toBe('matched');
    expect(result.templateId).toBe('hourglass');
  });

  it('accepts a rectangular rune but rejects a tiny straight movement as Spark', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    const rectangle = [
      { x: .2, y: .3 }, { x: .8, y: .3 }, { x: .8, y: .7 }, { x: .2, y: .7 }, { x: .2, y: .3 },
    ];
    expect(evaluator.evaluate(rectangle).templateId).toBe('square');
    const tinyLine = [
      { x: .5, y: .5 }, { x: .52, y: .5 }, { x: .54, y: .5 }, { x: .56, y: .5 },
    ];
    expect(evaluator.evaluate(tinyLine).status).not.toBe('matched');
    const longLine = [
      { x: .2, y: .5 }, { x: .4, y: .505 }, { x: .6, y: .495 }, { x: .8, y: .5 },
    ];
    expect(evaluator.evaluate(longLine).templateId).toBe('line');
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
