import type { ShapeEvaluation } from '../shapes/shape-evaluator';

export type CastResultState = 'success' | 'near-miss' | 'failure' | 'cancelled';

export interface CastResultPresentation {
  state: CastResultState;
  icon: string;
  title: string;
  detail: string;
  correction?: string;
}

export function presentCastResult(evaluation: ShapeEvaluation): CastResultPresentation {
  const score = `${Math.round(evaluation.score * 100)}% match score`;
  if (evaluation.status === 'matched') {
    return {
      state: 'success',
      icon: '✓',
      title: 'SPELL CAST',
      detail: `${evaluation.templateName ?? 'Rune'} · ${score}`,
    };
  }
  if (evaluation.status === 'near-miss') {
    return {
      state: 'near-miss',
      icon: '!',
      title: 'ALMOST',
      detail: `${evaluation.templateName ?? 'Shape'} · ${score}`,
      correction: evaluation.correction ?? 'Follow the broad outline more closely',
    };
  }
  if (evaluation.status === 'insufficient') {
    return {
      state: 'cancelled',
      icon: '↺',
      title: 'CAST CANCELLED',
      detail: 'The path was too short to identify.',
      correction: evaluation.correction,
    };
  }
  return {
    state: 'failure',
    icon: '×',
    title: 'CAST FAILED',
    detail: 'No spell matched',
    correction: evaluation.correction ?? 'Try a broader, clearer shape',
  };
}
