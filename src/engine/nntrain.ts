/** Game-level train/validation/test split BEFORE augmentation. */
import { applyMove, boardToFen, moveKey, type Move, type Side } from './core';
import { parsePDN, splitGames } from './pdn';
import { NNUE, FEATURES, type NetMeta } from './nn';
export interface TrainingSample {
  b: Int8Array;
  side: Side;
  target: number;
  gameId: string;
}
export interface ParsedGames {
  games: number;
  samples: TrainingSample[];
  skipped: number;
}
export function parseMultiPDN(text: string): ParsedGames {
  const samples: TrainingSample[] = [];
  let games = 0,
    skipped = 0;
  const seen = new Set<string>();
  for (const block of splitGames(text)) {
    const doc = parsePDN(block);
    const target =
      doc.result === '1-0' ? 1 : doc.result === '0-1' ? 0 : doc.result === '1-1' ? 0.5 : null;
    if (doc.error || target === null || !doc.moves.length) {
      skipped++;
      continue;
    }
    const rotateMove = (m: Move): Move => ({
      ...m,
      from: 51 - m.from,
      to: 51 - m.to,
      path: m.path.map((n) => 51 - n),
      captures: m.captures.map((n) => 51 - n),
    });
    const original =
      boardToFen(doc.start.b, doc.start.side) + '/' + doc.moves.map(moveKey).join('/');
    const rotated =
      boardToFen(rot180(doc.start.b), -doc.start.side as Side) +
      '/' +
      doc.moves.map(rotateMove).map(moveKey).join('/');
    const gameId = [original, rotated].sort()[0];
    if (seen.has(gameId)) {
      skipped++;
      continue;
    }
    seen.add(gameId);
    games++;
    let pos = doc.start;
    for (let i = 0; i < doc.moves.length; i++) {
      if (i % 2 === 0 && i > 0) samples.push({ b: pos.b.slice(), side: pos.side, target, gameId });
      pos = applyMove(pos, doc.moves[i]);
    }
    samples.push({ b: pos.b.slice(), side: pos.side, target, gameId });
  }
  return { games, samples, skipped };
}
export function rot180(b: Int8Array): Int8Array {
  const out = new Int8Array(51);
  for (let n = 1; n <= 50; n++) out[51 - n] = -b[n];
  return out;
}
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function shuffle<T>(values: T[], rnd: () => number): T[] {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function splitSamples(
  samples: TrainingSample[],
  seed = 100500,
): { train: TrainingSample[]; validation: TrainingSample[]; test: TrainingSample[] } {
  const ids = shuffle([...new Set(samples.map((s) => s.gameId))].sort(), random(seed));
  if (ids.length < 3)
    throw new Error(
      'Для независимых train/validation/test нужны минимум 3 разные корректные партии с результатом',
    );
  const held = Math.max(1, Math.floor(ids.length * 0.1));
  const test = new Set(ids.slice(0, held)),
    validation = new Set(ids.slice(held, held * 2));
  return {
    train: samples.filter((s) => !test.has(s.gameId) && !validation.has(s.gameId)),
    validation: samples.filter((s) => validation.has(s.gameId)),
    test: samples.filter((s) => test.has(s.gameId)),
  };
}
function augment(samples: TrainingSample[]): TrainingSample[] {
  return samples.flatMap((s) => [
    s,
    { ...s, b: rot180(s.b), side: -s.side as Side, target: 1 - s.target },
  ]);
}
export interface TrainProgress {
  epoch: number;
  loss: number;
  valLoss: number;
  stopped?: boolean;
}
export async function trainNN(
  net: NNUE,
  samples: TrainingSample[],
  epochs: number,
  lr: number,
  onProgress: (p: TrainProgress) => void,
  token: { cancelled: boolean },
): Promise<NetMeta> {
  const seed = 100500,
    split = splitSamples(samples, seed),
    train = augment(split.train);
  const features = (sample: TrainingSample) => {
    const x = new Float32Array(FEATURES);
    net.features(sample.b, x, sample.side);
    return { x, target: sample.target };
  };
  const validation = split.validation.map(features),
    test = split.test.map(features),
    rnd = random(seed);
  let bestVal = Infinity,
    bestSnap: string | null = null,
    patience = 0;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    if (token.cancelled) break;
    let sum = 0,
      k = 0;
    for (const sample of shuffle(train, rnd)) {
      const { x, target } = features(sample);
      sum += net.train(x, target, lr * Math.pow(0.97, epoch - 1));
      if (++k % 64 === 0) await new Promise((r) => setTimeout(r, 0));
      if (token.cancelled) break;
    }
    if (token.cancelled) break;
    const loss = sum / train.length,
      valLoss = net.evaluateLoss(validation);
    if (valLoss < bestVal - 1e-5) {
      bestVal = valLoss;
      bestSnap = net.serialize();
      patience = 0;
    } else patience++;
    onProgress({ epoch, loss, valLoss, stopped: patience >= 3 });
    if (patience >= 3) break;
    await new Promise((r) => setTimeout(r, 0));
  }
  if (bestSnap) {
    const best = NNUE.deserialize(bestSnap)!;
    net.w1 = best.w1;
    net.b1 = best.b1;
    net.w2 = best.w2;
    net.b2 = best.b2;
  }
  return {
    games: new Set(samples.map((s) => s.gameId)).size,
    positions: samples.length,
    loss: Number.isFinite(bestVal) ? bestVal : 0,
    testLoss: net.evaluateLoss(test),
    trainGames: new Set(split.train.map((s) => s.gameId)).size,
    validationGames: new Set(split.validation.map((s) => s.gameId)).size,
    testGames: new Set(split.test.map((s) => s.gameId)).size,
    date: new Date().toLocaleDateString('ru-RU'),
    v: 3,
    seed,
  };
}
