import { it, expect, vi, afterEach } from 'vitest';
import {
  hubPosition,
  hubPairs,
  hubMove,
  parseHubMove,
  parseHubPV,
} from '../src/engine/scan-protocol';
import { ScanSession } from '../src/engine/scan';
import { parseFen, generateMoves } from '../src/engine/core';
const p = parseFen('W:WK23:BK28')!;
it('matches Hub board encoding and capture victims', () => {
  expect(hubPosition(p)).toHaveLength(51);
  expect(hubPosition(p)[23]).toBe('W');
  expect(hubPosition(p)[28]).toBe('B');
  const m = generateMoves(p)[0],
    text = hubMove(m);
  expect(text).toBe(`23x${m.to}x28`);
  expect(parseHubMove(text, p)).toEqual(m);
  expect(parseHubPV(text, p)).toEqual([m]);
});
it('retains info score, depth and quoted PV', () =>
  expect(hubPairs('info depth=8 score=-0.32 pv="32-28 17-22"')).toEqual({
    depth: '8',
    score: '-0.32',
    pv: '32-28 17-22',
  }));
it('refuses invalid Hub captures', () => expect(parseHubMove('23x32x29', p)).toBeNull());
it('requires a real ready response', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'Worker',
    class {
      postMessage() {}
      terminate() {}
    },
  );
  const scan = new ScanSession('https://example.test/scan.js', 'pattern');
  const promise = scan.boot();
  await vi.advanceTimersByTimeAsync(10001);
  expect(await promise).toBe(false);
  scan.dispose();
});
it('settles an aborted search and terminates its Worker', async () => {
  let terminated = false;
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage(m: { t: string }) {
        if (m.t === 'boot') queueMicrotask(() => this.onmessage?.({ data: { t: 'ready' } }));
      }
      terminate() {
        terminated = true;
      }
    },
  );
  const scan = new ScanSession('https://example.test/scan.js', 'pattern'),
    controller = new AbortController();
  await scan.boot();
  const promise = scan.analyze('W:WK23:BK28', 100, controller.signal);
  await Promise.resolve();
  controller.abort();
  expect(await promise).toBeNull();
  expect(terminated).toBe(true);
  scan.dispose();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('ignores late errors from a disposed Worker and forwards depth limits', async () => {
  class Worker {
    static all: Worker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    messages: Record<string, unknown>[] = [];
    constructor() {
      Worker.all.push(this);
    }
    postMessage(m: Record<string, unknown>) {
      this.messages.push(m);
      if (m.t === 'boot') queueMicrotask(() => this.onmessage?.({ data: { t: 'ready' } }));
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', Worker);
  const scan = new ScanSession('https://example.test/scan.js', 'pattern');
  await scan.boot();
  const old = Worker.all[0];
  scan.dispose();
  await scan.boot();
  const pending = scan.analyze('W:WK23:BK28', 100, undefined, [], 'W:WK23:BK28', 3);
  await Promise.resolve();
  old.onerror?.();
  const worker = Worker.all[1];
  expect(worker.messages.at(-1)).toMatchObject({ t: 'go', maxDepth: 3 });
  worker.onmessage?.({ data: { t: 'done', id: 1, result: { depth: 3 } } });
  expect(await pending).toMatchObject({ depth: 3 });
  scan.dispose();
});

it('settles a search if posting to the Worker fails', async () => {
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage(m: { t: string }) {
        if (m.t === 'boot') queueMicrotask(() => this.onmessage?.({ data: { t: 'ready' } }));
        else throw new Error('postMessage failed');
      }
      terminate() {}
    },
  );
  const scan = new ScanSession('https://example.test/scan.js', 'pattern');
  expect(await scan.analyze('W:WK23:BK28', 100)).toBeNull();
  scan.dispose();
});
