/* ============================================================
 * Клиент движка: запускает имплементацию в отдельном потоке
 * (Web Worker) и общается с ней по протоколу сообщений.
 *
 * Дополнительно — pondering: получив результат, клиент тут же
 * отправляет движку позицию после лучшего хода. Если пользователь
 * сыграет этот ход, готовый анализ отдаётся мгновенно из кэша.
 *
 * Если воркер недоступен — прозрачный фолбэк в главный поток.
 * ============================================================ */

import { parseFen, generateMoves, applyMove, findMove, boardToFen } from './core';
import type { EngineResult, GoMsg } from './impl';

export interface InfoMsg { id: number; depth: number; score: number; nodes: number }

export interface AnalyzeReq {
  fen: string;
  history: number[];
  startFen: string;
  timeMs: number;
  maxDepth: number;
}

export interface AnalyzeHandle {
  promise: Promise<EngineResult | null>;
  cancel: () => void;
}

class EngineClient {
  private worker: Worker | null = null;
  private direct = false;
  private directMod: typeof import('./impl') | null = null;
  private seq = 0;
  private pending = new Map<number, (r: EngineResult | null) => void>();
  private reqs = new Map<number, AnalyzeReq>();
  private infoCbs = new Map<number, (i: InfoMsg) => void>();
  /** id пондер-запроса → FEN позиции, для которой он сделан */
  private ponderPending = new Map<number, string>();
  /** FEN → готовый результат пондеринга */
  private ponderCache = new Map<string, EngineResult>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./impl.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => this.route(e.data as { t: string } & Record<string, unknown>);
      this.worker.onerror = () => {
        /* воркер упал — переходим в главный поток */
        this.worker?.terminate();
        this.worker = null;
        this.direct = true;
      };
    } catch {
      this.worker = null;
      this.direct = true;
    }
  }

  private route(m: { t: string } & Record<string, unknown>): void {
    if (m.t === 'info') {
      const cb = this.infoCbs.get(m.id as number);
      if (cb) cb(m as unknown as InfoMsg);
      return;
    }
    if (m.t !== 'done') return;
    const res = m as unknown as EngineResult;

    /* ответ на пондер-запрос → в кэш, наружу не отдаём */
    const childFen = this.ponderPending.get(res.id);
    if (childFen !== undefined) {
      this.ponderPending.delete(res.id);
      if (res.best) {
        this.ponderCache.set(childFen, res);
        if (this.ponderCache.size > 24) this.ponderCache.clear();
      }
      return;
    }

    this.infoCbs.delete(res.id);
    const done = this.pending.get(res.id);
    const req = this.reqs.get(res.id);
    this.pending.delete(res.id);
    this.reqs.delete(res.id);
    if (done) {
      done(res);
      if (req && res && res.best) this.schedulePonder(req, res);
    }
  }

  /** Предсказываем ответ пользователя на лучший ход и считаем его заранее. */
  private schedulePonder(req: AnalyzeReq, res: EngineResult): void {
    if (!res.best) return;
    const pos = parseFen(req.fen);
    if (!pos) return;
    const mv = findMove(generateMoves(pos), res.best.from, res.best.to);
    if (!mv) return;
    const child = applyMove(pos, mv);
    const childFen = boardToFen(child.b, child.side);
    const id = ++this.seq;
    this.ponderPending.set(id, childFen);
    this.post({
      t: 'go', id,
      fen: childFen,
      history: [...req.history, res.best.from * 100 + res.best.to],
      startFen: req.startFen,
      timeMs: req.timeMs,
      maxDepth: req.maxDepth,
    } satisfies GoMsg);
  }

  private post(msg: GoMsg): void {
    if (this.worker) { this.worker.postMessage(msg); return; }
    void (async () => {
      if (!this.directMod) this.directMod = await import('./impl');
      this.directMod.runDirect(msg, (m) => this.route(m as { t: string } & Record<string, unknown>));
    })();
  }

  analyze(req: AnalyzeReq, onInfo?: (i: InfoMsg) => void): AnalyzeHandle {
    const id = ++this.seq;
    /* прежние пондер-предвычисления больше не актуальны */
    this.ponderPending.clear();

    /* попадание в пондер-кэш — мгновенный ответ */
    const hit = this.ponderCache.get(req.fen);
    if (hit) {
      this.ponderCache.delete(req.fen);
      onInfo?.({ id, depth: hit.depth, score: hit.score ?? 0, nodes: hit.nodes });
      return { promise: Promise.resolve({ ...hit, id }), cancel: () => {} };
    }

    let cancelled = false;
    const promise = new Promise<EngineResult | null>((resolve) => {
      if (cancelled) { resolve(null); return; }
      this.pending.set(id, resolve);
      this.reqs.set(id, req);
      if (onInfo) this.infoCbs.set(id, onInfo);
      this.post({ t: 'go', id, ...req });
    });

    return {
      promise,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        this.pending.delete(id);
        this.reqs.delete(id);
        this.infoCbs.delete(id);
        if (this.worker) this.worker.postMessage({ t: 'stop' });
        else if (this.directMod) this.directMod.stopDirect();
      },
    };
  }
}

export const engine = new EngineClient();
