/** Build CI: verify bundled Scan resources against recorded checksums. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sums = JSON.parse(
  readFileSync(new URL('../public/scan/checksums.json', import.meta.url), 'utf8'),
);
for (const [name, expected] of Object.entries(sums)) {
  const actual = createHash('sha256')
    .update(readFileSync(new URL(`../public/scan/${name}`, import.meta.url)))
    .digest('hex');
  if (actual !== expected) throw new Error(`Scan checksum mismatch: ${name}`);
}
console.log('Scan resource checksums OK');
