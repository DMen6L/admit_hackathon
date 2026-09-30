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
  if (evaluation.status === 'matched') {
    return {
      state: 'success',
      icon: '✓',
      title: 'ЗАКЛИНАНИЕ СОЗДАНО',
      detail: evaluation.templateName ?? 'Руна',
    };
  }
  if (evaluation.status === 'near-miss') {
    return {
      state: 'near-miss',
      icon: '!',
      title: 'ПОЧТИ ПОЛУЧИЛОСЬ',
      detail: evaluation.templateName ?? 'Фигура',
      correction: evaluation.correction ?? 'Нарисуйте контур руны чётче',
    };
  }
  if (evaluation.status === 'insufficient') {
    return {
      state: 'cancelled',
      icon: '↺',
      title: 'ЗАКЛИНАНИЕ ОТМЕНЕНО',
      detail: 'Линия слишком короткая для распознавания.',
      correction: evaluation.correction,
    };
  }
  return {
    state: 'failure',
    icon: '×',
    title: 'ЗАКЛИНАНИЕ НЕ СОЗДАНО',
    detail: 'Руна не найдена',
    correction: evaluation.correction ?? 'Нарисуйте фигуру крупнее и чётче',
  };
}
