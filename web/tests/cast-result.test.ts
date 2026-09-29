import { describe, expect, it } from 'vitest';
import { presentCastResult } from '../src/ui/cast-result';
import type { ShapeEvaluation } from '../src/shapes/shape-evaluator';

function evaluation(status: ShapeEvaluation['status'], correction?: string): ShapeEvaluation {
  return {
    status,
    templateName: 'Triangle rune',
    score: 0.74,
    correction,
    ambiguous: false,
    diagnostics: {
      pointError: 0,
      directionError: 0,
      endpointError: 0,
      closureError: 0,
      lengthRatio: 1,
      topologyError: 0,
      cornerError: 0,
      aspectRatioError: 0,
      turnError: 0,
      radialError: 0,
      coverageError: 0,
    },
  };
}

describe('cast result presentation', () => {
  it('makes a successful cast explicit', () => {
    const result = presentCastResult(evaluation('matched'));

    expect(result.state).toBe('success');
    expect(result.title).toBe('SPELL CAST');
    expect(result.detail).toContain('Triangle rune');
  });

  it('keeps a near-miss correction visible', () => {
    const result = presentCastResult(evaluation('near-miss', 'Use fewer turns'));

    expect(result.state).toBe('near-miss');
    expect(result.title).toBe('ALMOST');
    expect(result.correction).toBe('Use fewer turns');
  });

  it('distinguishes failure from cancellation', () => {
    const failure = presentCastResult(evaluation('unrecognized'));
    expect(failure.state).toBe('failure');
    expect(failure.detail).toBe('No spell matched');
    expect(presentCastResult(evaluation('insufficient')).state).toBe('cancelled');
  });
});
