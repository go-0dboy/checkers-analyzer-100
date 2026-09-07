/* ============================================================
 * Встроенный движок: альфа-бета с итеративным углублением,
 * персистентной хеш-таблицей, PVS, LMR, killer-ходами и
 * history-эвристикой. Офлайн.
 * Оценки — в сотых долях шашки, с точки стороны, делающей ход.
 * ============================================================ */

import { type Pos, type Move, applyMove, generateMoves, rc } from './core';

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
const KING = 310;
const MATE = 1_000_000;

const CENTRAL = new Uint8Array(51);
const EDGE = new Uint8Array(51);
const ROW = new Int8Array(51);
const COL = new Int8Array(51);
const SQ = new Int8Array(100).fill(-1);

for (let r = 0; r < 10; r++) {
  for (let c = 0; c < 10; c++) {
    if ((r + c) % 2 === 1) SQ[r * 10 + c] = r * 5 + Math.ceil((c + 1) / 2);
  }
}
for (let n = 1; n <= 50; n++) {
  const [r, c] = rc(n);
  ROW[n] = r; COL[n] = c;
  CENTRAL[n] = r >= 3 && r <= 6 && c >= 3 && c <= 6 ? 1 : 0;
  EDGE[n] = c === 0 || c === 9 ? 1 : 0;
}
const sqOf = (r: number, c: number): number => SQ[r * 10 + c];

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

function kingMob(b: Int8Array, n: number): number {
  const r = ROW[n]; const c = COL[n];
  let m = 0;
  for (const [dr, dc] of DIRS) {
    let r1 = r + dr; let c1 = c + dc;
    while (r1 >= 0 && r1 < 10 && c1 >= 0 && c1 < 10) {
      if ((r1 + c1) % 2 === 0) break;
      if (b[sqOf(r1, c1)] !== 0) break;
      m += 2; r1 += dr; c1 += dc;
    }
  }
  return m;
}

function support(b: Int8Array, r: number, c: number, side: 1 | -1): number {
  const br = side === 1 ? r + 1 : r - 1;
  if (br < 0 || br > 9) return 0;
  let v = 0;
  for (const dc of [-1, 1]) {
    const cc = c + dc;
    if (cc < 0 || cc > 9 || (br + cc) % 2 === 0) continue;
    if (b[sqOf(br, cc)] * side > 0) v += 4;
  }
  return Math.min(v, 8);
}

/* Оценка "большого треугольника" — ключевые поля для атаки */
function bigTriangle(n: number, side: 1 | -1): number {
  /* Для белых: 5, 9, 10 (верхний треугольник) */
  /* Для чёрных: 41, 45, 46 (нижний треугольник) */
  if (side === 1) {
    if (n === 5 || n === 9 || n === 10) return 8;
  } else {
    if (n === 41 || n === 45 || n === 46) return 8;
  }
  return 0;
}

/* Оценка дамочной линии — близость к превращению */
function kingLine(r: number, side: 1 | -1): number {
  if (side === 1) {
    /* Белые: ряд 0 — дамочный */
    if (r === 0) return 12;
    if (r === 1) return 6;
    if (r === 2) return 3;
  } else {
    /* Чёрные: ряд 9 — дамочный */
    if (r === 9) return 12;
    if (r === 8) return 6;
    if (r === 7) return 3;
  }
  return 0;
}

/* Оценка изолированных шашек — нет поддержки сзади */
function isolated(b: Int8Array, r: number, c: number, side: 1 | -1): number {
  const br = side === 1 ? r + 1 : r - 1;
  if (br < 0 || br > 9) return 0;
  for (const dc of [-1, 1]) {
    const cc = c + dc;
    if (cc >= 0 && cc < 10 && (br + cc) % 2 === 1) {
      if (b[sqOf(br, cc)] * side > 0) return 0; /* есть поддержка */
    }
  }
  return -5; /* изолированная шашка */
}

/** Статическая оценка с точки зрения белых. */
export function evaluate(b: Int8Array): number {
  let total = 0;
  for (let n = 1; n <= 50; n++) if (b[n] !== 0) total++;
  const endg = total <= 12;

  let s = 0;
  let wBack = 0; let bBack = 0;
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 0) continue;
    const r = ROW[n];
    const c = COL[n];
    if (v === 1) {
      s += MAN + (9 - r) * (endg ? 4 : 3) + (CENTRAL[n] ? 7 : 0) - (EDGE[n] ? 3 : 0);
      if (n === 24) s += 6; /* "золотое поле" */
      s += support(b, r, c, 1);
      s += bigTriangle(n, 1);
      s += kingLine(r, 1);
      s += isolated(b, r, c, 1);
      if (r === 9 && wBack < 4) { wBack++; s += 6; }
    } else if (v === -1) {
      s -= MAN + r * (endg ? 4 : 3) + (CENTRAL[n] ? 7 : 0) - (EDGE[n] ? 3 : 0);
      if (n === 27) s -= 6; /* "золотое поле" */
      s -= support(b, r, c, -1);
      s -= bigTriangle(n, -1);
      s -= kingLine(r, -1);
      s -= isolated(b, r, c, -1);
      if (r === 0 && bBack < 4) { bBack++; s -= 6; }
    } else {
      const mob = kingMob(b, n);
      const val = KING + (CENTRAL[n] ? 14 : 4) + mob * 2 - (mob === 0 ? 18 : 0);
      if (v === 2) s += val; else s -= val;
    }
  }
  return s;
}

/* ---------- Zobrist hashing ---------- */

/* Генерируем случайные 64-битные числа для каждой комбинации (поле, фигура) */
const ZOBRIST_PIECES = new BigUint64Array(51 * 5); /* 51 поле × 5 типов (0,1,2,-1,-2) */
const ZOBRIST_SIDE = BigInt('0x123456789ABCDEF0');

(function initZobrist() {
  let seed = BigInt('0xDEADBEEFCAFEBABE');
  const next = () => {
    seed ^= seed << 13n;
    seed ^= seed >> 7n;
    seed ^= seed << 17n;
    return seed;
  };
  for (let i = 0; i < ZOBRIST_PIECES.length; i++) {
    ZOBRIST_PIECES[i] = next();
  }
})();

function zobristKey(b: Int8Array, side: number): bigint {
  let hash = 0n;
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v !== 0) {
      const idx = n * 5 + (v + 2); /* v: -2,-1,0,1,2 → idx: 0,1,2,3,4 */
      hash ^= ZOBRIST_PIECES[idx];
    }
  }
  if (side < 0) hash ^= ZOBRIST_SIDE;
  return hash;
}

/* ---------- персистентные структуры (живут между позициями) ---------- */

interface TTEntry { depth: number; score: number; bound: 0 | 1 | 2; best: number }

const persist = {
  tt: new Map<bigint, TTEntry>(),
  hist: new Int32Array(64 * 64),
};

function housekeep(): void {
  if (persist.tt.size > 1_500_000) persist.tt.clear();
}

interface SState { nodes: number; deadline: number; killers: Int32Array }

const TIMEOUT = Symbol('timeout');

/* MVV-LVA: Most Valuable Victim - Least Valuable Attacker */
const capVal = (m: Move, b: Int8Array): number => {
  let v = m.captures.length * 10000;
  /* Оцениваем ценность побитых фигур */
  for (const cap of m.captures) {
    const victim = b[cap];
    if (Math.abs(victim) === 2) v += 500; /* дамка ценнее */
    else v += 100; /* простая */
  }
  /* Штраф за использование дамки для взятия (LVA) */
  if (m.king) v -= 50;
  return v;
};

function orderMoves(moves: Move[], bestCode: number, ply: number, st: SState, board: Int8Array): Move[] {
  const k = st.killers;
  const h = persist.hist;
  return moves.slice().sort((a, b) => {
    const ac = a.from * 100 + a.to;
    const bc = b.from * 100 + b.to;
    const as = (ac === bestCode ? 10_000_000 : 0)
      + (ac === k[ply * 2] ? 900_000 : ac === k[ply * 2 + 1] ? 800_000 : 0)
      + capVal(a, board) + (h[a.from * 64 + a.to] >> 6);
    const bs = (bc === bestCode ? 10_000_000 : 0)
      + (bc === k[ply * 2] ? 900_000 : bc === k[ply * 2 + 1] ? 800_000 : 0)
      + capVal(b, board) + (h[b.from * 64 + b.to] >> 6);
    return bs - as;
  });
}

function qsearch(pos: Pos, alpha: number, beta: number, ply: number, st: SState): number {
  st.nodes++;
  if ((st.nodes & 1023) === 0 && performance.now() > st.deadline) throw TIMEOUT;
  if (ply > 14) return pos.side * evaluate(pos.b);

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

  const k = zobristKey(pos.b, pos.side);
  const tt = persist.tt.get(k);
  if (tt && tt.depth >= depth && ply > 0) {
    if (tt.bound === 0) return tt.score;
    if (tt.bound === 1 && tt.score > alpha) alpha = tt.score;
    else if (tt.bound === 2 && tt.score < beta) beta = tt.score;
    if (alpha >= beta) return tt.score;
  }

  if (depth <= 0) return qsearch(pos, alpha, beta, ply, st);

  /* Null-move pruning: если позиция хороша, пропуск хода всё равно должен быть хорош */
  if (depth >= 3 && ply > 0 && !moves.some(m => m.captures.length > 0)) {
    const nullPos: Pos = { b: pos.b, side: (pos.side * -1) as 1 | -1 };
    const R = 2; /* редукция для null-move */
    const nullScore = -negamax(nullPos, depth - 1 - R, -beta, -beta + 1, ply + 1, st);
    if (nullScore >= beta) return beta;
  }

  const ordered = orderMoves(moves, tt ? tt.best : -1, ply, st, pos.b);
  let best = -Infinity;
  let bestCode = -1;
  let bound: 0 | 1 | 2 = 2;

  for (let i = 0; i < ordered.length; i++) {
    const m = ordered[i];
    const child = applyMove(pos, m);
    const isCap = m.captures.length > 0;
    let s: number;

    if (i === 0) {
      s = -negamax(child, depth - 1, -beta, -alpha, ply + 1, st);
    } else {
      let reduced = 0;
      if (depth >= 3 && i >= 3 && !isCap && alpha > -MATE + 5000) {
        reduced = 1 + (i >= 8 ? 1 : 0) + (depth >= 7 ? 1 : 0);
        if (reduced > depth - 2) reduced = Math.max(1, depth - 2);
      }
      if (reduced > 0) {
        s = -negamax(child, depth - 1 - reduced, -alpha - 1, -alpha, ply + 1, st);
        if (s > alpha) s = -negamax(child, depth - 1, -alpha - 1, -alpha, ply + 1, st);
      } else {
        s = -negamax(child, depth - 1, -alpha - 1, -alpha, ply + 1, st);
      }
      if (s > alpha && s < beta) s = -negamax(child, depth - 1, -beta, -alpha, ply + 1, st);
    }

    if (s > best) { best = s; bestCode = m.from * 100 + m.to; }
    if (s > alpha) { alpha = s; bound = 0; }
    if (alpha >= beta) {
      bound = 1;
      if (!isCap) {
        st.killers[ply * 2 + 1] = st.killers[ply * 2];
        st.killers[ply * 2] = bestCode;
        const idx = m.from * 64 + m.to;
        persist.hist[idx] += depth * depth;
        if (persist.hist[idx] > 200_000_000) persist.hist.fill(0);
      }
      break;
    }
  }

  const old = persist.tt.get(k);
  if (!old || old.depth <= depth) {
    persist.tt.set(k, { depth, score: best, bound, best: bestCode });
    housekeep();
  }
  return best;
}

interface RootResult {
  best: Move;
  score: number;
  candidates: Candidate[];
  pv: Move[];
  fail: 'low' | 'high' | null;
}

function searchRoot(pos: Pos, depth: number, prev: Candidate[] | null, st: SState, asp: number | null): RootResult | null {
  const moves = generateMoves(pos);
  if (moves.length === 0) return null;

  const scored = moves.map((m) => ({
    m,
    s: prev?.find((p) => p.move.from === m.from && p.move.to === m.to)?.score ?? -Infinity,
  }));
  scored.sort((a, b) => (b.s - a.s) || (capVal(b.m, pos.b) - capVal(a.m, pos.b)));

  const lo = asp === null ? -Infinity : asp - 30;
  const hi = asp === null ? Infinity : asp + 30;
  let alpha = lo;

  const results: Candidate[] = [];
  let best: Move = scored[0].m;
  let bestScore = -Infinity;

  for (let i = 0; i < scored.length; i++) {
    const { m } = scored[i];
    const child = applyMove(pos, m);
    let s: number;
    if (i === 0) {
      s = -negamax(child, depth - 1, -hi, -alpha, 1, st);
    } else {
      s = -negamax(child, depth - 1, -alpha - 1, -alpha, 1, st);
      if (s > alpha && s < hi) s = -negamax(child, depth - 1, -hi, -alpha, 1, st);
    }
    results.push({ move: m, score: s });
    if (s > bestScore) { bestScore = s; best = m; }
    if (s > alpha) alpha = s;
    if (alpha >= hi) break;
  }
  results.sort((a, b) => b.score - a.score);

  persist.tt.set(zobristKey(pos.b, pos.side), { depth, score: bestScore, bound: 0, best: best.from * 100 + best.to });
  housekeep();

  const pv: Move[] = [];
  let p: Pos = pos;
  const seen = new Set<bigint>();
  for (let i = 0; i < 40; i++) {
    const k = zobristKey(p.b, p.side);
    if (seen.has(k)) break;
    seen.add(k);
    const e = persist.tt.get(k);
    if (!e || e.best < 0) break;
    const mv = generateMoves(p).find((mm) => mm.from * 100 + mm.to === e.best);
    if (!mv) break;
    pv.push(mv);
    p = applyMove(p, mv);
  }

  const fail: 'low' | 'high' | null = asp === null
    ? null
    : bestScore <= lo ? 'low' : bestScore >= hi ? 'high' : null;

  return { best, score: bestScore, candidates: results, pv, fail };
}

export async function analyze(
  pos: Pos,
  opts: { timeMs: number; maxDepth: number; humanStyle?: boolean },
  onProgress: (p: EngineProgress) => void,
  token: { cancelled: boolean },
): Promise<EngineOut> {
  const st: SState = {
    nodes: 0,
    deadline: performance.now() + opts.timeMs,
    killers: new Int32Array(192).fill(-1),
  };
  const out: EngineOut = {
    best: null, score: 0, depth: 0, nodes: 0, candidates: [], pv: [], mate: false,
  };
  let prev: Candidate[] | null = null;
  let asp: number | null = null;

  for (let d = 1; d <= opts.maxDepth; d++) {
    await new Promise((r) => { setTimeout(r, 0); });
    if (token.cancelled) return out;

    let res: RootResult | null = null;
    try {
      res = searchRoot(pos, d, prev, st, asp);
      if (res && res.fail) res = searchRoot(pos, d, prev, st, null);
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
    asp = out.mate ? null : res.score;
    if (out.mate || performance.now() > st.deadline) break;
  }

  /* «человеческий» выбор: среди почти равных ходов берём типичный */
  if (opts.humanStyle && out.candidates.length > 1 && out.best && !out.mate) {
    const top = out.candidates[0].score;
    const close = out.candidates.filter((c) => top - c.score <= 15);
    if (close.length > 1) {
      const prefer = close.find((c) => c.move.captures.length === 0 && !c.move.king)
        ?? close.find((c) => c.move.captures.length === 0)
        ?? close[0];
      out.best = prefer.move;
    }
  }

  return out;
}
