/* ============================================================
 * Поисковое ядро: альфа-бета с итеративным углублением,
 * хеш-таблицей, MVV-LVA + killers, quiescence-поиск взятий.
 * Оценки — в сотых долях шашки, negamax (от стороны хода).
 * ============================================================ */

import { type Pos, type Move, applyMove, generateMoves, rc, sq } from './core';

export interface Candidate { move: Move; score: number }

export interface EngineOut {
  best: Move | null;
  score: number;
  depth: number;
  nodes: number;
  candidates: Candidate[];
  pv: Move[];
  mate: boolean;
}

export interface EngineProgress { depth: number; score: number; nodes: number }

const MAN = 100;
const KING = 315;
const MATE = 1_000_000;

const CENTRAL = new Uint8Array(51);
const EDGE = new Uint8Array(51);
const ROW = new Int8Array(51);
const COL = new Int8Array(51);
for (let n = 1; n <= 50; n++) {
  const [r, c] = rc(n);
  ROW[n] = r; COL[n] = c;
  CENTRAL[n] = r >= 3 && r <= 6 && c >= 3 && c <= 6 ? 1 : 0;
  EDGE[n] = c === 0 || c === 9 ? 1 : 0;
}

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

/** Статическая оценка с точки зрения белых. */
export function evaluate(b: Int8Array): number {
  let s = 0;
  let wBack = 0; let bBack = 0;
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 0) continue;
    const r = ROW[n];
    if (v === 1) {
      s += MAN + (9 - r) * 3 + (CENTRAL[n] ? 7 : 0) - (EDGE[n] ? 3 : 0);
      if (r === 9 && wBack < 4) { wBack++; s += 6; }
    } else if (v === -1) {
      s -= MAN + r * 3 + (CENTRAL[n] ? 7 : 0) - (EDGE[n] ? 3 : 0);
      if (r === 0 && bBack < 4) { bBack++; s -= 6; }
    } else if (v === 2) {
      s += KING + (CENTRAL[n] ? 14 : 4) + kingMob(b, n);
    } else {
      s -= KING + (CENTRAL[n] ? 14 : 4) + kingMob(b, n);
    }
  }
  return s;
}

function kingMob(b: Int8Array, n: number): number {
  const r = ROW[n]; const c = COL[n];
  let m = 0;
  for (const [dr, dc] of DIRS) {
    let r1 = r + dr; let c1 = c + dc;
    while (r1 >= 0 && r1 < 10 && c1 >= 0 && c1 < 10) {
      if ((r1 + c1) % 2 === 0) break;
      if (b[sq(r1, c1)] !== 0) break;
      m += 2; r1 += dr; c1 += dc;
    }
  }
  return m;
}

interface TTEntry { depth: number; score: number; bound: 0 | 1 | 2; best: number }

interface SState {
  nodes: number;
  deadline: number;
  tt: Map<string, TTEntry>;
  killers: Int32Array;
}

const TIMEOUT = Symbol('timeout');

function key(b: Int8Array, side: number): string {
  let s = '';
  for (let i = 1; i <= 50; i++) s += String.fromCharCode(b[i] + 3);
  return s + (side > 0 ? 'w' : 'b');
}

const capVal = (m: Move): number => {
  let v = m.captures.length * 10000;
  if (m.king) v += 500;
  return v;
};

function orderMoves(moves: Move[], bestCode: number, ply: number, st: SState): Move[] {
  const k = st.killers;
  return moves.slice().sort((a, b) => {
    const ac = a.from * 100 + a.to;
    const bc = b.from * 100 + b.to;
    const as = (ac === bestCode ? 10_000_000 : 0)
      + (ac === k[ply * 2] ? 900_000 : ac === k[ply * 2 + 1] ? 800_000 : 0)
      + capVal(a);
    const bs = (bc === bestCode ? 10_000_000 : 0)
      + (bc === k[ply * 2] ? 900_000 : bc === k[ply * 2 + 1] ? 800_000 : 0)
      + capVal(b);
    return bs - as;
  });
}

function qsearch(pos: Pos, alpha: number, beta: number, ply: number, st: SState): number {
  st.nodes++;
  if ((st.nodes & 1023) === 0 && performance.now() > st.deadline) throw TIMEOUT;
  if (ply > 12) return pos.side * evaluate(pos.b);

  const moves = generateMoves(pos);
  if (moves.length === 0) return -(MATE - ply);
  const caps = moves[0].captures.length > 0 ? moves : [];

  const stand = pos.side * evaluate(pos.b);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;

  for (const m of caps) {
    const s = -qsearch(applyMove(pos, m), -beta, -alpha, ply + 1, st);
    if (s > alpha) alpha = s;
    if (alpha >= beta) return beta;
  }
  return alpha;
}

function negamax(pos: Pos, depth: number, alpha: number, beta: number, ply: number, st: SState): number {
  st.nodes++;
  if ((st.nodes & 2047) === 0 && performance.now() > st.deadline) throw TIMEOUT;

  const moves = generateMoves(pos);
  if (moves.length === 0) return -(MATE - ply);

  const k = key(pos.b, pos.side);
  const tt = st.tt.get(k);
  if (tt && tt.depth >= depth && ply > 0) {
    if (tt.bound === 0) return tt.score;
    if (tt.bound === 1 && tt.score > alpha) alpha = tt.score;
    else if (tt.bound === 2 && tt.score < beta) beta = tt.score;
    if (alpha >= beta) return tt.score;
  }

  if (depth <= 0) return qsearch(pos, alpha, beta, ply, st);

  const ordered = orderMoves(moves, tt ? tt.best : -1, ply, st);
  let best = -Infinity;
  let bestCode = -1;
  let bound: 0 | 1 | 2 = 2;
  for (const m of ordered) {
    const s = -negamax(applyMove(pos, m), depth - 1, -beta, -alpha, ply + 1, st);
    if (s > best) { best = s; bestCode = m.from * 100 + m.to; }
    if (s > alpha) { alpha = s; bound = 0; }
    if (alpha >= beta) {
      bound = 1;
      if (m.captures.length === 0) {
        st.killers[ply * 2 + 1] = st.killers[ply * 2];
        st.killers[ply * 2] = bestCode;
      }
      break;
    }
  }
  st.tt.set(k, { depth, score: best, bound, best: bestCode });
  if (st.tt.size > 800_000) st.tt.clear();
  return best;
}

interface RootResult { best: Move; score: number; candidates: Candidate[]; pv: Move[] }

function searchRoot(pos: Pos, depth: number, prev: Candidate[] | null, st: SState): RootResult | null {
  const moves = generateMoves(pos);
  if (moves.length === 0) return null;

  const scored = moves.map((m) => ({
    m,
    s: prev?.find((p) => p.move.from === m.from && p.move.to === m.to)?.score ?? -Infinity,
  }));
  scored.sort((a, b) => (b.s - a.s) || (capVal(b.m) - capVal(a.m)));

  const results: Candidate[] = [];
  let best: Move = scored[0].m;
  let bestScore = -Infinity;
  for (const { m } of scored) {
    const s = -negamax(applyMove(pos, m), depth - 1, -Infinity, Infinity, 1, st);
    results.push({ move: m, score: s });
    if (s > bestScore) { bestScore = s; best = m; }
  }
  results.sort((a, b) => b.score - a.score);

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
    killers: new Int32Array(128).fill(-1),
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
    if (out.mate || performance.now() > st.deadline) break;
  }
  return out;
}
