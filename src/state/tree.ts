/* ============================================================
 * Дерево партии: основная линия + варианты (ветвления),
 * комментарии и оценки ходов (NAG) — модель данных PDN 3.0.
 * ============================================================ */

import {
  applyMove,
  generateMoves,
  sameMove,
  isMove,
  moveNotation,
  type Move,
  type Pos,
} from '../engine/core';

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

// Shared by import, storage and the interactive editor.
export const MAX_TREE_DEPTH = 500;
export const MAX_TREE_NODES = 10000;

export const NAG_SYMBOLS: Record<number, string> = {
  1: '!',
  2: '?',
  3: '!!',
  4: '??',
  5: '!?',
  6: '?!',
};

let seq = 0;
const genId = () =>
  `n${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
  while (cur) {
    arr.push(cur);
    cur = cur.parent;
  }
  return arr.reverse();
}

/** Нотация хода узла: 32-28 / 28x19 + символы NAG. */
export function nodeSan(n: TreeNode): string {
  if (!n.move) return '';
  const s = moveNotation(n.move);
  return s + n.nags.map((g) => NAG_SYMBOLS[g] ?? '').join('');
}

/** Позиции вдоль пути: [start, pos1, ...] (по числу узлов в пути). */
export function pathPositions(start: Pos, path: TreeNode[], cache?: WeakMap<TreeNode, Pos>): Pos[] {
  const res: Pos[] = [start];
  for (let i = 1; i < path.length; i++) {
    const cached = cache?.get(path[i]);
    if (cached) {
      res.push(cached);
      continue;
    }
    const mv = path[i].move;
    if (!mv) {
      res.push(res[res.length - 1]);
      continue;
    }
    const cur = res[res.length - 1];
    const legal = generateMoves(cur);
    const found = legal.find((l) => sameMove(l, mv));
    if (!found) throw new Error(`Нелегальный ход в дереве: ${moveNotation(mv)}`);
    const after = applyMove(cur, found);
    cache?.set(path[i], after);
    res.push(after);
  }
  return res;
}

/** Число полуходов основной линии. */
export function mainlineLength(root: TreeNode): number {
  let n = root;
  let c = 0;
  while (n.children.length > 0) {
    n = n.children[0];
    c++;
  }
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
    const ids = new Set<string>();
    let count = 0;
    const build = (d: NodeData, parent: TreeNode | null, depth = 0): TreeNode => {
      if (
        !d ||
        typeof d !== 'object' ||
        depth > MAX_TREE_DEPTH ||
        ++count > MAX_TREE_NODES ||
        !Array.isArray(d.children) ||
        (parent ? !isMove(d.move) : d.move !== null) ||
        (d.comment !== undefined && typeof d.comment !== 'string') ||
        (d.nags !== undefined &&
          (!Array.isArray(d.nags) || !d.nags.every((n) => Number.isInteger(n) && n >= 1 && n <= 6)))
      )
        throw new Error('Повреждённое дерево');
      const n: TreeNode = {
        id: d.id || genId(),
        move: d.move ?? null,
        comment: d.comment ?? '',
        nags: Array.isArray(d.nags) ? d.nags : [],
        children: [],
        parent,
      };
      if (ids.has(n.id)) throw new Error('Повторный ID узла');
      ids.add(n.id);
      n.children = d.children.map((c) => build(c, n, depth + 1));
      return n;
    };
    return build(JSON.parse(json) as NodeData, null);
  } catch {
    return null;
  }
}

/** Stored paths exclude the root and must form a connected chain. */
export function resolvePath(root: TreeNode, ids: string[]): TreeNode[] {
  const nodes = [root];
  let cur = root;
  for (const id of ids) {
    const next = cur.children.find((n) => n.id === id);
    if (!next) break;
    nodes.push(next);
    cur = next;
  }
  return nodes;
}

export function validateTree(start: Pos, root: TreeNode): boolean {
  const visit = (pos: Pos, n: TreeNode): boolean => {
    const legal = generateMoves(pos);
    return n.children.every((child) => {
      const move = child.move && legal.find((m) => sameMove(m, child.move!));
      return !!move && visit(applyMove(pos, move), child);
    });
  };
  try {
    return visit(start, root);
  } catch {
    return false;
  }
}
