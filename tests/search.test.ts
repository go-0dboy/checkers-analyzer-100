import { it, expect, beforeEach } from 'vitest';
import { analyze, clearSearch, evaluate } from '../src/engine/search';
import { applyMove, generateMoves, parseFen, moveKey } from '../src/engine/core';
import { materialInfo, materialVerdict } from '../src/engine/tablebase';
beforeEach(clearSearch);
const search = (fen: string, depth = 2, options = {}) =>
  analyze(parseFen(fen)!, { timeMs: 5000, maxDepth: depth, ...options }, () => {}, {
    cancelled: false,
  });
it('finds forced loss through compulsory captures instead of standing pat', async () => {
  const result = await search('W:WK20:B8,35,38,47', 1);
  expect(result.score).toBeLessThan(-999000);
  expect(result.mate).toBe(true);
});
it('finds immediate win and material hints do not declare a draw', async () => {
  const fen = 'W:WK23:BK28',
    p = parseFen(fen)!;
  expect(materialVerdict(materialInfo(p.b))).toBeNull();
  const r = await search(fen);
  expect(r.score).toBeGreaterThan(999000);
  expect(r.best?.captures).toEqual([28]);
});
it('reported PV follows the selected full move and is legal', async () => {
  const p = parseFen('W:W31,32,33:B18,19,20')!,
    r = await search('W:W31,32,33:B18,19,20', 3, { humanStyle: true });
  expect(moveKey(r.pv[0])).toBe(moveKey(r.best!));
  let current = p;
  for (const m of r.pv) {
    expect(generateMoves(current).some((legal) => moveKey(legal) === moveKey(m))).toBe(true);
    current = applyMove(current, m);
  }
});
it('candidate scores equal independent full-window root searches', async () => {
  const fen = 'W:W31,32:B18,19',
    p = parseFen(fen)!,
    r = await search(fen, 2);
  for (const candidate of r.candidates) {
    clearSearch();
    const child = applyMove(p, candidate.move);
    const reply = await analyze(child, { timeMs: 5000, maxDepth: 1 }, () => {}, {
      cancelled: false,
    });
    expect(candidate.score).toBe(-reply.score);
  }
});
it('always returns legal fallback under a tiny time limit', async () => {
  const r = await search('W:W31-50:B1-20', 40, { timeMs: 1 });
  expect(r.best).not.toBeNull();
});
it('does not emit progress after cancellation', async () => {
  const token = { cancelled: true };
  let progress = 0;
  await analyze(
    parseFen('W:W31-50:B1-20')!,
    { timeMs: 1000, maxDepth: 8 },
    () => progress++,
    token,
  );
  expect(progress).toBe(0);
});

it('search recognises the real repetition context', async () => {
  const { initialDraw } = await import('../src/engine/draw');
  const { boardToFen } = await import('../src/engine/core');
  const pos = parseFen('W:WK46:BK5')!;
  const draw = initialDraw(pos);
  draw.repetitions.set(boardToFen(pos.b, pos.side), 3);
  const result = await analyze(pos, { timeMs: 1000, maxDepth: 3, draw }, () => {}, {
    cancelled: false,
  });
  expect(result.draw).toMatch(/повторение/);
  expect(result.best).toBeNull();
  expect(result.score).toBe(0);
});
it('absence of legal moves takes priority over draw clocks', async () => {
  const { initialDraw } = await import('../src/engine/draw');
  const pos = parseFen('B:WK23:B')!;
  const draw = initialDraw(pos);
  draw.kingOnlyPlies = 50;
  const result = await analyze(pos, { timeMs: 1000, maxDepth: 3, draw }, () => {}, {
    cancelled: false,
  });
  expect(result.score).toBe(-1000000);
  expect(result.mate).toBe(true);
});

it('warm transposition bounds agree with a fresh complete search', async () => {
  const fen = 'W:W31,32,33:B18,19,20';
  await search(fen, 3);
  const warm = await search(fen, 4);
  clearSearch();
  const cold = await search(fen, 4);
  const signature = (r: typeof cold) => ({
    best: moveKey(r.best!),
    score: r.score,
    candidates: r.candidates.map((c) => [moveKey(c.move), c.score]),
  });
  expect(signature(warm)).toEqual(signature(cold));
});

it('mirrors the evaluation after rotating the board and exchanging colours', () => {
  for (let white = 1; white <= 50; white++) {
    const black = white === 30 ? 31 : 30;
    const board = parseFen(`W:W${white}:B${black}`)!.b;
    const mirrored = new Int8Array(51);
    for (let n = 1; n <= 50; n++) mirrored[51 - n] = -board[n];
    expect(evaluate(mirrored) + evaluate(board)).toBe(0);
  }
});
