/** History-aware alpha-beta, iterative deepening and exact root candidates.
 * Scores are in hundredths of a man from the side-to-move perspective.
 * Speculative null-move/LMR are deliberately absent until separately validated.
 */

import { advanceDraw, drawReason, initialDraw, drawKey, type DrawState } from './draw';
import { type Pos, type Move, applyMove, generateMoves, rc, moveKey } from './core';

export interface Candidate {
  move: Move;
  score: number;
}

export interface EngineOut {
  best: Move | null;
  score: number;
  depth: number;
  nodes: number;
  candidates: Candidate[];
  pv: Move[];
  mate: boolean;
  draw?: string;
}

export interface EngineProgress {
  depth: number;
  score: number;
  nodes: number;
}

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
  ROW[n] = r;
  COL[n] = c;
  CENTRAL[n] = r >= 3 && r <= 6 && c >= 3 && c <= 6 ? 1 : 0;
  EDGE[n] = c === 0 || c === 9 ? 1 : 0;
}
const sqOf = (r: number, c: number): number => SQ[r * 10 + c];

const DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

function kingMob(b: Int8Array, n: number): number {
  const r = ROW[n];
  const c = COL[n];
  let m = 0;
  for (const [dr, dc] of DIRS) {
    let r1 = r + dr;
    let c1 = c + dc;
    while (r1 >= 0 && r1 < 10 && c1 >= 0 && c1 < 10) {
      if ((r1 + c1) % 2 === 0) break;
      if (b[sqOf(r1, c1)] !== 0) break;
      m += 2;
      r1 += dr;
      c1 += dc;
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
  /* Для чёрных: 41, 42, 46 (зеркало 10, 9, 5) */
  if (side === 1) {
    if (n === 5 || n === 9 || n === 10) return 8;
  } else {
    if (n === 41 || n === 42 || n === 46) return 8;
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
  let wBack = 0;
  let bBack = 0;
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
      if (r === 9 && wBack < 4) {
        wBack++;
        s += 6;
      }
    } else if (v === -1) {
      s -= MAN + r * (endg ? 4 : 3) + (CENTRAL[n] ? 7 : 0) - (EDGE[n] ? 3 : 0);
      if (n === 27) s -= 6; /* "золотое поле" */
      s -= support(b, r, c, -1);
      s -= bigTriangle(n, -1);
      s -= kingLine(r, -1);
      s -= isolated(b, r, c, -1);
      if (r === 0 && bBack < 4) {
        bBack++;
        s -= 6;
      }
    } else {
      const mob = kingMob(b, n);
      const val = KING + (CENTRAL[n] ? 14 : 4) + mob * 2 - (mob === 0 ? 18 : 0);
      if (v === 2) s += val;
      else s -= val;
    }
  }
  return s;
}

/* All TT scores include the draw context. Mate distance is stored root-independently. */
interface TTEntry {
  depth: number;
  score: number;
  bound: 'exact' | 'lower' | 'upper';
  best: string;
}
const tt = new Map<string, TTEntry>();
const TT_LIMIT = 100_000;
export function clearSearch(): void {
  tt.clear();
}
const TIMEOUT = Symbol('timeout');
interface SearchState {
  nodes: number;
  deadline: number;
  token: { cancelled: boolean };
}
function key(pos: Pos, draw: DrawState): string {
  // Exact board identity avoids BigInt work and probabilistic hash collisions.
  return `${pos.side}:${pos.b.join(',')}:${drawKey(draw)}`;
}
function check(st: SearchState): void {
  st.nodes++;
  if (st.token.cancelled || ((st.nodes & 127) === 0 && performance.now() >= st.deadline))
    throw TIMEOUT;
}
const toTT = (score: number, ply: number) =>
  Math.abs(score) > MATE - 1000 ? score + Math.sign(score) * ply : score;
const fromTT = (score: number, ply: number) =>
  Math.abs(score) > MATE - 1000 ? score - Math.sign(score) * ply : score;
function ordered(moves: Move[], best: string | undefined): Move[] {
  // All legal captures already have the same length under the majority rule.
  // Keep the stable generator order and move only the TT recommendation first.
  if (!best) return moves;
  const index = moves.findIndex((move) => moveKey(move) === best);
  if (index <= 0) return moves;
  return [moves[index], ...moves.slice(0, index), ...moves.slice(index + 1)];
}
function quiescence(
  pos: Pos,
  alpha: number,
  beta: number,
  ply: number,
  draw: DrawState,
  st: SearchState,
  knownMoves?: Move[],
): number {
  check(st);
  const moves = knownMoves ?? generateMoves(pos);
  if (!moves.length) return -MATE + ply;
  if (drawReason(pos, draw)) return 0;
  // No stand-pat is legal when capture is compulsory. Every capture reduces material,
  // so this recursion terminates without an arbitrary absolute-ply cutoff.
  if (!moves[0].captures.length) return pos.side * evaluate(pos.b);
  let best = -Infinity;
  for (const move of moves) {
    const child = applyMove(pos, move);
    const score = -quiescence(
      child,
      -beta,
      -alpha,
      ply + 1,
      advanceDraw(draw, pos, move, child),
      st,
    );
    best = Math.max(best, score);
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }
  return best;
}
function negamax(
  pos: Pos,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  draw: DrawState,
  st: SearchState,
): number {
  check(st);
  const moves = generateMoves(pos);
  if (!moves.length) return -MATE + ply;
  if (drawReason(pos, draw)) return 0;
  if (depth <= 0) return quiescence(pos, alpha, beta, ply, draw, st, moves);
  const k = key(pos, draw),
    entry = tt.get(k);
  if (entry && entry.depth >= depth) {
    const score = fromTT(entry.score, ply);
    if (entry.bound === 'exact') return score;
    if (entry.bound === 'lower') alpha = Math.max(alpha, score);
    else beta = Math.min(beta, score);
    if (alpha >= beta) return score;
  }
  const originalAlpha = alpha,
    originalBeta = beta;
  let best = -Infinity,
    bestMove = '';
  for (const move of ordered(moves, entry?.best)) {
    const child = applyMove(pos, move);
    const score = -negamax(
      child,
      depth - 1,
      -beta,
      -alpha,
      ply + 1,
      advanceDraw(draw, pos, move, child),
      st,
    );
    if (score > best) {
      best = score;
      bestMove = moveKey(move);
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }
  const bound = best <= originalAlpha ? 'upper' : best >= originalBeta ? 'lower' : 'exact';
  if (tt.size >= TT_LIMIT) tt.clear();
  if (!entry || entry.depth <= depth)
    tt.set(k, { depth, score: toTT(best, ply), bound, best: bestMove });
  return best;
}
function principalVariation(pos: Pos, first: Move, draw: DrawState, depth: number): Move[] {
  const pv = [first];
  let child = applyMove(pos, first),
    state = advanceDraw(draw, pos, first, child);
  for (let d = 1; d < depth; d++) {
    if (drawReason(child, state)) break;
    const entry = tt.get(key(child, state));
    if (!entry || entry.bound !== 'exact' || entry.depth < depth - d) break;
    const move = generateMoves(child).find((m) => moveKey(m) === entry.best);
    if (!move) break;
    pv.push(move);
    const next = applyMove(child, move);
    state = advanceDraw(state, child, move, next);
    child = next;
  }
  return pv;
}
export async function analyze(
  pos: Pos,
  opts: {
    timeMs: number;
    maxDepth: number;
    humanStyle?: boolean;
    draw?: DrawState;
  },
  onProgress: (p: EngineProgress) => void,
  token: { cancelled: boolean },
): Promise<EngineOut> {
  const draw = opts.draw ?? initialDraw(pos),
    legal = generateMoves(pos);
  const out: EngineOut = {
    best: null,
    score: 0,
    depth: 0,
    nodes: 0,
    candidates: [],
    pv: [],
    mate: false,
  };
  if (!legal.length) {
    out.score = -MATE;
    out.mate = true;
    return out;
  }
  const reason = drawReason(pos, draw);
  if (reason) {
    out.draw = reason;
    return out;
  }
  const st: SearchState = {
    nodes: 0,
    deadline: performance.now() + Math.max(1, Math.min(60000, opts.timeMs)),
    token,
  };
  // A legal fallback exists even if the first iteration times out.
  out.best = legal[0];
  out.pv = [legal[0]];
  out.score = pos.side * evaluate(pos.b);
  let previous: Candidate[] = [];
  const maxDepth = Math.max(1, Math.min(40, Math.floor(opts.maxDepth)));
  for (let depth = 1; depth <= maxDepth; depth++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (token.cancelled || performance.now() >= st.deadline) break;
    const results: Candidate[] = [];
    try {
      const scores = new Map(previous.map((c) => [c.move, c.score]));
      const moves = previous.length
        ? legal.slice().sort((a, b) => scores.get(b)! - scores.get(a)!)
        : legal;
      // Independent full windows give exact scores for every displayed candidate.
      for (const move of moves) {
        if (token.cancelled || performance.now() >= st.deadline) throw TIMEOUT;
        const child = applyMove(pos, move);
        results.push({
          move,
          score: -negamax(
            child,
            depth - 1,
            -Infinity,
            Infinity,
            1,
            advanceDraw(draw, pos, move, child),
            st,
          ),
        });
      }
    } catch (e) {
      if (e === TIMEOUT) break;
      throw e;
    }
    results.sort((a, b) => b.score - a.score);
    previous = results;
    let chosen = results[0];
    if (opts.humanStyle && Math.abs(chosen.score) < MATE - 1000)
      chosen =
        results.find(
          (c) => chosen.score - c.score <= 15 && !c.move.king && !c.move.captures.length,
        ) ?? chosen;
    out.best = chosen.move;
    out.score = chosen.score;
    out.depth = depth;
    out.candidates = results.slice(0, 5);
    out.pv = principalVariation(pos, chosen.move, draw, depth);
    out.mate = Math.abs(chosen.score) > MATE - 1000;
    onProgress({ depth, score: chosen.score, nodes: st.nodes });
    if (out.mate) break;
  }
  out.nodes = st.nodes;
  return out;
}
