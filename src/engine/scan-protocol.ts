/** Scan 3.1 Hub protocol; capture suffix lists victims, NOT landing squares. */
import { applyMove, findMove, generateMoves, type Pos, type Move } from './core';
export function hubPosition(pos: Pos): string {
  let text = pos.side === 1 ? 'W' : 'B';
  for (let n = 1; n <= 50; n++)
    text += ({ '1': 'w', '2': 'W', '-1': 'b', '-2': 'B', '0': 'e' } as Record<string, string>)[
      pos.b[n]
    ];
  return text;
}
export function hubMove(move: Move): string {
  return `${move.from}${move.captures.length ? 'x' : '-'}${move.to}${move.captures.map((n) => `x${n}`).join('')}`;
}
export function hubPairs(line: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const m of line.matchAll(/([\w-]+)=(?:"([^"\\]*(?:\\.[^"\\]*)*)"|(\S+))/g))
    pairs[m[1]] = m[2] ?? m[3];
  return pairs;
}
export function parseHubMove(text: string, pos: Pos): Move | null {
  if (!/^\d{1,2}(?:-\d{1,2}|x\d{1,2}(?:x\d{1,2})+)$/.test(text)) return null;
  const nums = text.split(/[x-]/).map(Number);
  return findMove(generateMoves(pos), nums[0], nums[1], undefined, nums.slice(2)) ?? null;
}
export function parseHubPV(text: string, pos: Pos): Move[] {
  const moves: Move[] = [];
  for (const token of text.split(/\s+/)) {
    const move = parseHubMove(token, pos);
    if (!move) break;
    moves.push(move);
    pos = applyMove(pos, move);
  }
  return moves;
}
