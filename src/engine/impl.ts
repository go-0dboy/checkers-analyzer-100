/* ============================================================
 * Имплементация движка: работает в Web Worker (impl.ts
 * собирается Vite отдельным модулем воркера) либо в главном
 * потоке через runDirect — протокол сообщений одинаковый.
 *
 *   UI → движок:  { t:'go', id, fen, history, timeMs, maxDepth }
 *                 { t:'stop' }
 *   движок → UI:  { t:'info', id, depth, score, nodes }
 *                 { t:'done', id, ...EngineResult }
 * ============================================================ */

import { parseFen, generateMoves, applyMove, findMove, boardToFen, startBoard, WHITE } from './core';
import { analyze } from './search';
import { materialInfo, materialVerdict, type TbVerdict } from './tablebase';
import { bookLookup } from './book';

export interface GoMsg {
  t: 'go';
  id: number;
  fen: string;
  history: number[];
  startFen: string;
  timeMs: number;
  maxDepth: number;
}

export interface EngineResult {
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
  tb: TbVerdict | null;
}

const START_FEN = boardToFen(startBoard(), WHITE);

async function runEngine(msg: GoMsg, post: (m: unknown) => void): Promise<void> {
  const t0 = performance.now();
  const pos = parseFen(msg.fen);
  if (!pos) return;

  const legal = generateMoves(pos);
  if (legal.length === 0) return;

  const mInfo = materialInfo(pos.b);
  const tb = mInfo.total <= 9 ? materialVerdict(mInfo) : null;

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
        mate: false, book: hit.name, tb,
      });
      return;
    }
  }

  const token = { cancelled: false };
  activeToken = token;

  const res = await analyze(
    pos,
    { timeMs: msg.timeMs, maxDepth: msg.maxDepth },
    (p) => post({ t: 'info', id: msg.id, depth: p.depth, score: p.score, nodes: p.nodes }),
    token,
  );

  if (token.cancelled) return;

  const ms = Math.max(1, Math.round(performance.now() - t0));
  post({
    t: 'done', id: msg.id,
    best: res.best ? { from: res.best.from, to: res.best.to } : null,
    score: res.best ? res.score : null,
    depth: res.depth,
    nodes: res.nodes,
    nps: Math.round((res.nodes / ms) * 1000),
    ms,
    candidates: res.candidates.map((c) => ({
      from: c.move.from, to: c.move.to, caps: c.move.captures.length, score: c.score,
    })),
    pv: res.pv.map((m) => ({ from: m.from, to: m.to })),
    mate: res.mate,
    book: null,
    tb,
  });
}

let activeToken: { cancelled: boolean } | null = null;

/* ---------- работа в воркере ----------
 * Регистрируем обработчик только внутри DedicatedWorker:
 * в главном потоке (фолбэк) self.postMessage тоже существует,
 * и перехватывать window.onmessage нельзя. */
const scope = self as unknown as {
  onmessage?: ((e: MessageEvent) => void) | null;
  postMessage?: (m: unknown) => void;
};

if (typeof document === 'undefined' && typeof scope.postMessage === 'function') {
  scope.onmessage = (e: MessageEvent) => {
    const d = e.data as GoMsg | { t: 'stop' };
    if (d.t === 'go') {
      /* новый запрос (или реальный ход после пондеринга) отменяет прежний расчёт */
      if (activeToken) activeToken.cancelled = true;
      void runEngine(d, (m) => scope.postMessage!(m));
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

export function stopDirect(): void {
  if (activeToken) activeToken.cancelled = true;
}
