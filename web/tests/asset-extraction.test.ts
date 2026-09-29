import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { frameGroups, extractArena } from '../scripts/extract-game-assets.mjs';

const design = new URL('../public/assets/design/', import.meta.url);

describe('source artwork extraction', () => {
  it('extracts every fireball, shield, and lightning frame without board labels', async () => {
    const source = await readFile(new URL('wizard-duel-vfx-library.svg', design), 'utf8');
    for (const [y, scale, count, x] of [[214, 2.2, 8, 154], [464, 2.1, 6, 142], [738, 2.4, 6, 134]]) {
      const frames = frameGroups(source, y, scale, count, x, 250);
      expect(frames).toHaveLength(count);
      frames.forEach((frame) => expect(frame).not.toMatch(/<text|#111C2B/));
    }
  });
  it('isolates all six character strips without board labels or tile backgrounds', async () => {
    const source = await readFile(new URL('wizard-duel-animation-implementation.svg', design), 'utf8');
    for (const y of [226, 450, 674, 952, 1176, 1400]) {
      const frames = frameGroups(source, y, 1.65, 6);
      expect(frames).toHaveLength(6);
      for (const frame of frames) {
        expect(frame).toContain('<rect');
        expect(frame).not.toMatch(/<text|#111C2B|translate\(/);
      }
    }
    expect(new Set(frameGroups(source, 226, 1.65, 6)).size).toBe(1);
    expect(new Set(frameGroups(source, 450, 1.65, 6)).size).toBeGreaterThan(1);
  });
  it('rejects source changes rather than returning partial frames', () => {
    expect(() => frameGroups('<svg/>', 226, 1.65, 6)).toThrow('Expected one frame');
    expect(() => extractArena('<svg/>')).toThrow('Arena boundaries changed');
  });
  it('preserves arena gradient definitions and excludes baked-in characters', async () => {
    const source = await readFile(new URL('duel_file.svg', design), 'utf8');
    const arena = extractArena(source);
    expect(arena).toContain('viewBox="70 208 1460 476"');
    expect(arena).toContain('id="paint0_linear_9_2"');
    expect(arena).toContain('id="paint1_linear_9_2"');
    expect(arena).not.toContain('M334 486H276');
    expect(arena).not.toContain('clip-path');
    expect((arena.match(/<g\b/g) ?? []).length).toBe((arena.match(/<\/g>/g) ?? []).length);
  });
});
