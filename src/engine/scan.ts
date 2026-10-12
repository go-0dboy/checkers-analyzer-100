/** Optional, verified Scan Hub/WASM adapter. Runs entirely in a Worker. */
import type { Move } from './core';
export interface ScanBest {
  move: Move;
  scoreWhite: number | null;
  depth: number;
  pv: Move[];
}
export interface ScanEngine {
  name: string;
  analyze(
    fen: string,
    timeMs: number,
    signal?: AbortSignal,
    history?: Move[],
    startFen?: string,
  ): Promise<ScanBest | null>;
}
let promise: Promise<ScanEngine | null> | null = null;
export function getScan(): Promise<ScanEngine | null> {
  return (promise ??= (async () => {
    try {
      const base = new URL(
        `${(import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL}scan/`,
        location.href,
      );
      const response = await fetch(new URL('manifest.json', base));
      if (!response.ok) return null;
      const manifest = await response.json();
      if (manifest.protocol !== 'hub' || !['pst', 'pattern'].includes(manifest.eval)) return null;
      const session = new ScanSession(new URL('scan.js', base).href, manifest.eval);
      if (!(await session.boot())) {
        session.dispose();
        return null;
      }
      return session;
    } catch {
      return null;
    }
  })());
}
export class ScanSession implements ScanEngine {
  name: string;
  private worker: Worker | null = null;
  private bootPromise: Promise<boolean> | null = null;
  private bootFinish: ((ok: boolean) => void) | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: { id: number; finish: (result: ScanBest | null) => void } | null = null;
  private seq = 0;
  constructor(
    private url: string,
    private evalMode: string,
  ) {
    this.name = `Scan 3.1 · ${evalMode.toUpperCase()}`;
  }
  boot(): Promise<boolean> {
    if (this.bootPromise) return this.bootPromise;
    this.bootPromise = new Promise((resolve) => {
      this.bootFinish = resolve;
      this.bootTimer = setTimeout(() => this.dispose(), 10000);
      try {
        const worker = new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' });
        this.worker = worker;
        worker.onmessage = (event) => {
          if (this.worker !== worker) return;
          const d = event.data;
          if (d.t === 'ready') {
            if (this.bootTimer) clearTimeout(this.bootTimer);
            this.bootTimer = null;
            this.bootFinish?.(true);
            this.bootFinish = null;
          }
          if (d.t === 'error') this.dispose();
          const pending = this.pending;
          if (d.t === 'done' && pending && pending.id === d.id) pending.finish(d.result);
        };
        worker.onerror = () => this.dispose();
        worker.postMessage({ t: 'boot', url: this.url, eval: this.evalMode });
      } catch {
        this.dispose();
      }
    });
    return this.bootPromise;
  }
  async analyze(
    fen: string,
    timeMs: number,
    signal?: AbortSignal,
    history: Move[] = [],
    startFen = fen,
  ): Promise<ScanBest | null> {
    if (signal?.aborted) return null;
    if (this.pending) this.dispose();
    const id = ++this.seq;
    const abortBoot = () => this.dispose();
    signal?.addEventListener('abort', abortBoot, { once: true });
    const ready = await this.boot();
    signal?.removeEventListener('abort', abortBoot);
    if (!ready || signal?.aborted || id !== this.seq || !this.worker) return null;
    return new Promise((resolve) => {
      const abort = () => this.dispose();
      const timer = setTimeout(abort, Math.max(1000, timeMs + 5000));
      const finish = (result: ScanBest | null) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.pending = null;
        resolve(result);
      };
      this.pending = { id, finish };
      signal?.addEventListener('abort', abort, { once: true });
      this.worker!.postMessage({ t: 'go', id, fen, startFen, history, timeMs });
    });
  }
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.bootPromise = null;
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.bootTimer = null;
    this.bootFinish?.(false);
    this.bootFinish = null;
    this.pending?.finish(null);
    this.pending = null;
  }
}
