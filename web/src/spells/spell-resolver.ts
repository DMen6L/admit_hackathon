import type { ShapeEvaluation } from '../shapes/shape-evaluator';

/** Stable shape-to-spell IDs. Gameplay can replace these bindings without changing recognition. */
export type SpellBindings = Readonly<Record<string, string>>;

export const DEFAULT_SPELL_BINDINGS: SpellBindings = Object.freeze({
  triangle: 'rune.triangle',
  circle: 'rune.circle',
  zigzag: 'rune.lightning',
  hourglass: 'rune.hourglass',
  square: 'rune.square',
  line: 'rune.line',
});

export interface SpellDefinition {
  spellId: string;
  name: string;
  runeInterpretation: string;
}

/** Frontend copy for the prototype runes; replace or extend as the spell system evolves. */
export const DEFAULT_SPELL_DEFINITIONS: readonly SpellDefinition[] = [
  {
    spellId: 'rune.triangle',
    name: 'Огненный шар',
    runeInterpretation: 'Треугольник направляет пламя в атакующий снаряд.',
  },
  {
    spellId: 'rune.circle',
    name: 'Щит',
    runeInterpretation: 'Замкнутый круг отражает следующий удар.',
  },
  {
    spellId: 'rune.lightning',
    name: 'Молния',
    runeInterpretation: 'Чередующиеся повороты создают быстрый электрический удар.',
  },
  {
    spellId: 'rune.hourglass',
    name: 'Двойное пламя',
    runeInterpretation: 'Два соединённых треугольника создают медленную мощную атаку.',
  },
  {
    spellId: 'rune.square',
    name: 'Остановка времени',
    runeInterpretation: 'Четыре стороны замедляют следующую атаку соперника.',
  },
  {
    spellId: 'rune.line',
    name: 'Искра',
    runeInterpretation: 'Одна линия создаёт быструю лёгкую атаку.',
  },
];

/** JSON-safe message suitable for a WebSocket, fetch request, or multiplayer event. */
export interface SpellCastPayload {
  type: 'spell_cast';
  schemaVersion: 1;
  spellId: string;
  sourceShapeId: string;
  confidence: number;
}

export function spellDefinitionFor(
  spellId: string,
  definitions: readonly SpellDefinition[] = DEFAULT_SPELL_DEFINITIONS,
): SpellDefinition | undefined {
  return definitions.find((definition) => definition.spellId === spellId);
}

function confidenceFor(score: number): number {
  return Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0;
}

/**
 * Convert only a confirmed shape match into a backend-facing spell message.
 * Near misses and unrecognized paths deliberately produce no spell command.
 */
export function resolveSpell(
  evaluation: ShapeEvaluation,
  bindings: SpellBindings = DEFAULT_SPELL_BINDINGS,
): SpellCastPayload | undefined {
  if (evaluation.status !== 'matched' || !evaluation.templateId) return undefined;

  const spellId = bindings[evaluation.templateId];
  if (!spellId) return undefined;

  return {
    type: 'spell_cast',
    schemaVersion: 1,
    spellId,
    sourceShapeId: evaluation.templateId,
    confidence: confidenceFor(evaluation.score),
  };
}
