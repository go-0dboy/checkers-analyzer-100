/* ============================================================
 * Дебютная книга: мгновенный «человеческий» ответ по теории.
 * Хранится как префиксное дерево (trie) легальных последовательностей
 * ходов от начальной расстановки.
 * ============================================================ */

import { applyMove, findMove, generateMoves, startBoard, WHITE, type Pos } from './core';

export interface BookHit { name: string; from: number; to: number }

export const START_FEN = 'W:W31-50:B1-20';

interface Node { next: Map<number, Node>; move: BookHit | null }

/* Проверенные легальные начальные последовательности */
const LINES: [string, string][] = [
  ['Классическое начало', '32-28 19-23 28x19 14x23 37-32 10-14 41-37 5-10 46-41 14-19 34-29 23x34 40x29'],
  ['Отказанный косяк', '32-28 18-23 37-32 12-18 41-37 7-12 46-41 1-7 34-29 23x34 40x29'],
  ['Городская партия', '32-28 18-22 37-32 12-18 41-37 7-12 46-41 20-24 34-30 24-29'],
  ['Старая партия', '32-28 18-23 34-29 23x34 40x29 12-18 37-32 7-12'],
  ['Обратный косяк', '34-30 19-23 30-25 23-28 33x22 17x28 32x23 18x29 39-33'],
];

const root: Node = { next: new Map(), move: null };

function ins(path: number[], move: BookHit): void {
  let node = root;
  for (const code of path) {
    let nx = node.next.get(code);
    if (!nx) { nx = { next: new Map(), move: null }; node.next.set(code, nx); }
    node = nx;
  }
  if (!node.move) node.move = move;
}

for (const [name, line] of LINES) {
  let pos: Pos = { b: startBoard(), side: WHITE };
  const path: number[] = [];
  for (const tok of line.split(/\s+/)) {
    const m = /^(\d{1,2})([x×X-])(\d{1,2})$/.exec(tok);
    if (!m) break;
    const from = Number(m[1]); const to = Number(m[3]);
    const mv = findMove(generateMoves(pos), from, to);
    if (!mv) break;
    ins(path, { name, from, to });
    path.push(from * 100 + to);
    pos = applyMove(pos, mv);
  }
}

/** Возвращает рекомендованный ход, если история партии полностью лежит в книге. */
export function bookLookup(history: number[]): BookHit | null {
  let node = root;
  for (const code of history) {
    const nx = node.next.get(code);
    if (!nx) return null;
    node = nx;
  }
  return node.move;
}
