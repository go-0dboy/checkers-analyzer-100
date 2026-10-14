/** Fixed-depth, alternating cold-TT comparison; includes event-loop yields in elapsed time. */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const baselineIndex = process.argv.indexOf('--baseline');
const baselineRef = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : null;
if (!baselineRef) throw new Error('Usage: npm run benchmark:search -- --baseline <git-ref>');
const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'checkers-benchmark-'));
const cases = [
  ['opening', 'W:W31-50:B1-20', 6],
  [
    'middle',
    'W:W26,27,28,32,33,34,37,38,39,41,42,43,46,47,48:B3,4,5,8,9,10,12,13,14,16,17,18,19,23,24',
    6,
  ],
  ['ending', 'W:WK46,32:BK5,19', 6],
  ['capture', 'W:WK17:B9,20,21,28,30', 4],
];
try {
  for (const file of ['core.ts', 'draw.ts', 'search.ts']) {
    const target = join(temp, 'baseline', file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      execFileSync('git', ['show', `${baselineRef}:src/engine/${file}`], { cwd: root }),
    );
  }
  const load = async (entry, name) => {
    const outfile = join(temp, name + '.mjs');
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile });
    return import(pathToFileURL(outfile).href);
  };
  const before = await load(join(temp, 'baseline/search.ts'), 'before');
  const after = await load(join(root, 'src/engine/search.ts'), 'after');
  const { parseFen, moveKey } = await load(join(root, 'src/engine/core.ts'), 'core');
  const samples = { before: {}, after: {} },
    signatures = {};
  for (let round = 0; round < 8; round++) {
    const order =
      round % 2
        ? [
            ['after', after],
            ['before', before],
          ]
        : [
            ['before', before],
            ['after', after],
          ];
    for (const [label, mod] of order)
      for (const [name, fen, maxDepth] of cases) {
        mod.clearSearch();
        const start = performance.now();
        const result = await mod.analyze(parseFen(fen), { timeMs: 60000, maxDepth }, () => {}, {
          cancelled: false,
        });
        const ms = performance.now() - start;
        const signature = JSON.stringify({
          best: result.best && moveKey(result.best),
          score: result.score,
          depth: result.depth,
          candidates: result.candidates.map((c) => [moveKey(c.move), c.score]),
        });
        if (signatures[name] && signatures[name] !== signature)
          throw new Error(`Different result: ${name}, ${label}`);
        signatures[name] = signature;
        if (round >= 2) (samples[label][name] ??= []).push({ ms, nodes: result.nodes });
      }
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(
    JSON.stringify(
      {
        baselineRef,
        node: process.version,
        rounds: 6,
        results: cases.map(([name, fen, depth]) => {
          const beforeMs = median(samples.before[name].map((s) => s.ms));
          const afterMs = median(samples.after[name].map((s) => s.ms));
          return {
            name,
            fen,
            depth,
            beforeMs,
            afterMs,
            timeReductionPercent: 100 * (1 - afterMs / beforeMs),
            beforeNodes: samples.before[name][0].nodes,
            afterNodes: samples.after[name][0].nodes,
          };
        }),
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
