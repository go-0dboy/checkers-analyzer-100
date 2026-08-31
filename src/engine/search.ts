/* ============================================================
 * СтоКлетка Engine 0.1 — альфа-бета с итеративным углублением,
 * хеш-таблицей и упорядочиванием ходов. Работает офлайн, без сервера.
 * Оценки — в сотых долях шашки (как сантипешки), с точки зрения
 * стороны, делающей ход (negamax).
 * ============================================================ */

import {
  type Pos, type Move, applyMove, generateMoves, rc,
} from './core';

export interface Candidate { move: Move; score: number }

export interface EngineOut {
  best: Move | null;
  score: number;      // с точки зрения стороны, делающей ход
  depth: number;
  nodes: number;
  candidates: Candidate[];
  pv: Move[];
  mate: boolean;
}

export interface EngineProgress {
  depth: number;
  score: number;
  nodes: number;
}

const MAN = 100;
const KING = 310;
const MATE = 1_000_000;

/* Предподсчёт свойств полей */
const CENTRAL = new Uint8Array(51);
const EDGE = new Uint8Array(51);
for (let n = 1; n <= 50; n++) {
  const [r, c] = rc(n);
  CENTRAL[n] = r >= 3 && r <= 6 && c >= 3 && c <= 6 ? 1 : 0;
  EDGE[n] = c === 0 || c === 9 ? 1 : 0;
}

/** Статическая оценка с точки зрения белых. */
export function evaluate(b: Int8Array): number {
  let s = 0;
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 0) continue;
    const [r] = rc(n);
    if (v === 1) {
      s += MAN + (9 - r) * 3 + (CENTRAL[n] ? 7 : 0) + (r === 9 ? 8 : 0) - (EDGE[n] ? 3 : 0);
    } else if (v === -1) {
      s -= MAN + r * 3 + (CENTRAL[n] ? 7 : 0) + (r === 0 ? 8 : 0) - (EDGE[n] ? 3 : 0);
    } else if (v === 2) {
      s += KING + (CENTRAL[n] ? 14 : 4);
    } else {
      s -= KING + (CENTRAL[n] ? 14 : 4);
    }
  }
  return s;
}

/* ---------------- Поиск ---------------- */

interface TTEntry { depth: number; score: number; bound: 0 | 1 | 2; best: number }

interface SState {
  nodes: number;
  deadline: number;
  tt: Map<string, TTEntry>;
}

const TIMEOUT = Symbol('timeout');

function key(b: Int8Array, side: number): string {
  let s = '';
  for (let i = 1; i <= 50; i++) s += String.fromCharCode(b[i] + 3);
  return s + (side > 0 ? 'w' : 'b');
}

function orderKey(m: Move): number {
  return m.captures.length * 1000 + (m.king ? 500 : 0);
}

function orderMoves(moves: Move[], bestCode: number): Move[] {
  return moves.slice().sort((a, b) => {
    const ak = (a.from * 100 + a.to === bestCode ? 1_000_000 : 0) + orderKey(a);
    const bk = (b.from * 100 + b.to === bestCode ? 1_000_000 : 0) + orderKey(b);
    return bk - ak;
  });
}

function negamax(pos: Pos, depth: number, alpha: number, beta: number, ply: number, st: SState): number {
  st.nodes++;
  if ((st.nodes & 2047) === 0 && performance.now() > st.deadline) throw TIMEOUT;

  const moves = generateMoves(pos);
  if (moves.length === 0) return -(MATE - ply);

  const k = key(pos.b, pos.side);
  const tt = st.tt.get(k);
  if (tt && tt.depth >= depth) {
    if (tt.bound === 0) return tt.score;
    if (tt.bound === 1 && tt.score > alpha) alpha = tt.score;
    else if (tt.bound === 2 && tt.score < beta) beta = tt.score;
    if (alpha >= beta) return tt.score;
  }

  if (depth <= 0) return pos.side * evaluate(pos.b);

  const ordered = orderMoves(moves, tt ? tt.best : -1);
  let best = -Infinity;
  let bestCode = -1;
  let bound: 0 | 1 | 2 = 2;
  for (const m of ordered) {
    const s = -negamax(applyMove(pos, m), depth - 1, -beta, -alpha, ply + 1, st);
    if (s > best) { best = s; bestCode = m.from * 100 + m.to; }
    if (s > alpha) { alpha = s; bound = 0; }
    if (alpha >= beta) { bound = 1; break; }
  }
  st.tt.set(k, { depth, score: best, bound, best: bestCode });
  if (st.tt.size > 700_000) st.tt.clear();
  return best;
}

interface RootResult {
  best: Move;
  score: number;
  candidates: Candidate[];
  pv: Move[];
}

function searchRoot(pos: Pos, depth: number, prev: Candidate[] | null, st: SState): RootResult | null {
  const moves = generateMoves(pos);
  if (moves.length === 0) return null;

  const scored = moves.map((m) => {
    const prevScore = prev
      ? prev.find((p) => p.move.from === m.from && p.move.to === m.to)?.score
      : undefined;
    return { m, s: prevScore ?? -Infinity };
  });
  scored.sort((a, b) => (b.s - a.s) || (orderKey(b.m) - orderKey(a.m)));

  const results: Candidate[] = [];
  let best: Move = scored[0].m;
  let bestScore = -Infinity;
  for (const { m } of scored) {
    const s = -negamax(applyMove(pos, m), depth - 1, -Infinity, Infinity, 1, st);
    results.push({ move: m, score: s });
    if (s > bestScore) { bestScore = s; best = m; }
  }
  results.sort((a, b) => b.score - a.score);

  // Сохраняем корневую позицию в ТТ и восстанавливаем главную линию
  st.tt.set(key(pos.b, pos.side), { depth, score: bestScore, bound: 0, best: best.from * 100 + best.to });
  const pv: Move[] = [];
  let p: Pos = pos;
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const k = key(p.b, p.side);
    if (seen.has(k)) break;
    seen.add(k);
    const e = st.tt.get(k);
    if (!e || e.best < 0) break;
    const mv = generateMoves(p).find((mm) => mm.from * 100 + mm.to === e.best);
    if (!mv) break;
    pv.push(mv);
    p = applyMove(p, mv);
  }

  return { best, score: bestScore, candidates: results, pv };
}

/** Итеративное углубление с лимитом времени; не блокирует UI между слоями. */
export async function analyze(
  pos: Pos,
  opts: { timeMs: number; maxDepth: number },
  onProgress: (p: EngineProgress) => void,
  token: { cancelled: boolean },
): Promise<EngineOut> {
  const st: SState = {
    nodes: 0,
    deadline: performance.now() + opts.timeMs,
    tt: new Map(),
  };
  const out: EngineOut = {
    best: null, score: 0, depth: 0, nodes: 0, candidates: [], pv: [], mate: false,
  };
  let prev: Candidate[] | null = null;
  for (let d = 1; d <= opts.maxDepth; d++) {
    await new Promise((r) => { setTimeout(r, 0); });
    if (token.cancelled) return out;
    let res: RootResult | null = null;
    try {
      res = searchRoot(pos, d, prev, st);
    } catch (e) {
      if (e === TIMEOUT) break;
      throw e;
    }
    if (!res) break;
    prev = res.candidates;
    out.best = res.best;
    out.score = res.score;
    out.depth = d;
    out.nodes = st.nodes;
    out.candidates = res.candidates.slice(0, 5);
    out.pv = res.pv;
    out.mate = Math.abs(res.score) > MATE - 1000;
    onProgress({ depth: d, score: res.score, nodes: st.nodes });
    if (out.mate) break;
    if (performance.now() > st.deadline) break;
  }
  return out;
}
