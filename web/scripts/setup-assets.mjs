import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const modelDirectory = new URL('public/models/', root);
const modelFile = new URL('hand_landmarker.task', modelDirectory);
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const modelSha256 = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';

await mkdir(modelDirectory, { recursive: true });
await cp(
  fileURLToPath(new URL('node_modules/@mediapipe/tasks-vision/wasm/', root)),
  fileURLToPath(new URL('public/wasm/', root)),
  { recursive: true },
);
console.log('Copied the WebAssembly runtime from the installed MediaPipe package.');

// Validate the pinned model, including cached copies and incomplete downloads.
function isModelBundle(buffer) {
  return createHash('sha256').update(buffer).digest('hex') === modelSha256;
}

let existing;
try {
  existing = await readFile(modelFile);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (existing && isModelBundle(existing)) {
  console.log('The hand model is already downloaded.');
} else {
  console.log('Downloading the official hand landmarker model (version 1)…');
  const response = await fetch(modelUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  const model = Buffer.from(await response.arrayBuffer());
  if (!isModelBundle(model)) throw new Error('The hand model checksum did not match the expected version.');

  const temporaryFile = new URL('hand_landmarker.task.download', modelDirectory);
  await writeFile(temporaryFile, model);
  await rename(temporaryFile, modelFile);
  console.log(`Saved hand_landmarker.task (${(model.length / 1024 / 1024).toFixed(1)} MB).`);
}
