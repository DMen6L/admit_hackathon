import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPELL_BINDINGS,
  DEFAULT_SPELL_DEFINITIONS,
  resolveSpell,
  spellDefinitionFor,
} from '../src/spells/spell-resolver';
import type { ShapeEvaluation } from '../src/shapes/shape-evaluator';

function evaluation(status: ShapeEvaluation['status'], score = 0.74): ShapeEvaluation {
  return {
    status,
    templateId: 'triangle',
    templateName: 'Triangle rune',
    score,
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

describe('spell resolver', () => {
  it('converts a confirmed shape into a backend payload', () => {
    expect(resolveSpell(evaluation('matched'))).toEqual({
      type: 'spell_cast',
      schemaVersion: 1,
      spellId: DEFAULT_SPELL_BINDINGS.triangle,
      sourceShapeId: 'triangle',
      confidence: 0.74,
    });
  });

  it('does not send unsuccessful shape evaluations', () => {
    expect(resolveSpell(evaluation('near-miss'))).toBeUndefined();
    expect(resolveSpell(evaluation('unrecognized'))).toBeUndefined();
    expect(resolveSpell(evaluation('insufficient'))).toBeUndefined();
  });

  it('supports changing bindings without changing recognition', () => {
    const payload = resolveSpell(evaluation('matched'), { triangle: 'spell.custom' });

    expect(payload?.spellId).toBe('spell.custom');
    expect(resolveSpell(evaluation('matched'), {})).toBeUndefined();
  });

  it('provides frontend spell names and rune interpretations', () => {
    const definition = spellDefinitionFor(DEFAULT_SPELL_BINDINGS.triangle);

    expect(definition).toEqual(DEFAULT_SPELL_DEFINITIONS[0]);
    expect(definition?.name).toBe('Fireball');
    expect(definition?.runeInterpretation).toContain('attack');
    expect(DEFAULT_SPELL_BINDINGS.hourglass).toBe('rune.hourglass');
    expect(DEFAULT_SPELL_BINDINGS.square).toBe('rune.square');
    expect(DEFAULT_SPELL_BINDINGS.line).toBe('rune.line');
    expect(spellDefinitionFor('spell.unknown')).toBeUndefined();
  });

  it('clamps confidence to the backend-safe range', () => {
    expect(resolveSpell(evaluation('matched', 2))?.confidence).toBe(1);
    expect(resolveSpell(evaluation('matched', -1))?.confidence).toBe(0);
  });
});
