import { describe, expect, it } from 'vitest';
import { TutorialFlow, LESSONS } from '../src/tutorial/tutorial-flow';
import { DEFAULT_SHAPE_TEMPLATES, ShapeEvaluator, type ShapeEvaluation } from '../src/shapes/shape-evaluator';

const matched = (templateId: string): ShapeEvaluation => ({ status: 'matched', templateId, score: .9 } as ShapeEvaluation);
const nearMiss = (correction: string): ShapeEvaluation => ({ status: 'near-miss', correction, score: .45 } as ShapeEvaluation);

describe('guided tutorial', () => {
  it('only asks for runes supported by the production recognizer', () => {
    const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);
    for (const lesson of LESSONS) {
      const template = DEFAULT_SHAPE_TEMPLATES.find((entry) => entry.id === lesson.shape);
      expect(template, lesson.spell).toBeDefined();
      expect(evaluator.evaluate(template!.points).templateId, lesson.spell).toBe(lesson.shape);
    }
  });

  it('requires the current rune and advances one lesson at a time', () => {
    const flow = new TutorialFlow();
    expect(LESSONS).toHaveLength(7);
    expect(flow.continue()).toBe(false);
    expect(flow.cast(matched('triangle'), 0).message).toContain('That was Fireball');
    expect(flow.index).toBe(0);
    expect(flow.cast(matched('line'), 0).kind).toBe('success');
    expect(flow.continue()).toBe(true);
    expect(flow.lesson.shape).toBe('triangle');
    expect(flow.passed).toBe(false);
  });

  it('offers shape-specific recovery without unlocking the next lesson', () => {
    const flow = new TutorialFlow();
    const feedback = flow.cast(nearMiss('Draw a longer stroke'), 0);
    expect(feedback.message).toContain('Draw a longer stroke');
    expect(feedback.message).toContain('Make the line broad');
    expect(flow.passed).toBe(false);
    expect(flow.continue()).toBe(false);
  });

  it('teaches all six spells before the timed defense drill', () => {
    const flow = new TutorialFlow();
    for (const lesson of LESSONS.slice(0, -1)) {
      expect(flow.lesson.shape).toBe(lesson.shape);
      flow.cast(matched(lesson.shape), 0);
      expect(flow.continue()).toBe(true);
    }
    expect(flow.lesson.timed).toBe(true);
    expect(flow.cast(matched('circle'), 0).kind).toBe('hint');
    expect(flow.passed).toBe(false);
    flow.startThreat(1000);
    expect(flow.cast(matched('circle'), 3999).kind).toBe('success');
    expect(flow.complete).toBe(true);
    expect(flow.continue()).toBe(false);
  });

  it('times out after three seconds and allows a retry', () => {
    const flow = new TutorialFlow();
    for (const lesson of LESSONS.slice(0, -1)) { flow.cast(matched(lesson.shape), 0); flow.continue(); }
    flow.startThreat(1000);
    expect(flow.tick(3999)).toBe(false);
    expect(flow.tick(4000)).toBe(true);
    expect(flow.feedback.message).toContain('fireball landed');
    expect(flow.passed).toBe(false);
    expect(flow.cast(matched('circle'), 4001).message).toContain('Start the incoming attack');
    flow.startThreat(5000);
    expect(flow.cast(matched('triangle'), 5500).message).toContain('needs Shield');
    expect(flow.cast(matched('circle'), 6000).kind).toBe('success');
  });
});
