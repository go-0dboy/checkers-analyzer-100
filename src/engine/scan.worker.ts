import { applyMove, parseFen, type Move } from './core';
import { hubPosition, hubMove, hubPairs, parseHubMove, parseHubPV } from './scan-protocol';
interface ScanModule {
  ccall: (name: string, result: string | null, types: string[], args: string[]) => void;
}
let module: ScanModule | null = null;
let ready = false;
let request: {
  id: number;
  pos: NonNullable<ReturnType<typeof parseFen>>;
  depth: number;
  scoreWhite: number | null;
  pv: Move[];
} | null = null;
const scope = self;
function send(command: string) {
  if (!module) throw new Error('Scan не загружен');
  module.ccall('scan_command', null, ['string'], [command]);
}
function line(text: string) {
  if (text === 'ready') {
    ready = true;
    scope.postMessage({ t: 'ready' });
    return;
  }
  if (text.startsWith('error')) {
    scope.postMessage({ t: 'error', error: text });
    return;
  }
  if (!request) return;
  const pairs = hubPairs(text);
  if (text.startsWith('info')) {
    if (pairs.depth) request.depth = Number(pairs.depth);
    if (pairs.score && Number.isFinite(Number(pairs.score)))
      request.scoreWhite = Math.round(Number(pairs.score) * 100) * request.pos.side;
    if (pairs.pv) request.pv = parseHubPV(pairs.pv, request.pos);
  }
  if (text.startsWith('done')) {
    const move = pairs.move ? parseHubMove(pairs.move, request.pos) : null;
    scope.postMessage({
      t: 'done',
      id: request.id,
      result: move
        ? {
            move,
            scoreWhite: request.scoreWhite,
            depth: request.depth,
            pv: request.pv.length ? request.pv : [move],
          }
        : null,
    });
    request = null;
  }
}
scope.onmessage = async (event: MessageEvent) => {
  try {
    const d = event.data;
    if (d.t === 'boot') {
      const imported = await import(/* @vite-ignore */ d.url);
      module = await imported.default({
        locateFile: (file: string) => new URL(file, d.url).href,
        print: line,
        printErr: (text: string) => scope.postMessage({ t: 'diagnostic', text }),
        noExitRuntime: true,
      });
      send('hub');
      send('set-param name=variant value=normal');
      send(`set-param name=eval value=${d.eval}`);
      send('set-param name=bb-size value=0');
      send('set-param name=tt-size value=18');
      send('init');
    } else if (d.t === 'go') {
      if (!ready || request) throw new Error('Scan занят или не готов');
      const pos = parseFen(d.fen),
        start = parseFen(d.startFen);
      if (!pos || !start) throw new Error('Некорректный FEN');
      request = { id: d.id, pos, depth: 0, scoreWhite: null, pv: [] };
      let current = start;
      const history = (d.history as Move[]).map((move) => {
        const text = hubMove(move);
        current = applyMove(current, move);
        return text;
      });
      send(`pos pos=${hubPosition(start)}${history.length ? ` moves="${history.join(' ')}"` : ''}`);
      send(`level move-time=${Math.max(0.1, d.timeMs / 1000)} depth=40`);
      send('go think');
    }
  } catch (error) {
    scope.postMessage({
      t: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
