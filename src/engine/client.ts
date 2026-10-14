import type { EngineResult, GoMsg } from './impl';
import type { Move } from './core';
export interface InfoMsg {
  id: number;
  depth: number;
  score: number;
  nodes: number;
}
export interface AnalyzeReq {
  fen: string;
  history: Move[];
  startFen: string;
  timeMs: number;
  maxDepth: number;
  humanStyle?: boolean;
}
export interface AnalyzeHandle {
  promise: Promise<EngineResult | null>;
  cancel: () => void;
}
export class EngineClient {
  private worker: Worker | null = null;
  private directMod: typeof import('./impl') | null = null;
  private seq = 0;
  private pending = new Map<
    number,
    {
      resolve: (r: EngineResult | null) => void;
      info?: (i: InfoMsg) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private workerAttempted = false;
  private startWorker(): void {
    this.workerAttempted = true;
    try {
      this.worker = new Worker(new URL('./impl.ts', import.meta.url), { type: 'module' });
      const worker = this.worker;
      this.worker.onmessage = (event) => {
        if (this.worker === worker) this.route(event.data);
      };
      this.worker.onerror = () => {
        if (this.worker !== worker) return;
        this.worker?.terminate();
        this.worker = null;
        this.finishAll();
      };
    } catch {
      this.worker = null;
    }
  }
  private finish(id: number, result: EngineResult | null): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(result);
  }
  private finishAll(): void {
    for (const id of this.pending.keys()) this.finish(id, null);
  }
  private route(message: { t: string; id: number }): void {
    if (message.t === 'info')
      this.pending.get(message.id)?.info?.(message as InfoMsg & { t: string });
    if (message.t === 'done') this.finish(message.id, message as EngineResult);
  }
  analyze(req: AnalyzeReq, onInfo?: (i: InfoMsg) => void): AnalyzeHandle {
    // One active search per client. Replacing it settles and actually stops the previous one.
    if (this.pending.size) this.reset();
    if (!this.workerAttempted) this.startWorker();
    const id = ++this.seq,
      msg: GoMsg = { t: 'go', id, ...req };
    const promise = new Promise<EngineResult | null>((resolve) => {
      const timer = setTimeout(
        () => {
          if (this.pending.has(id)) this.reset();
        },
        Math.max(1000, req.timeMs + 5000),
      );
      this.pending.set(id, { resolve, info: onInfo, timer });
      if (this.worker) {
        try {
          this.worker.postMessage(msg);
        } catch {
          this.reset();
        }
        return;
      }
      void (async () => {
        try {
          this.directMod ??= await import('./impl');
          if (!this.pending.has(id)) return;
          this.directMod.runDirect(msg, (message) =>
            this.route(message as { t: string; id: number }),
          );
        } catch {
          this.finish(id, null);
        }
      })();
    });
    return {
      promise,
      cancel: () => {
        if (this.pending.has(id)) this.reset();
      },
    };
  }
  private reset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.directMod?.stopDirect();
    this.finishAll();
    this.workerAttempted = false;
  }
  dispose(): void {
    this.workerAttempted = false;
    this.worker?.terminate();
    this.worker = null;
    this.directMod?.stopDirect();
    this.finishAll();
  }
}
export const engine = new EngineClient();
