import { it, expect } from 'vitest';
import { initialDraw, advanceDraw, drawReason, endingLimit, drawKey } from '../src/engine/draw';
import { applyMove, generateMoves, parseFen, boardToFen } from '../src/engine/core';
it('recognises third occurrence with same side', () => {
  const p = parseFen('W:WK46:BK5')!,
    d = initialDraw(p);
  d.repetitions.set(boardToFen(p.b, p.side), 3);
  expect(drawReason(p, d)).toMatch(/повторение/);
  expect(drawReason({ ...p, side: -1 }, d)).toBeNull();
});
it('recognises 25-move rule and resets after man movement', () => {
  const q = parseFen('W:W31,K32:B1,K5')!,
    d = initialDraw(q);
  d.kingOnlyPlies = 50;
  expect(drawReason(q, d)).toMatch(/25/);
  const move = generateMoves(q).find((m) => m.from === 31 && !m.captures.length)!;
  expect(advanceDraw(d, q, move, applyMove(q, move)).kingOnlyPlies).toBe(0);
});
it('uses 5/16-move limits only for specified material and counts both players', () => {
  const p = parseFen('W:WK46:BK5')!,
    d = initialDraw(p);
  expect(endingLimit(p)).toBe(5);
  d.endingWhite = 5;
  d.endingBlack = 4;
  expect(drawReason(p, d)).toBeNull();
  d.endingBlack = 5;
  expect(drawReason(p, d)).toMatch(/5 ходов/);
  expect(endingLimit(parseFen('W:WK31,K32,K46:BK5')!)).toBe(16);
  expect(endingLimit(parseFen('W:W31,32,46:BK5')!)).toBe(0);
});
it('TT context distinguishes identical boards at different draw clocks', () => {
  const p = parseFen('W:WK46:BK5')!,
    a = initialDraw(p),
    b = { ...a, kingOnlyPlies: 49 };
  expect(drawKey(a)).not.toBe(drawKey(b));
});
