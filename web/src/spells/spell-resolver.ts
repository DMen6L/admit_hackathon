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
    name: 'Fireball',
    runeInterpretation: 'A triangle focuses flame into a traveling attack.',
  },
  {
    spellId: 'rune.circle',
    name: 'Shield',
    runeInterpretation: 'The unbroken ring absorbs the next incoming hit.',
  },
  {
    spellId: 'rune.lightning',
    name: 'Lightning',
    runeInterpretation: 'Alternating turns focus a quick electrical strike.',
  },
  {
    spellId: 'rune.hourglass',
    name: 'Twin Flare',
    runeInterpretation: 'Two joined triangles charge a slow, powerful attack.',
  },
  {
    spellId: 'rune.square',
    name: 'Time Lock',
    runeInterpretation: 'Four walls slow the opponent’s next attack.',
  },
  {
    spellId: 'rune.line',
    name: 'Spark',
    runeInterpretation: 'A single stroke releases a fast, light attack.',
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
