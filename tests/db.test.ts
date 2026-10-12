import 'fake-indexeddb/auto';
import { it, expect, vi } from 'vitest';
import { saveGame, listGames, deleteGame, type DbGame } from '../src/state/db';
const game: DbGame = {
  id: 'test',
  name: 'test',
  date: '2026-10-12',
  white: 'w',
  black: 'b',
  event: 'e',
  result: '*',
  startFen: 'W:W31-50:B1-20',
  treeJson: '{}',
  moves: 0,
  annotated: false,
};
it('saved games persist after transaction completion and can be deleted', async () => {
  await saveGame(game);
  expect(await listGames()).toContainEqual(game);
  await deleteGame(game.id);
  expect(await listGames()).not.toContainEqual(game);
});
it('rejects a transaction that aborts after put success', async () => {
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof put>
  ) {
    const req = put.apply(this, args);
    req.addEventListener('success', () => this.transaction.abort());
    return req;
  });
  try {
    await expect(saveGame({ ...game, id: 'aborted' })).rejects.toThrow(/отменена/);
  } finally {
    spy.mockRestore();
  }
  expect((await listGames()).some((g) => g.id === 'aborted')).toBe(false);
});
