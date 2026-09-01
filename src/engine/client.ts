/* ============================================================
 * Клиент движка: запускает имплементацию в отдельном потоке
 * (Web Worker) и общается по протоколу сообщений. Если воркер
 * недоступен — прозрачный фолбэк в главный поток.
 * ============================================================ */

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
  private infoCbs = new Map<number, (i: InfoMsg) => void>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./impl.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => this.route(e.data as { t: string } & Record<string, unknown>);
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
        this.direct = true;
        this.failPending();
      };
    } catch {
      this.worker = null;
      this.direct = true;
    }
  }

  private failPending(): void {
    for (const [id, resolve] of this.pending) {
      this.infoCbs.delete(id);
      resolve(null);
    }
    this.pending.clear();
  }

  private route(m: { t: string } & Record<string, unknown>): void {
    if (m.t === 'info') {
      const cb = this.infoCbs.get(m.id as number);
      if (cb) cb(m as unknown as InfoMsg);
    } else if (m.t === 'done') {
      const res = m as unknown as EngineResult;
      this.infoCbs.delete(res.id);
      const done = this.pending.get(res.id);
      if (done) { this.pending.delete(res.id); done(res); }
    }
  }

  analyze(req: AnalyzeReq, onInfo?: (i: InfoMsg) => void): AnalyzeHandle {
    const id = ++this.seq;
    const msg: GoMsg = { t: 'go', id, ...req };
    let cancelled = false;

    const promise = new Promise<EngineResult | null>((resolve) => {
      if (cancelled) { resolve(null); return; }
      this.pending.set(id, resolve);
      if (onInfo) this.infoCbs.set(id, onInfo);

      if (this.worker) {
        this.worker.postMessage(msg);
        return;
      }
      void (async () => {
        if (!this.directMod) this.directMod = await import('./impl');
        if (this.pending.get(id) !== resolve) return;
        this.directMod.runDirect(msg, (m) => this.route(m as { t: string } & Record<string, unknown>));
      })();
    });

    return {
      promise,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        this.pending.delete(id);
        this.infoCbs.delete(id);
        if (this.worker) this.worker.postMessage({ t: 'stop' });
        else if (this.directMod) this.directMod.stopDirect();
      },
    };
  }
}

export const engine = new EngineClient();
