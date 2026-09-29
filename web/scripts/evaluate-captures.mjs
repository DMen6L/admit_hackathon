import fs from 'node:fs/promises';
import path from 'node:path';
import { rolldown } from 'rolldown';

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: npm run evaluate -- path/to/capture-or-manifest.json');
  console.error('Keep a space after -- so npm passes the path to this script.');
  process.exit(2);
}

const input = JSON.parse(await fs.readFile(inputFile, 'utf8'));

// Bundle the exact TypeScript modules used by the browser without starting a server.
const bundle = await rolldown({ input: new URL('../src/debug/evaluation-entry.ts', import.meta.url).pathname });
const generated = await bundle.generate({ format: 'esm' });
await bundle.close();
const code = generated.output.find((output) => output.type === 'chunk')?.code;
if (!code) throw new Error('Recognition bundle was empty');
const { replayCapture, ShapeEvaluator, DEFAULT_SHAPE_TEMPLATES, parseCapture } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const evaluator = new ShapeEvaluator(DEFAULT_SHAPE_TEMPLATES);

if (input.schemaVersion === 1 && Array.isArray(input.frames)) {
  const capture = parseCapture(input);
  const replayed = replayCapture(capture, evaluator);
  console.log(JSON.stringify({ type: 'capture', file: inputFile,
    dimensions: `${capture.width}x${capture.height}`, frames: capture.frames.length,
    durationMs: Math.round(capture.frames.at(-1)?.elapsedMs ?? 0),
    recordedCasts: capture.casts.length, replayedCasts: replayed.length }));
  for (let index = 0; index < Math.max(capture.casts.length, replayed.length); index += 1) {
    const recorded = capture.casts[index];
    const current = replayed[index];
    const summarize = (evaluation) => evaluation && ({ status: evaluation.status,
      shape: evaluation.templateId ?? null, score: Math.round(evaluation.score * 100) / 100,
      correction: evaluation.correction ?? null });
    console.log(JSON.stringify({ type: 'cast', number: index + 1,
      elapsedMs: recorded?.elapsedMs ?? null,
      recorded: summarize(recorded?.evaluation),
      replayed: summarize(current?.evaluation),
      candidates: current?.evaluation.candidates?.map((candidate) => ({
        shape: candidate.templateId, score: Math.round(candidate.score * 100) / 100,
        evidence: candidate.evidence, outlineError: candidate.outlineError,
        ...(candidate.triangleFitError === undefined ? {} : { triangleFitError: candidate.triangleFitError }),
        failed: candidate.failed,
      })) ?? [],
    }));
  }
  console.log('A single capture has no ground-truth labels, so these results do not measure accuracy.');
  process.exit(0);
}

const manifest = input;
if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
  throw new Error('Input must be a capture JSON or a manifest with a nonempty cases array');
}
const people = new Map();
for (const item of manifest.cases) {
  if (typeof item.file !== 'string' || typeof item.person !== 'string'
    || !['train', 'test'].includes(item.split)
    || !(item.expected === null || ['triangle', 'circle', 'zigzag'].includes(item.expected))) {
    throw new Error('Every case needs file, person, train/test split, and expected shape ID or null');
  }
  const prior = people.get(item.person);
  if (prior && prior !== item.split) throw new Error(`Person ${item.person} appears in both splits`);
  people.set(item.person, item.split);
}
const rows = [];
for (const item of manifest.cases) {
  const capture = parseCapture(JSON.parse(await fs.readFile(path.resolve(path.dirname(inputFile), item.file), 'utf8')));
  const casts = replayCapture(capture, evaluator);
  const matches = casts.filter((cast) => cast.evaluation.status === 'matched').map((cast) => cast.evaluation.templateId);
  const predicted = casts.length === 1 && casts[0].evaluation.status === 'matched'
    ? casts[0].evaluation.templateId : null;
  const correct = item.expected === null
    ? matches.length === 0
    : predicted === item.expected;
  rows.push({ file: item.file, person: item.person, split: item.split,
    scenario: item.scenario ?? 'unspecified', expected: item.expected, predicted,
    casts: casts.length, matches, correct });
}

for (const row of rows) console.log(JSON.stringify(row));
for (const split of ['train', 'test']) {
  const subset = rows.filter((row) => row.split === split);
  if (!subset.length) continue;
  const positives = subset.filter((row) => row.expected !== null);
  const negatives = subset.filter((row) => row.expected === null);
  console.log(JSON.stringify({ split, cases: subset.length,
    exactAccuracy: subset.filter((row) => row.correct).length / subset.length,
    validShapeRecall: positives.length ? positives.filter((row) => row.correct).length / positives.length : null,
    falseCastRate: negatives.length ? negatives.filter((row) => row.matches.length > 0).length / negatives.length : null }));
}
for (const scenario of [...new Set(rows.map((row) => row.scenario))]) {
  const subset = rows.filter((row) => row.scenario === scenario);
  console.log(JSON.stringify({ scenario, cases: subset.length,
    exactAccuracy: subset.filter((row) => row.correct).length / subset.length }));
}
