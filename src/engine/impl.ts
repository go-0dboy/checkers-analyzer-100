/* ============================================================
 * Имплементация движка. Работает в Web Worker (Vite собирает
 * отдельный бандл) или — при недоступности воркера — в главном
 * потоке через runDirect.
 *
 * Протокол сообщений:
 *   → { t:'go', id, fen, history, startFen, timeMs, maxDepth,
 *        humanStyle?, nnEnabled?, nnBlend? }
 *   → { t:'loadNet', net: string | null }
 *   → { t:'stop' }
 *   ← { t:'info', id, depth, score, nodes }
 *   ← { t:'done', id, best, score, depth, nodes, nps, ms,
 *        candidates, pv, mate, book }
 *
 * Порядок принятия решения: база фигур (клиент) → дебютная книга
 * → альфа-бета → смешивание с нейросетью на корне.
 * ============================================================ */

import { applyMove, findMove, generateMoves, parseFen, type Move } from './core';
import { analyze } from './search';
import { bookLookup, START_FEN } from './book';
import { NNUE, FEATURES } from './nn';

export interface GoMsg {
  t: 'go';
  id: number;
  fen: string;
  history: number[];
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
  best: { from: number; to: number } | null;
  score: number | null;
  depth: number;
  nodes: number;
  nps: number;
  ms: number;
  candidates: { from: number; to: number; caps: number; score: number }[];
  pv: { from: number; to: number }[];
  mate: boolean;
  book: string | null;
}

let net: NNUE | null = null;
const feat = new Float32Array(FEATURES);
let activeToken: { cancelled: boolean } | null = null;

export function loadNetDirect(json: string | null): void {
  net = json ? NNUE.deserialize(json) : null;
}

async function runEngine(msg: GoMsg, post: (m: unknown) => void): Promise<void> {
  const t0 = performance.now();
  const pos = parseFen(msg.fen);
  if (!pos) {
    post({
      t: 'done', id: msg.id, best: null, score: null, depth: 0, nodes: 0,
      nps: 0, ms: 1, candidates: [], pv: [], mate: false, book: null,
    });
    return;
  }

  const legal = generateMoves(pos);
  if (legal.length === 0) {
    post({
      t: 'done', id: msg.id, best: null, score: null, depth: 0, nodes: 0,
      nps: 0, ms: Math.max(1, Math.round(performance.now() - t0)),
      candidates: [], pv: [], mate: false, book: null,
    });
    return;
  }

  /* дебютная книга: мгновенный ответ по теории */
  if (msg.startFen === START_FEN && msg.history.length <= 26) {
    const hit = bookLookup(msg.history);
    if (hit && findMove(legal, hit.from, hit.to)) {
      post({
        t: 'done', id: msg.id,
        best: { from: hit.from, to: hit.to },
        score: null, depth: 0, nodes: 0, nps: 0,
        ms: Math.max(1, Math.round(performance.now() - t0)),
        candidates: [], pv: [{ from: hit.from, to: hit.to }],
        mate: false, book: hit.name,
      });
      return;
    }
  }

  const token = { cancelled: false };
  activeToken = token;

  const res = await analyze(
    pos,
    { timeMs: msg.timeMs, maxDepth: msg.maxDepth, humanStyle: msg.humanStyle },
    (p) => post({ t: 'info', id: msg.id, depth: p.depth, score: p.score, nodes: p.nodes }),
    token,
  );

  if (token.cancelled) return;

  let best = res.best ? { from: res.best.from, to: res.best.to } : null;
  let candidates = res.candidates.map((c) => ({
    from: c.move.from, to: c.move.to, caps: c.move.captures.length, score: c.score,
  }));
  let score = res.best ? res.score : null;

  /* смешивание с нейросетью — только на корне (дешёво: ≤5 прямых проходов) */
  if (net && msg.nnEnabled && (msg.nnBlend ?? 0) > 0 && best && !res.mate && candidates.length > 0) {
    const w = Math.min(0.8, Math.max(0, msg.nnBlend ?? 0));
    const blended = candidates.map((c) => {
      const mv = findMove(legal, c.from, c.to);
      let nn = 0;
      if (mv) {
        const child = applyMove(pos, mv);
        net!.features(child.b, feat);
        nn = -net!.evalFor(child, feat); // к стороне, делающей ход
      }
      return { ...c, score: Math.round((1 - w) * c.score + w * nn) };
    });
    blended.sort((a, b) => b.score - a.score);
    candidates = blended;
    best = { from: blended[0].from, to: blended[0].to };
    score = blended[0].score;
  }

  const ms = Math.max(1, Math.round(performance.now() - t0));
  post({
    t: 'done', id: msg.id,
    best,
    score,
    depth: res.depth,
    nodes: res.nodes,
    nps: Math.round((res.nodes / ms) * 1000),
    ms,
    candidates,
    pv: res.pv.map((m: Move) => ({ from: m.from, to: m.to })),
    mate: res.mate,
    book: null,
  });
}

/* ---------- работа в воркере ----------
 * Регистрируем обработчик только внутри DedicatedWorker:
 * в главном потоке self.postMessage тоже существует, и
 * перехватывать window.onmessage нельзя. */
const scope = self as unknown as {
  onmessage?: ((e: MessageEvent) => void) | null;
  postMessage?: (m: unknown) => void;
};

if (typeof document === 'undefined' && typeof scope.postMessage === 'function') {
  scope.onmessage = (e: MessageEvent) => {
    const d = e.data as GoMsg | { t: 'stop' } | { t: 'loadNet'; net: string | null };
    if (d.t === 'go') {
      if (activeToken) activeToken.cancelled = true;
      void runEngine(d, (m) => scope.postMessage!(m));
    } else if (d.t === 'loadNet') {
      loadNetDirect(d.net);
    } else {
      if (activeToken) activeToken.cancelled = true;
    }
  };
}

/* ---------- фолбэк в главном потоке ---------- */
export function runDirect(msg: GoMsg, post: (m: unknown) => void): void {
  if (activeToken) activeToken.cancelled = true;
  void runEngine(msg, post);
}
