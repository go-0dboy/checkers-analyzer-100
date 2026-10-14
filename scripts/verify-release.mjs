/** Prevent neural training code or legacy model loading from entering the release. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const assets = new URL('../dist/assets/', import.meta.url);
for (const file of readdirSync(assets)) {
  if (/^(nn|train\.worker)/.test(file)) throw new Error(`Unexpected neural asset: ${file}`);
  if (!file.endsWith('.js')) continue;
  const source = readFileSync(new URL(file, assets), 'utf8');
  if (/NNUE|nnEnabled|nnBlend|trainOnPDN|sk100\.net\./.test(source))
    throw new Error(`Neural code in release: ${file}`);
}
for (const file of ['nn.ts', 'nntrain.ts', 'train.worker.ts']) {
  if (readdirSync(new URL('../src/engine/', import.meta.url)).includes(file))
    throw new Error(`Unexpected neural source: ${join('src/engine', file)}`);
}
console.log('Release assets contain no neural model or training code');
