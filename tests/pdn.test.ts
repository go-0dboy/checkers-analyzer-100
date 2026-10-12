import { it, expect } from 'vitest';
import { parsePDNFull, toPDNFull, SAMPLE_PDN, splitGames } from '../src/engine/pdn';
import {
  serializeTree,
  deserializeTree,
  pathPositions,
  pathTo,
  resolvePath,
  validateTree,
  type TreeNode,
} from '../src/state/tree';
import { parseFen, generateMoves } from '../src/engine/core';
const shape = (n: TreeNode): unknown => ({
  move: n.move,
  comment: n.comment,
  nags: n.nags,
  children: n.children.map(shape),
});
it('roundtrips nested and first-move alternatives, NAG, root comments and escaped headers', () => {
  const text =
    '[Event "A \\"quoted\\" event"]\n{root} 1.32-28! (1.33-29 $6 (1.34-30) 19-23) 19-23 (1...18-23?) 2.28x19 14x23 *';
  const g = parsePDNFull(text);
  expect(g.error).toBeNull();
  const r = parsePDNFull(
    toPDNFull({ headers: g.headers, start: g.start, root: g.root, result: '*' }),
  );
  expect(r.error).toBeNull();
  expect(r.headers.Event).toBe(g.headers.Event);
  expect(shape(r.root)).toEqual(shape(g.root));
});
it('reads the bundled example', () => {
  const g = parsePDNFull(SAMPLE_PDN);
  expect(g.error).toBeNull();
  expect(g.movesParsed).toBe(5);
});
it('roundtrips a complete capture route and nonstandard start', () => {
  const g = parsePDNFull('[FEN "W:WK17:B9,20,21,28,30"]\n1.17x39x25x14x3x26 1-0');
  expect(g.error).toBeNull();
  const r = parsePDNFull(toPDNFull({ headers: {}, start: g.start, root: g.root, result: '1-0' }));
  expect(r.start).toEqual(g.start);
  expect(shape(r.root)).toEqual(shape(g.root));
});
it.each(['[FEN "bad"]\n1.32-28 *', '1.32x28 *', '1.32-28 (1.33-29', '1.32-28 )'])(
  'rejects corrupt input %s',
  (text) => expect(parsePDNFull(text).error).not.toBeNull(),
);
it('splits games without breaking blank-separated headers', () => {
  expect(
    splitGames('[Event "a"]\n\n[Result "1-0"]\n1.32-28 1-0\n[Event "b"]\n1.33-29 0-1'),
  ).toHaveLength(2);
});
it('reconstructs first move, connected paths and serialised trees', () => {
  const g = parsePDNFull('1.32-28 19-23 *'),
    child = g.root.children[0];
  const stored = pathTo(child)
    .slice(1)
    .map((n) => n.id);
  const path = resolvePath(g.root, stored);
  expect(path).toHaveLength(2);
  expect(pathPositions(g.start, path)[1].side).toBe(-1);
  expect(pathPositions(g.start, path)[1].b[28]).toBe(1);
  expect(resolvePath(g.root, ['bogus', child.id])).toHaveLength(1);
  const rebuilt = deserializeTree(serializeTree(g.root))!;
  expect(validateTree(g.start, rebuilt)).toBe(true);
  expect(shape(rebuilt)).toEqual(shape(g.root));
  rebuilt.children[0].move = { ...rebuilt.children[0].move!, to: 50 };
  expect(validateTree(g.start, rebuilt)).toBe(false);
});
it('rejects structurally corrupt storage', () => {
  expect(
    deserializeTree('{"move":null,"children":[{"move":{"from":0},"children":[]}]}'),
  ).toBeNull();
});
