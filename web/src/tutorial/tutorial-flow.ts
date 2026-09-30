import type { ShapeEvaluation } from '../shapes/shape-evaluator';

export interface Lesson {
  spell: string;
  shape: string;
  glyph: string;
  title: string;
  instruction: string;
  tip: string;
  effect: string;
  timed?: boolean;
}

export const LESSONS: readonly Lesson[] = [
  { spell: 'Spark', shape: 'line', glyph: '━', title: 'Start with a spark', instruction: 'Draw one long, straight line. With a camera, point one index finger to trace it, then open your palm.', tip: 'A short stroke will not cast. Make the line broad and steady.', effect: 'Fast, light attack · 7 damage' },
  { spell: 'Fireball', shape: 'triangle', glyph: '△', title: 'Focus a fireball', instruction: 'Draw a triangle and come back near its starting point.', tip: 'Make all three sides visible; close the outline at the end.', effect: 'Traveling attack · 20 damage' },
  { spell: 'Shield', shape: 'circle', glyph: '○', title: 'Raise your shield', instruction: 'Draw a round, closed circle. You will use this rune against incoming attacks.', tip: 'Keep the loop round and reconnect its ends.', effect: 'Blocks the next incoming hit' },
  { spell: 'Lightning', shape: 'zigzag', glyph: 'ϟ', title: 'Strike with lightning', instruction: 'Draw an open zigzag with alternating sharp turns.', tip: 'Leave the ends apart. Do not close the lightning shape.', effect: 'Quick strike · 15 damage' },
  { spell: 'Time Lock', shape: 'square', glyph: '□', title: 'Slow the next attack', instruction: 'Draw four sides of a square or rectangle and close it.', tip: 'Give the rune four clear corners and connect the last side.', effect: 'Delays an opponent attack by 1.5 seconds' },
  { spell: 'Twin Flare', shape: 'hourglass', glyph: '⧖', title: 'Master Twin Flare', instruction: 'In one stroke, start in the center, draw the top triangle, then the bottom triangle, and finish at the center.', tip: 'Draw both triangles without lifting or opening your palm between them.', effect: 'Slow, powerful attack · 45 damage' },
  { spell: 'Shield', shape: 'circle', glyph: '○', title: 'React to the warning', instruction: 'When the enemy fireball appears, cast Shield before the three-second charge ends.', tip: 'Watch the triangle warning, draw a circle, and release your palm quickly.', effect: 'Defense drill · block a telegraphed fireball', timed: true },
];

export interface LessonFeedback { kind: 'success' | 'hint' | 'error'; message: string; }

export class TutorialFlow {
  index = 0;
  passed = false;
  threatEndsAt: number | undefined;
  feedback: LessonFeedback = { kind: 'hint', message: 'Choose a drawing method, then cast the shown rune.' };

  get lesson(): Lesson { return LESSONS[this.index]; }
  get complete(): boolean { return this.index === LESSONS.length - 1 && this.passed; }

  startThreat(now: number): void {
    if (!this.lesson.timed || this.passed) return;
    this.threatEndsAt = now + 3000;
    this.feedback = { kind: 'hint', message: 'Incoming fireball! Draw a circle and release before impact.' };
  }

  tick(now: number): boolean {
    if (this.threatEndsAt === undefined || this.passed || now < this.threatEndsAt) return false;
    this.threatEndsAt = undefined;
    this.feedback = { kind: 'error', message: 'The fireball landed. Start the warning again, then cast Shield sooner.' };
    return true;
  }

  cast(evaluation: ShapeEvaluation, now: number): LessonFeedback {
    if (this.passed) return this.feedback;
    if (this.lesson.timed && this.threatEndsAt !== undefined && now >= this.threatEndsAt) {
      this.tick(now);
      return this.feedback;
    }
    if (this.lesson.timed && this.threatEndsAt === undefined) {
      return this.feedback = { kind: 'hint', message: 'Start the incoming attack before casting your Shield.' };
    }
    if (evaluation.status === 'matched') {
      if (evaluation.templateId === this.lesson.shape) {
        this.passed = true;
        this.threatEndsAt = undefined;
        return this.feedback = { kind: 'success', message: this.complete ? 'Perfect block! You are ready to duel.' : `${this.lesson.spell} cast! Read the next lesson when you are ready.` };
      }
      const spell = LESSONS.find((lesson) => lesson.shape === evaluation.templateId)?.spell ?? 'another spell';
      return this.feedback = { kind: 'hint', message: `That was ${spell}. This lesson needs ${this.lesson.spell}: ${this.lesson.tip}` };
    }
    const correction = evaluation.correction && evaluation.correction !== 'No supported shape matched'
      ? `${evaluation.correction}. ` : '';
    return this.feedback = { kind: 'hint', message: `${correction}${this.lesson.tip}` };
  }

  continue(): boolean {
    if (!this.passed || this.complete) return false;
    this.index += 1;
    this.passed = false;
    this.threatEndsAt = undefined;
    this.feedback = { kind: 'hint', message: this.lesson.timed ? 'Read the warning, then start the defense drill.' : `Now try ${this.lesson.spell}.` };
    return true;
  }
}
