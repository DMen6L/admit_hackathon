import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const webRoot = new URL('../', import.meta.url);
const designRoot = new URL('public/assets/design/', webRoot);
const outputRoot = new URL('public/assets/game/', webRoot);

// These selectors intentionally describe these boards, not arbitrary SVG files.
// Fail on changed structure rather than silently exporting the wrong artwork.
export function frameGroups(source, y, scale, count, firstX = 115, step = 200) {
  return Array.from({ length: count }, (_, index) => {
    const transform = `translate(${firstX + step * index},${y}) scale(${scale})`;
    const marker = `<g transform="${transform}">`;
    if (source.split(marker).length !== 2) throw new Error(`Expected one frame: ${transform}`);
    const body = source.split(marker)[1].split('</g>')[0];
    if (/<g\b|<text\b|<script\b/.test(body)) throw new Error(`Unexpected frame structure: ${transform}`);
    return body.trim();
  });
}

function svg(body, viewBox, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox[2]}" height="${viewBox[3]}" viewBox="${viewBox.join(' ')}" shape-rendering="crispEdges" role="img"><title>${label}</title>\n${body}\n</svg>\n`;
}

export function extractArena(source) {
  const start = '<g clip-path="url(#clip0_9_2)">';
  const end = '<path d="M334 486H276V504H334V486Z"';
  if (source.split(start).length !== 2 || source.split(end).length !== 2) {
    throw new Error('Arena boundaries changed; review the duel board selectors.');
  }
  const body = source.split(start)[1].split(end)[0];
  const gradients = [...source.matchAll(/<linearGradient\b[^>]*>[\s\S]*?<\/linearGradient>/g)].map(([value]) => value);
  if (gradients.length !== 2 || !body.includes('paint1_linear_9_2')) throw new Error('Arena gradient structure changed.');
  return svg(`<defs>${gradients.join('\n')}</defs>\n${body}`, [70, 208, 1460, 476], 'Moonlit duel arena');
}

export async function extractAssets() {
  const board = await readFile(new URL('wizard-duel-animation-implementation.svg', designRoot), 'utf8');
  const duel = await readFile(new URL('duel_file.svg', designRoot), 'utf8');
  const vfx = await readFile(new URL('wizard-duel-vfx-library.svg', designRoot), 'utf8');
  const clips = [];
  const files = [];
  const characters = [
    { id: 'berik', rows: [226, 450, 674], durations: [120, 80, 60], spawn: 3 },
    { id: 'alisher', rows: [952, 1176, 1400], durations: [110, 70, 50], spawn: 2 },
  ];
  for (const character of characters) {
    for (const [index, state] of ['idle', 'cast', 'dodge'].entries()) {
      const bodies = frameGroups(board, character.rows[index], 1.65, 6);
      const frames = bodies.map((body, frame) => {
        const path = `${character.id}/${state}-${String(frame + 1).padStart(2, '0')}.svg`;
        // Original feet end at y=70 and body is centered near x=20.
        // Padding preserves the widest casting glyph; all frames share a pivot.
        files.push([path, svg(`<g transform="translate(12,20)">${body}</g>`, [0, 0, 80, 96], `${character.id} ${state} frame ${frame + 1}`)]);
        return { path, durationMs: character.durations[index] };
      });
      clips.push({
        id: `${character.id}-${state}`, character: character.id, state,
        width: 80, height: 96, pivot: { x: 32, y: 90 },
        loop: state === 'idle', uniquePoses: new Set(bodies).size, frames,
        events: state === 'cast' ? [{ frame: character.spawn, name: 'projectile-release' }]
          : state === 'dodge' ? [{ frame: 1, name: 'invulnerability-start' }, { frame: 4, name: 'invulnerability-end' }] : [],
      });
    }
  }
  files.push(['arena.svg', extractArena(duel)]);
  const effects = [
    { id: 'fireball', y: 214, scale: 2.2, count: 8, x: 154, bounds: [-72, 0, 112, 48], pivot: { x: 92, y: 20 } },
    { id: 'shield', y: 464, scale: 2.1, count: 6, x: 142, bounds: [0, 0, 64, 64], pivot: { x: 30, y: 30 } },
    { id: 'lightning', y: 738, scale: 2.4, count: 6, x: 134, bounds: [0, 0, 64, 64], pivot: { x: 28, y: 28 } },
  ].map(({ id, y, scale, count, x, bounds, pivot }) => {
    const bodies = frameGroups(vfx, y, scale, count, x, 250);
    return {
      id, width: bounds[2], height: bounds[3], pivot,
      // VFX boards give no frame durations. 80ms is a preview choice.
      frames: bodies.map((body, index) => {
        const path = `vfx/${id}-${String(index + 1).padStart(2, '0')}.svg`;
        files.push([path, svg(body, bounds, `${id} frame ${index + 1}`)]);
        return { path, durationMs: 80 };
      }),
    };
  });
  const manifest = { version: 1, arena: 'arena.svg', clips, effects };
  // Validate all source selections before writing any output. No source file is modified.
  for (const [path, content] of files) {
    const destination = new URL(path, outputRoot);
    await mkdir(new URL('.', destination), { recursive: true });
    await writeFile(destination, content);
  }
  await writeFile(new URL('manifest.json', outputRoot), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Exported ${files.length} SVG assets and manifest.json.`);
  for (const clip of clips) console.log(`${clip.id}: ${clip.frames.length} frames, ${clip.uniquePoses} unique poses`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await extractAssets();
