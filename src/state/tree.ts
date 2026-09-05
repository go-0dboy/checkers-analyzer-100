/* ============================================================
 * Дерево партии: основная линия + варианты (ветвления),
 * комментарии и оценки ходов (NAG) — модель данных PDN 3.0.
 * ============================================================ */

import { applyMove, generateMoves, type Move, type Pos } from '../engine/core';

export interface TreeNode {
  id: string;
  /** null у корня (стартовая позиция) */
  move: Move | null;
  comment: string;
  /** NAG: 1='!' 2='?' 3='!!' 4='??' 5='!?' 6='?!' */
  nags: number[];
  /** [0] — основная линия, остальные — варианты */
  children: TreeNode[];
  parent: TreeNode | null;
}

export const NAG_SYMBOLS: Record<number, string> = {
  1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!',
};

let seq = 0;
const genId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function createNode(move: Move | null, parent: TreeNode | null): TreeNode {
  return { id: genId(), move, comment: '', nags: [], children: [], parent };
}

export function rootTree(): TreeNode {
  return createNode(null, null);
}

/** Путь от корня до узла (включая корень). */
export function pathTo(node: TreeNode): TreeNode[] {
  const arr: TreeNode[] = [];
  let cur: TreeNode | null = node;
  while (cur) { arr.unshift(cur); cur = cur.parent; }
  return arr;
}

/** Нотация хода узла: 32-28 / 28x19 + символы NAG. */
export function nodeSan(n: TreeNode): string {
  if (!n.move) return '';
  const s = `${n.move.from}${n.move.captures.length > 0 ? 'x' : '-'}${n.move.to}`;
  return s + n.nags.map((g) => NAG_SYMBOLS[g] ?? '').join('');
}

/** Позиции вдоль пути: [start, pos1, ...] (по числу узлов в пути). */
export function pathPositions(start: Pos, path: TreeNode[]): Pos[] {
  const res: Pos[] = [start];
  for (let i = 1; i < path.length; i++) {
    const mv = path[i].move;
    if (!mv) { res.push(res[res.length - 1]); continue; }
    const cur = res[res.length - 1];
    const legal = generateMoves(cur);
    const found = legal.find((l) => l.from === mv.from && l.to === mv.to) ?? mv;
    res.push(applyMove(cur, found));
  }
  return res;
}

/** Число полуходов основной линии. */
export function mainlineLength(root: TreeNode): number {
  let n = root; let c = 0;
  while (n.children.length > 0) { n = n.children[0]; c++; }
  return c;
}

/* ---------- сериализация (для IndexedDB) ---------- */

interface NodeData {
  id: string;
  move: Move | null;
  comment: string;
  nags: number[];
  children: NodeData[];
}

const strip = (n: TreeNode): NodeData => ({
  id: n.id,
  move: n.move,
  comment: n.comment,
  nags: n.nags,
  children: n.children.map(strip),
});

export function serializeTree(root: TreeNode): string {
  return JSON.stringify(strip(root));
}

export function deserializeTree(json: string): TreeNode | null {
  try {
    const build = (d: NodeData, parent: TreeNode | null): TreeNode => {
      const n: TreeNode = {
        id: d.id || genId(),
        move: d.move ?? null,
        comment: d.comment ?? '',
        nags: Array.isArray(d.nags) ? d.nags : [],
        children: [],
        parent,
      };
      n.children = (d.children ?? []).map((c) => build(c, n));
      return n;
    };
    return build(JSON.parse(json) as NodeData, null);
  } catch {
    return null;
  }
}
