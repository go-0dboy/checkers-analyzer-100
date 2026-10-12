import { it, expect } from 'vitest';
import { NNUE, FEATURES, HIDDEN } from '../src/engine/nn';
import {
  parseMultiPDN,
  splitSamples,
  rot180,
  trainNN,
  type TrainingSample,
} from '../src/engine/nntrain';
import { parseFen } from '../src/engine/core';
const sample = (id: string, target = 1): TrainingSample => ({
  b: parseFen('W:W31:B20')!.b,
  side: 1,
  target,
  gameId: id,
});
it('keeps every game in exactly one split before augmentation', () => {
  const all = Array.from({ length: 30 }, (_, i) => ({ ...sample(`g${i % 10}`), target: i % 2 })),
    s = splitSamples(all);
  const ids = (values: TrainingSample[]) => new Set(values.map((v) => v.gameId));
  for (const id of ids(s.train)) {
    expect(ids(s.validation).has(id)).toBe(false);
    expect(ids(s.test).has(id)).toBe(false);
  }
  for (const id of ids(s.validation)) expect(ids(s.test).has(id)).toBe(false);
  expect(s.train.length + s.validation.length + s.test.length).toBe(all.length);
  expect(splitSamples(all)).toEqual(s);
});
it('rejects insufficient game-level holdout', () =>
  expect(() => splitSamples([sample('a'), sample('b')])).toThrow(/минимум 3/));
it('ignores invalid and duplicate PDN games', () => {
  const p = '[Result "1-0"]\n1.32-28 1-0';
  const parsed = parseMultiPDN(p + '\n' + p + '\n[Result "0-1"]\n1.32-50 0-1');
  expect(parsed.games).toBe(1);
  expect(parsed.skipped).toBe(2);
});
it('features include side to move and rotation is reversible', () => {
  const net = new NNUE(),
    p = sample('a'),
    a = new Float32Array(FEATURES),
    b = new Float32Array(FEATURES);
  net.features(p.b, a, 1);
  net.features(p.b, b, -1);
  expect(a[200]).toBe(1);
  expect(b[200]).toBe(0);
  expect(rot180(rot180(p.b))).toEqual(p.b);
});
it('seeds training reproducibly and validates model dimensions and finite weights', () => {
  const a = new NNUE(),
    b = new NNUE();
  expect(a.serialize()).toBe(b.serialize());
  expect(NNUE.deserialize(a.serialize())).not.toBeNull();
  const broken = JSON.parse(a.serialize());
  broken.w1 = [];
  expect(NNUE.deserialize(JSON.stringify(broken))).toBeNull();
  broken.w1 = Array(FEATURES * HIDDEN).fill(null);
  expect(NNUE.deserialize(JSON.stringify(broken))).toBeNull();
});
it('returns finite independent test loss', async () => {
  const meta = await trainNN(
    new NNUE(),
    [sample('a'), sample('b', 0), sample('c', 0.5)],
    2,
    0.003,
    () => {},
    { cancelled: false },
  );
  expect(meta.games).toBe(3);
  expect(meta.testGames).toBe(1);
  expect(Number.isFinite(meta.testLoss)).toBe(true);
  expect(meta.v).toBe(3);
});
