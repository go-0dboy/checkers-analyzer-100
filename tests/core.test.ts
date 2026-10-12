import { describe, it, expect } from 'vitest';
import {
  parseFen,
  boardToFen,
  startBoard,
  generateMoves,
  applyMove,
  moveKey,
  findMove,
  rc,
  type Pos,
} from '../src/engine/core';
const pos = (fen: string) => parseFen(fen)!;
function perft(p: Pos, d: number): number {
  return d ? generateMoves(p).reduce((sum, m) => sum + perft(applyMove(p, m), d - 1), 0) : 1;
}
describe('FMJD move generation', () => {
  it('start has 9 moves and 81 replies', () => {
    expect(perft({ b: startBoard(), side: 1 }, 1)).toBe(9);
    expect(perft({ b: startBoard(), side: 1 }, 2)).toBe(81);
  });
  it('allows a king to cross the vacated origin and applies majority', () => {
    const p = pos('W:WK17:B9,20,21,28,30'),
      before = p.b.slice(),
      moves = generateMoves(p);
    expect(moves).toHaveLength(1);
    expect(moves[0].path).toEqual([39, 25, 14, 3, 26]);
    expect(moves[0].captures).toHaveLength(5);
    expect(p.b).toEqual(before);
    const after = applyMove(p, moves[0]);
    expect([...after.b].filter((v) => v < 0)).toHaveLength(0);
  });
  it('does not jump the same victim twice', () => {
    const p = pos('W:WK23:BK28');
    for (const m of generateMoves(p)) {
      expect(m.captures).toEqual([28]);
      expect(generateMoves(applyMove(p, m))).toHaveLength(0);
    }
  });
  it('promotes only at completion and lets men capture backward', () => {
    const p = pos('W:W12:B8,9'),
      moves = generateMoves(p);
    expect(moves.every((m) => m.captures.length === 2)).toBe(true);
    for (const m of moves) {
      expect(m.king).toBe(false);
      expect(rc(m.to)[0]).not.toBe(0);
      expect(applyMove(p, m).b[m.to]).toBe(1);
    }
    const p2 = pos('W:W7:B');
    const promotion = generateMoves(p2).find((m) => rc(m.to)[0] === 0)!;
    expect(applyMove(p2, promotion).b[promotion.to]).toBe(2);
  });
  it('preserves the full move identity', () => {
    const m = generateMoves(pos('W:WK23:BK28'))[0];
    expect(findMove([m], m.from, m.to, m.path, m.captures)).toEqual(m);
    const other = { ...m, captures: [29] };
    expect(moveKey(other)).not.toBe(moveKey(m));
    expect(findMove([m, other], m.from, m.to)).toBeUndefined();
  });
});
describe('FEN', () => {
  it.each([
    'garbage:W31:B1',
    'W:W1-2-3:B50',
    'W:W0:B',
    'W:W51:B',
    'W:W2-1:B',
    'W:W1:B1',
    'W:W1,:B',
    'W:W1:W2',
  ])('rejects %s', (text) => expect(parseFen(text)).toBeNull());
  it('roundtrips sparse men, kings, colors and turn', () => {
    const p = pos('B:W1,3,K20:B4,K50');
    expect(parseFen(boardToFen(p.b, p.side))).toEqual(p);
    expect(boardToFen(startBoard())).toBe('W:W31-50:B1-20');
  });
});
