/** Worker implementation: full move identities, history-aware search and leaf NN evaluation. */
import { generateMoves, parseFen, applyMove, findMove, type Move, type Pos } from './core';
import { analyze, clearSearch, evaluate } from './search';
import { bookLookup, START_FEN } from './book';
import { initialDraw, advanceDraw, drawReason } from './draw';
import { NNUE, FEATURES } from './nn';
export interface GoMsg {
  t: 'go';
  id: number;
  fen: string;
  history: Move[];
  startFen: string;
  timeMs: number;
  maxDepth: number;
  humanStyle?: boolean;
  nnEnabled?: boolean;
  nnBlend?: number;
}
export interface EngineResult {
  t: 'done';
  id: number;
  best: Move | null;
  score: number | null;
  depth: number;
  nodes: number;
  nps: number;
  ms: number;
  candidates: (Move & { caps: number; score: number })[];
  pv: Move[];
  mate: boolean;
  book: string | null;
  draw?: string;
  error?: string;
}
let net: NNUE | null = null;
let activeToken: { cancelled: boolean } | null = null;
export function loadNetDirect(json: string | null): void {
  net = json ? NNUE.deserialize(json) : null;
  clearSearch();
}
let evalMode = '';
async function runEngine(msg: GoMsg, post: (m: unknown) => void): Promise<void> {
  const t0 = performance.now();
  const empty: EngineResult = {
    t: 'done',
    id: msg.id,
    best: null,
    score: null,
    depth: 0,
    nodes: 0,
    nps: 0,
    ms: 0,
    candidates: [],
    pv: [],
    mate: false,
    book: null,
  };
  try {
    const pos = parseFen(msg.fen),
      start = parseFen(msg.startFen);
    if (!pos || !start) throw new Error('Некорректный FEN');
    let previous = start,
      draw = initialDraw(start);
    for (const move of msg.history) {
      const legal = findMove(generateMoves(previous), move.from, move.to, move.path, move.captures);
      if (!legal) throw new Error('Нелегальный ход в истории');
      const next = applyMove(previous, legal);
      draw = advanceDraw(draw, previous, legal, next);
      previous = next;
    }
    if (previous.side !== pos.side || previous.b.join(',') !== pos.b.join(','))
      throw new Error('История не соответствует позиции');
    const legal = generateMoves(pos);
    if (!legal.length) {
      post({ ...empty, score: -1_000_000, mate: true });
      return;
    }
    const reason = drawReason(pos, draw);
    if (reason) {
      post({ ...empty, score: 0, draw: reason });
      return;
    }
    if (msg.startFen === START_FEN && msg.history.length <= 26) {
      const hit = bookLookup(msg.history.map((m) => m.from * 100 + m.to));
      const move = hit && findMove(legal, hit.from, hit.to);
      if (move) {
        post({
          ...empty,
          best: move,
          pv: [move],
          book: hit!.name,
          ms: Math.max(1, Math.round(performance.now() - t0)),
        });
        return;
      }
    }
    const token = { cancelled: false };
    activeToken = token;
    const weight = net && msg.nnEnabled ? Math.min(0.8, Math.max(0, msg.nnBlend ?? 0)) : 0;
    const mode = `${!!net}/${weight}`;
    if (mode !== evalMode) {
      clearSearch();
      evalMode = mode;
    }
    const features = new Float32Array(FEATURES);
    const leafEval = (pos: Pos) => {
      const b = pos.b;
      const hce = evaluate(b);
      if (!net || !weight) return hce;
      net.features(b, features, pos.side);
      return Math.round((1 - weight) * hce + weight * (net.forward(features) - 0.5) * 500);
    };
    const result = await analyze(
      pos,
      {
        timeMs: msg.timeMs,
        maxDepth: msg.maxDepth,
        humanStyle: msg.humanStyle,
        draw,
        evaluate: leafEval,
      },
      (info) => post({ t: 'info', id: msg.id, ...info }),
      token,
    );
    if (token.cancelled) return;
    const ms = Math.max(1, Math.round(performance.now() - t0));
    post({
      ...empty,
      best: result.best,
      score: result.depth ? result.score : null,
      depth: result.depth,
      nodes: result.nodes,
      ms,
      nps: Math.round((result.nodes * 1000) / ms),
      candidates: result.candidates.map((c) => ({
        ...c.move,
        caps: c.move.captures.length,
        score: c.score,
      })),
      pv: result.pv,
      mate: result.mate,
      draw: result.draw,
    });
  } catch (error) {
    post({ ...empty, error: error instanceof Error ? error.message : String(error) });
  }
}
const scope =
  typeof self === 'undefined'
    ? null
    : (self as unknown as {
        onmessage: ((e: MessageEvent) => void) | null;
        postMessage: (m: unknown) => void;
      });
if (typeof document === 'undefined' && scope && typeof scope.postMessage === 'function') {
  scope.onmessage = (e: MessageEvent) => {
    const d = e.data as GoMsg | { t: 'stop' } | { t: 'loadNet'; net: string | null };
    if (d.t === 'loadNet') {
      loadNetDirect(d.net);
      return;
    }
    if (activeToken) activeToken.cancelled = true;
    if (d.t === 'go') void runEngine(d, (m) => scope.postMessage(m));
  };
}
export function stopDirect(): void {
  if (activeToken) activeToken.cancelled = true;
}
export function runDirect(msg: GoMsg, post: (m: unknown) => void): void {
  stopDirect();
  void runEngine(msg, post);
}
