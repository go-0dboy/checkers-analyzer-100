import { it, expect, vi, afterEach } from 'vitest';
import { EngineClient } from '../src/engine/client';
class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  messages: unknown[] = [];
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.all = [];
});
const req = {
  fen: 'W:W31-50:B1-20',
  startFen: 'W:W31-50:B1-20',
  history: [],
  timeMs: 100,
  maxDepth: 2,
};
it('cancellation settles the promise and stops the worker', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new EngineClient(),
    handle = client.analyze(req);
  handle.cancel();
  expect(await handle.promise).toBeNull();
  expect(FakeWorker.all[0].terminated).toBe(true);
  client.dispose();
});
it('replacing a search settles the older request and ignores late responses', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new EngineClient(),
    old = client.analyze(req),
    worker = FakeWorker.all[0],
    next = client.analyze(req);
  expect(await old.promise).toBeNull();
  worker.onmessage?.({ data: { t: 'done', id: 1 } });
  next.cancel();
  expect(await next.promise).toBeNull();
  client.dispose();
});
it('worker errors settle every request', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new EngineClient(),
    h = client.analyze(req);
  FakeWorker.all[0].onerror?.();
  expect(await h.promise).toBeNull();
  client.dispose();
});

it('late errors from a replaced worker cannot cancel the new search', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new EngineClient();
  const old = client.analyze(req);
  const oldWorker = FakeWorker.all[0];
  const next = client.analyze(req);
  expect(await old.promise).toBeNull();
  oldWorker.onerror?.();
  const worker = FakeWorker.all[1];
  worker.onmessage?.({ data: { t: 'done', id: 2, best: null } });
  expect(await next.promise).toMatchObject({ id: 2 });
  client.dispose();
});
