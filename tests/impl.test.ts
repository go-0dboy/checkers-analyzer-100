import { it, expect } from 'vitest';
import { runDirect, type EngineResult, type GoMsg } from '../src/engine/impl';
import { applyMove, boardToFen, generateMoves, parseFen } from '../src/engine/core';
const run = (request: GoMsg): Promise<EngineResult> =>
  new Promise((resolve) =>
    runDirect(request, (m) => {
      const r = m as EngineResult;
      if (r.t === 'done') resolve(r);
    }),
  );
it('rejects an unrelated or illegal history rather than silently analysing it', async () => {
  const result = await run({
    t: 'go',
    id: 1,
    fen: 'W:WK23:BK28',
    startFen: 'W:W31-50:B1-20',
    history: [],
    timeMs: 100,
    maxDepth: 2,
  });
  expect(result.error).toMatch(/История/);
});
it('reconstructs the position from complete moves before analysis', async () => {
  const fen = 'W:W31,32:B18,19',
    start = parseFen(fen)!,
    move = generateMoves(start)[0],
    next = applyMove(start, move);
  const result = await run({
    t: 'go',
    id: 2,
    fen: boardToFen(next.b, next.side),
    startFen: fen,
    history: [move],
    timeMs: 100,
    maxDepth: 2,
  });
  expect(result.error).toBeUndefined();
  expect(result.best).not.toBeNull();
});
