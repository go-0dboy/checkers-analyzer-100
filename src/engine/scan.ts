/* ============================================================
 * Мост к Scan 3.1 (WASM).
 *
 * Scan — сильнейший открытый движок для международных шашек
 * (Fabien Letouzey); сборка RoepStoep/scan-wasm — это Scan 3.1,
 * адаптированный для клиентского анализа lidraughts (WASM/asm.js).
 *
 * Как подключить бинарник:
 *   bash scripts/build-scan.sh   →  public/scan/scan.js + scan.wasm
 * (скрипт берёт готовую сборку scan-wasm или компилирует Draughts64/scan-3.1
 *  через Emscripten; детали — в скрипте и public/scan/README.md)
 *
 * Если файлов нет — getScan() быстро отдаёт null, и приложение
 * работает на встроенном движке. Протокол: UCI-подобный
 * (position fen / go movetime / info … pv / bestmove), разбор
 * вывода терпимый; при неудаче — фолбэк на встроенный движок.
 * ============================================================ */

export interface ScanBest {
  from: number;
  to: number;
  /** оценка в сантипешках, с точки зрения белых (null — если не распознана) */
  scoreWhite: number | null;
  depth: number;
}

export interface ScanEngine {
  name: string;
  analyze(fen: string, timeMs: number): Promise<ScanBest | null>;
}

declare global {
  interface Window {
    ScanModule?: (opts: Record<string, unknown>) => Promise<ScanInstance>;
    Module?: (opts: Record<string, unknown>) => Promise<ScanInstance>;
  }
}

interface ScanInstance {
  FS: {
    mknod: (path: string, mode: number, dev: number) => void;
    mkdev: (path: string, ops: unknown) => void;
    write: (fd: number, data: Uint8Array, offset: number, len: number, pos: number) => number;
    open: (path: string, flags: string) => { fd: number };
    createPipe?: () => [number, number];
  };
  [k: string]: unknown;
}

const SCAN_JS = '/scan/scan.js';
let promise: Promise<ScanEngine | null> | null = null;

/** Возвращает движок Scan, если бинарник доступен; иначе null (один раз). */
export function getScan(): Promise<ScanEngine | null> {
  if (!promise) promise = load();
  return promise;
}

async function load(): Promise<ScanEngine | null> {
  try {
    const head = await fetch(SCAN_JS, { method: 'HEAD' });
    if (!head.ok) return null;
    await injectScript(SCAN_JS);
    const factory = window.ScanModule ?? window.Module;
    if (typeof factory !== 'function') return null;
    const scan = new ScanSession(factory);
    const ok = await scan.handshake();
    return ok ? scan : null;
  } catch {
    return null;
  }
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('scan.js load failed'));
    document.head.appendChild(s);
  });
}

class ScanSession implements ScanEngine {
  name = 'Scan 3.1 · WASM';
  private inst: ScanInstance | null = null;
  private lines: string[] = [];
  private stdinFd: number | null = null;
  private waiting: ((line: string) => void) | null = null;

  constructor(private factory: (opts: Record<string, unknown>) => Promise<ScanInstance>) {}

  async handshake(): Promise<boolean> {
    try {
      this.inst = await this.factory({
        print: (l: string) => this.onLine(String(l)),
        printErr: () => { /* диагностический вывод игнорируем */ },
        preRun: [(m: ScanInstance) => {
          /* интерактивный stdin: пайп, в который пишет send() */
          try {
            m.FS.mknod('/scan_in', 0o10000 | 0o666, 0);
            const f = m.FS.open('/scan_in', 'r+');
            this.stdinFd = f.fd;
          } catch {
            this.stdinFd = null;
          }
        }],
      });
      /* мягкая проверка: модуль поднялся и принимает команды */
      this.send('isready');
      return true;
    } catch {
      return false;
    }
  }

  private onLine(l: string): void {
    const line = l.trim();
    if (!line) return;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w(line);
    } else {
      this.lines.push(line);
      if (this.lines.length > 200) this.lines.shift();
    }
  }

  private send(line: string): void {
    if (this.inst && this.stdinFd !== null) {
      const data = new TextEncoder().encode(line + '\n');
      try {
        this.inst.FS.write(this.stdinFd, data, 0, data.length, 0);
      } catch { /* пайп мог закрыться */ }
    }
  }

  /** Ждём строку, пока pred не сработает, либо таймаут. */
  private waitLine(pred: (line: string) => boolean, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      const already = this.lines.findIndex(pred);
      if (already >= 0) {
        const l = this.lines.splice(already, 1)[0];
        resolve(l);
        return;
      }
      let done = false;
      const timer = window.setTimeout(() => {
        if (!done) { done = true; this.waiting = null; resolve(null); }
      }, timeoutMs);
      const handler = (line: string) => {
        if (done) return;
        if (pred(line)) {
          done = true;
          window.clearTimeout(timer);
          this.waiting = null;
          resolve(line);
        } else {
          this.waiting = handler; // продолжаем ждать следующую строку
        }
      };
      this.waiting = handler;
    });
  }

  async analyze(fen: string, timeMs: number): Promise<ScanBest | null> {
    if (!this.inst) return null;
    this.lines = [];
    this.send(`position fen ${fen}`);
    this.send(`go movetime ${Math.max(100, Math.round(timeMs))}`);

    const bestLine = await this.waitLine((l) => /^bestmove\b/i.test(l), timeMs + 4000);
    let from: number | null = null;
    let to: number | null = null;

    if (bestLine) {
      const m = /bestmove\s+(\d{1,2})\s*[xX/\\-]\s*(\d{1,2})/.exec(bestLine);
      if (m) { from = Number(m[1]); to = Number(m[2]); }
    }
    if (from === null || to === null) {
      /* фолбэк-разбор: первая строка вида «глубина оценка ходы…» */
      const info = this.lines.find((l) => /\d{1,2}[xX/-]\d{1,2}/.test(l));
      if (info) {
        const m = /(\d{1,2})\s*[xX/-]\s*(\d{1,2})/.exec(info);
        if (m) { from = Number(m[1]); to = Number(m[2]); }
      }
    }
    if (from === null || to === null) return null;

    /* оценка и глубина — из последней info-строки */
    let scoreWhite: number | null = null;
    let depth = 0;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      const dm = /\bdepth\s+(\d+)/.exec(l);
      if (dm) depth = Number(dm[1]);
      const sm = /score\s+(?:cp\s+)?(-?\d+)/.exec(l);
      if (sm) scoreWhite = Number(sm[1]);
      if (dm && sm) break;
    }

    return { from, to, scoreWhite, depth };
  }
}
