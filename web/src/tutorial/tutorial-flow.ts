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
  { spell: 'Искра', shape: 'line', glyph: '━', title: 'Начните с искры', instruction: 'Нарисуйте длинную прямую линию. Перед камерой ведите указательным пальцем, затем раскройте ладонь.', tip: 'Короткая линия не сработает. Рисуйте плавно и достаточно крупно.', effect: 'Быстрая атака · 7 урона' },
  { spell: 'Огненный шар', shape: 'triangle', glyph: '△', title: 'Создайте огненный шар', instruction: 'Нарисуйте треугольник и вернитесь к началу.', tip: 'Покажите все три стороны и замкните контур.', effect: 'Атака · 20 урона' },
  { spell: 'Щит', shape: 'circle', glyph: '○', title: 'Поднимите щит', instruction: 'Нарисуйте ровный замкнутый круг. Он защитит от атаки.', tip: 'Сделайте круг ровным и соедините его концы.', effect: 'Блокирует следующий удар' },
  { spell: 'Молния', shape: 'zigzag', glyph: 'ϟ', title: 'Ударьте молнией', instruction: 'Нарисуйте незамкнутый зигзаг с чёткими поворотами.', tip: 'Оставьте концы раздельно. Не замыкайте зигзаг.', effect: 'Быстрый удар · 15 урона' },
  { spell: 'Остановка времени', shape: 'square', glyph: '□', title: 'Замедлите следующую атаку', instruction: 'Нарисуйте четыре стороны квадрата или прямоугольника и замкните фигуру.', tip: 'Сделайте четыре чётких угла и соедините последнюю сторону с первой.', effect: 'Задерживает атаку соперника на 1,5 секунды' },
  { spell: 'Двойное пламя', shape: 'hourglass', glyph: '⧖', title: 'Освойте двойное пламя', instruction: 'Одним движением начните в центре, нарисуйте верхний и нижний треугольники и вернитесь в центр.', tip: 'Нарисуйте оба треугольника без остановки и не раскрывайте ладонь между ними.', effect: 'Мощная атака · 45 урона' },
  { spell: 'Щит', shape: 'circle', glyph: '○', title: 'Отреагируйте на угрозу', instruction: 'Когда появится огненный шар соперника, создайте щит до конца трёхсекундной зарядки.', tip: 'Следите за предупреждением, быстро нарисуйте круг и раскройте ладонь.', effect: 'Защитное испытание · блокировка огненного шара', timed: true },
];

export interface LessonFeedback { kind: 'success' | 'hint' | 'error'; message: string; }

export class TutorialFlow {
  index = 0;
  passed = false;
  threatEndsAt: number | undefined;
  feedback: LessonFeedback = { kind: 'hint', message: 'Выберите способ рисования и нарисуйте показанную руну.' };

  get lesson(): Lesson { return LESSONS[this.index]; }
  get complete(): boolean { return this.index === LESSONS.length - 1 && this.passed; }

  startThreat(now: number): void {
    if (!this.lesson.timed || this.passed) return;
    this.threatEndsAt = now + 3000;
    this.feedback = { kind: 'hint', message: 'Приближается огненный шар! Нарисуйте круг и раскройте ладонь до удара.' };
  }

  tick(now: number): boolean {
    if (this.threatEndsAt === undefined || this.passed || now < this.threatEndsAt) return false;
    this.threatEndsAt = undefined;
    this.feedback = { kind: 'error', message: 'Огненный шар попал в цель. Запустите атаку снова и создайте щит быстрее.' };
    return true;
  }

  cast(evaluation: ShapeEvaluation, now: number): LessonFeedback {
    if (this.passed) return this.feedback;
    if (this.lesson.timed && this.threatEndsAt !== undefined && now >= this.threatEndsAt) {
      this.tick(now);
      return this.feedback;
    }
    if (this.lesson.timed && this.threatEndsAt === undefined) {
      return this.feedback = { kind: 'hint', message: 'Запустите атаку противника, прежде чем создавать щит.' };
    }
    if (evaluation.status === 'matched') {
      if (evaluation.templateId === this.lesson.shape) {
        this.passed = true;
        this.threatEndsAt = undefined;
        return this.feedback = { kind: 'success', message: this.complete ? 'Идеальный блок! Вы готовы к дуэли.' : `${this.lesson.spell} применено! Переходите к следующему уроку, когда будете готовы.` };
      }
      const spell = LESSONS.find((lesson) => lesson.shape === evaluation.templateId)?.spell ?? 'другое заклинание';
      return this.feedback = { kind: 'hint', message: `Это было заклинание ${spell}. В этом уроке нужна руна ${this.lesson.spell}: ${this.lesson.tip}` };
    }
    const correction = evaluation.correction && evaluation.correction !== 'Ни одна руна не распознана'
      ? `${evaluation.correction}. ` : '';
    return this.feedback = { kind: 'hint', message: `${correction}${this.lesson.tip}` };
  }

  continue(): boolean {
    if (!this.passed || this.complete) return false;
    this.index += 1;
    this.passed = false;
    this.threatEndsAt = undefined;
    this.feedback = { kind: 'hint', message: this.lesson.timed ? 'Прочитайте предупреждение и начните защитное испытание.' : `Теперь попробуйте ${this.lesson.spell}.` };
    return true;
  }
}
