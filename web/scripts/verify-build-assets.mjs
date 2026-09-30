import { stat } from 'node:fs/promises';

const requiredFiles = [
  'dist/wasm/vision_wasm_internal.js',
  'dist/wasm/vision_wasm_internal.wasm',
  'dist/models/hand_landmarker.task',
];

for (const file of requiredFiles) {
  try {
    const info = await stat(new URL(`../${file}`, import.meta.url));
    if (!info.isFile() || info.size === 0) throw new Error('empty file');
  } catch (error) {
    throw new Error(`Required production asset is missing: ${file}`, { cause: error });
  }
}

console.log(`Verified ${requiredFiles.length} production hand-tracking assets.`);
