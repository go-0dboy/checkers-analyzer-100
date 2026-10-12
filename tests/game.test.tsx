// @vitest-environment jsdom
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useGame } from '../src/state/useGame';
import { DEFAULT_SETTINGS } from '../src/state/settings';
const mocks = vi.hoisted(() => ({ cancel: vi.fn(), analyze: vi.fn() }));
vi.mock('../src/engine/client', () => ({ engine: { setNet: vi.fn(), analyze: mocks.analyze } }));
vi.mock('../src/engine/scan', () => ({ getScan: () => Promise.resolve(null) }));
vi.mock('../src/state/db', () => ({
  listGames: () => Promise.resolve([]),
  saveGame: vi.fn(),
  deleteGame: vi.fn(),
}));
beforeEach(() => {
  localStorage.clear();
  mocks.cancel.mockClear();
  mocks.analyze.mockImplementation(() => ({
    promise: new Promise(() => {}),
    cancel: mocks.cancel,
  }));
});
afterEach(cleanup);
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
