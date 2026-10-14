// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useGame } from '../src/state/useGame';
import { DEFAULT_SETTINGS } from '../src/state/settings';
const mocks = vi.hoisted(() => ({ cancel: vi.fn(), analyze: vi.fn(), getScan: vi.fn() }));
vi.mock('../src/engine/client', () => ({ engine: { analyze: mocks.analyze } }));
vi.mock('../src/engine/scan', () => ({ getScan: mocks.getScan }));
vi.mock('../src/state/db', () => ({
  listGames: () => Promise.resolve([]),
  saveGame: vi.fn(),
  deleteGame: vi.fn(),
}));
beforeEach(() => {
  localStorage.clear();
  mocks.cancel.mockClear();
  mocks.analyze.mockClear();
  mocks.getScan.mockReset().mockResolvedValue(null);
  mocks.analyze.mockImplementation(() => ({
    promise: new Promise(() => {}),
    cancel: mocks.cancel,
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('plays first move, navigates and restores the exact saved position', async () => {
  const s = { ...DEFAULT_SETTINGS, useScan: false };
  const h = renderHook(() => useGame(s));
  await act(async () => {
    h.result.current.playFromTo(32, 28);
  });
  expect(h.result.current.pos.side).toBe(-1);
  expect(h.result.current.pos.b[28]).toBe(1);
  expect(h.result.current.positions).toHaveLength(2);
  await act(async () => h.result.current.playFromTo(19, 23));
  expect(h.result.current.pos.side).toBe(1);
  await act(async () => h.result.current.prev());
  expect(h.result.current.pos.side).toBe(-1);
  await act(async () => h.result.current.next());
  expect(h.result.current.pos.b[23]).toBe(-1);
  h.unmount();
  const restored = renderHook(() => useGame(s));
  expect(restored.result.current.pos.b[23]).toBe(-1);
  expect(restored.result.current.path).toHaveLength(3);
});
it('cancels the obsolete analysis when position changes and on unmount', async () => {
  const h = renderHook(() => useGame({ ...DEFAULT_SETTINGS, useScan: false }));
  await act(async () => {});
  await act(async () => h.result.current.playFromTo(32, 28));
  expect(mocks.cancel).toHaveBeenCalled();
  const calls = mocks.cancel.mock.calls.length;
  h.unmount();
  expect(mocks.cancel.mock.calls.length).toBeGreaterThan(calls);
});
it('rejects corrupt import without replacing a current game', async () => {
  const h = renderHook(() => useGame({ ...DEFAULT_SETTINGS, useScan: false }));
  await act(async () => h.result.current.playFromTo(32, 28));
  let error: string | null = null;
  await act(async () => {
    error = h.result.current.loadPDNText('1.32-28 19-50 *');
  });
  expect(error).not.toBeNull();
  expect(h.result.current.pos.side).toBe(-1);
});

it('opens both ambiguous capture routes from board clicks', async () => {
  const h = renderHook(() => useGame({ ...DEFAULT_SETTINGS, useScan: false }));
  await act(async () => h.result.current.loadFenText('W:WK18:B14,27,35,37-38,40-41,49'));
  await act(async () => h.result.current.clickSquare(18));
  await act(async () => h.result.current.clickSquare(45));
  expect(h.result.current.routeChoices).toHaveLength(2);
  expect(h.result.current.path).toHaveLength(1);
  const route = h.result.current.routeChoices[1];
  await act(async () => h.result.current.chooseRoute(route));
  expect(h.result.current.lastMove).toEqual(route);
  expect(h.result.current.pos.b[45]).toBe(2);
  for (const square of route.captures) expect(h.result.current.pos.b[square]).toBe(0);
});

it('editing annotations preserves positions and the running analysis', async () => {
  const h = renderHook(() => useGame({ ...DEFAULT_SETTINGS, useScan: false }));
  await act(async () => h.result.current.playFromTo(32, 28));
  const pos = h.result.current.pos,
    positions = h.result.current.positions;
  const calls = mocks.analyze.mock.calls.length,
    cancels = mocks.cancel.mock.calls.length;
  for (const text of ['a', 'ab', 'abc']) await act(async () => h.result.current.setComment(text));
  await act(async () => h.result.current.toggleNag(1));
  expect(h.result.current.pos).toBe(pos);
  expect(h.result.current.positions).toBe(positions);
  expect(mocks.analyze).toHaveBeenCalledTimes(calls);
  expect(mocks.cancel).toHaveBeenCalledTimes(cancels);
  expect(h.result.current.exportPDN()).toContain('{abc}');
  await act(async () => h.result.current.prev());
  await act(async () => h.result.current.next());
  expect(h.result.current.pos).toBe(pos);
});

it('debounces annotation saves and flushes the latest comment on pagehide', async () => {
  vi.useFakeTimers();
  const h = renderHook(() => useGame({ ...DEFAULT_SETTINGS, useScan: false }));
  await act(async () => h.result.current.playFromTo(32, 28));
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  for (const text of ['a', 'ab', 'abc']) await act(async () => h.result.current.setComment(text));
  expect(writes).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(300));
  expect(writes).toHaveBeenCalledTimes(1);
  await act(async () => h.result.current.setComment('latest'));
  await act(async () => window.dispatchEvent(new Event('pagehide')));
  expect(JSON.parse(localStorage.getItem('sk100.game.v4')!).treeJson).toContain('latest');
});

it('does not load Scan while disabled and starts it when enabled', async () => {
  const h = renderHook(({ scan }) => useGame({ ...DEFAULT_SETTINGS, useScan: scan }), {
    initialProps: { scan: false },
  });
  await act(async () => {});
  expect(mocks.getScan).not.toHaveBeenCalled();
  await act(async () => h.rerender({ scan: true }));
  expect(mocks.getScan).toHaveBeenCalledTimes(1);
});

it('does not restart Scan when its unsupported style option changes', async () => {
  const h = renderHook(
    ({ style }) => useGame({ ...DEFAULT_SETTINGS, useScan: true, humanStyle: style }),
    { initialProps: { style: false } },
  );
  await act(async () => {});
  const calls = mocks.analyze.mock.calls.length;
  await act(async () => h.rerender({ style: true }));
  expect(mocks.analyze).toHaveBeenCalledTimes(calls);
  expect(mocks.getScan).toHaveBeenCalledTimes(1);
});

it('protects unreadable saved data until an explicit new game', async () => {
  const raw = '{unreadable saved game';
  localStorage.setItem('sk100.game.v4', raw);
  const h = renderHook(() => useGame({ ...DEFAULT_SETTINGS, useScan: false }));
  expect(h.result.current.recovery).toBe(raw);
  await act(async () => h.result.current.playFromTo(32, 28));
  expect(localStorage.getItem('sk100.game.v4')).toBe(raw);
  h.unmount();
  expect(localStorage.getItem('sk100.game.v4')).toBe(raw);
  const next = renderHook(() => useGame({ ...DEFAULT_SETTINGS, useScan: false }));
  await act(async () => next.result.current.newGame());
  expect(next.result.current.recovery).toBeNull();
  expect(() => JSON.parse(localStorage.getItem('sk100.game.v4')!)).not.toThrow();
});

it('reports failed analysis and allows retry', async () => {
  mocks.analyze.mockReturnValue({ promise: Promise.resolve(null), cancel: mocks.cancel });
  const h = renderHook(() => useGame({ ...DEFAULT_SETTINGS, useScan: false }));
  await act(async () => {});
  expect(h.result.current.engine.thinking).toBe(false);
  expect(h.result.current.engine.error).toContain('Анализ не завершён');
  await act(async () => h.result.current.retryAnalysis());
  expect(mocks.analyze).toHaveBeenCalledTimes(2);
});

it('exports the selected game result', async () => {
  const h = renderHook(() => useGame({ ...DEFAULT_SETTINGS, useScan: false }));
  await act(async () => h.result.current.setResult('1-1'));
  expect(h.result.current.exportPDN()).toContain('[Result "1-1"]');
  await act(async () => h.result.current.setResult('invalid'));
  expect(h.result.current.result).toBe('1-1');
});

it('rejects extending a maximum-depth line without mutating it', async () => {
  const h = renderHook(() => useGame({ ...DEFAULT_SETTINGS, useScan: false }));
  const pdn =
    '[FEN "W:WK46:BK1"]\n' +
    Array.from({ length: 500 }, (_, i) => ['46-41', '1-6', '41-46', '6-1'][i % 4]).join(' ') +
    ' *';
  await act(async () => h.result.current.loadPDNText(pdn));
  let accepted = true;
  await act(async () => {
    accepted = h.result.current.playFromTo(46, 41);
  });
  expect(accepted).toBe(false);
  expect(h.result.current.path).toHaveLength(501);
  expect(h.result.current.hint).toContain('500');
});
