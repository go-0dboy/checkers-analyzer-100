/* ============================================================
 * Обучение нейросети на партиях пользователя, v2.
 *
 * parseMultiPDN — разбор одного файла PDN 3.0 со сколь угодно
 * большим числом партий (каждая начинается с блока заголовков
 * [Tag "..."]). По каждой партии извлекаются позиции с исходом.
 *
 * trainNN — Adam-обучение с:
 *  — аугментацией rot180 (поворот доски на 180° — симметрия
 *    шашек: поле n ↔ 51−n, цвета меняются, исход инвертируется);
 *  — отложенной выборкой 90/10 и ранней остановкой по val-loss;
 *  — возвратом к лучшим весам;
 *  — уступкой потока каждые 256 примеров (UI не виснет).
 * ============================================================ */

import { applyMove, generateMoves, type Pos } from './core';
import { parsePDN } from './pdn';
import { NNUE, FEATURES, type NetMeta } from './nn';

export interface TrainingSample {
  b: Int8Array;
  /** исход с точки зрения белых: 1 — победа белых, 0 — чёрных, 0.5 — ничья */
  target: number;
}

export interface ParsedGames {
  games: number;
  samples: TrainingSample[];
  skipped: number;
}

const resultToTarget = (r: string | null): number | null => {
  if (r === '1-0') return 1;
  if (r === '0-1') return 0;
  if (r === '1-1') return 0.5;
  return null;
};

/** Разбор мульти-партийного PDN 3.0. */
export function parseMultiPDN(text: string): ParsedGames {
  const blocks = splitGames(text);
  const samples: TrainingSample[] = [];
  let games = 0;
  let skipped = 0;

  for (const block of blocks) {
    const doc = parsePDN(block);
    const target = resultToTarget(doc.result);
    if (target === null || doc.moves.length === 0) { skipped++; continue; }
    games++;

    let pos: Pos = doc.start;
    for (let i = 0; i < doc.moves.length; i++) {
      /* позиции миттельшпиля — каждую вторую, чтобы не переобучаться на дебюте */
      if (i % 2 === 0 && i > 0) samples.push({ b: pos.b.slice(), target });
      const legal = generateMoves(pos);
      const mv = legal.find((m) => m.from === doc.moves[i].from && m.to === doc.moves[i].to);
      if (!mv) break;
      pos = applyMove(pos, mv);
    }
    samples.push({ b: pos.b.slice(), target });
  }

  return { games, samples, skipped };
}

function splitGames(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const blocks: string[] = [];
  let cur: string[] = [];
  let inHeaders = false;

  for (const line of lines) {
    const isHeader = /^\s*\[\w+\s+"/.test(line);
    if (isHeader && cur.length > 0 && !inHeaders) {
      blocks.push(cur.join('\n'));
      cur = [];
    }
    inHeaders = isHeader;
    cur.push(line);
  }
  if (cur.some((l) => l.trim())) blocks.push(cur.join('\n'));
  return blocks.filter((b) => /\[\w+\s+"/.test(b));
}

/** Поворот доски на 180°: поле n ↔ 51−n, цвет фигур инвертируется. */
function rot180(b: Int8Array): Int8Array {
  const out = new Int8Array(51);
  for (let n = 1; n <= 50; n++) if (b[n] !== 0) out[51 - n] = -b[n] as Int8Array[number];
  return out;
}

/* детерминированный PRNG для воспроизводимого сплита */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrainProgress { epoch: number; loss: number; valLoss: number; stopped?: boolean }

/** Adam-обучение. Уступает поток между пакетами примеров. */
export async function trainNN(
  net: NNUE,
  samples: TrainingSample[],
  epochs: number,
  lr: number,
  onProgress: (p: TrainProgress) => void,
  token: { cancelled: boolean },
): Promise<NetMeta> {
  /* аугментация: каждая позиция + её rot180-двойник */
  const all: TrainingSample[] = [];
  for (const s of samples) {
    all.push(s);
    all.push({ b: rot180(s.b), target: 1 - s.target });
  }

  /* сплит 90/10 */
  const rnd = mulberry32(100500);
  const order = all.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const cut = Math.max(1, Math.floor(order.length * 0.9));
  const trainIdx = order.slice(0, cut);
  const valIdx = order.slice(cut);

  const feat = () => new Float32Array(FEATURES);
  const valSet = valIdx.map((i) => {
    const x = feat();
    net.features(all[i].b, x);
    return { x, target: all[i].target };
  });

  let bestVal = Infinity;
  let bestSnap: string | null = null;
  let patience = 0;

  for (let e = 1; e <= epochs; e++) {
    if (token.cancelled) break;

    const epochLr = lr * Math.pow(0.97, e - 1);
    for (let i = trainIdx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [trainIdx[i], trainIdx[j]] = [trainIdx[j], trainIdx[i]];
    }

    const x = feat();
    let sum = 0;
    let k = 0;
    for (const idx of trainIdx) {
      const s = all[idx];
      net.features(s.b, x);
      sum += net.train(x, s.target, epochLr);
      k++;
      if (k % 256 === 0) await new Promise((r) => { setTimeout(r, 0); });
      if (token.cancelled) break;
    }
    if (token.cancelled) break;

    const trainLoss = sum / Math.max(1, trainIdx.length);
    const valLoss = valSet.length > 0 ? net.evaluateLoss(valSet) : trainLoss;

    if (valLoss < bestVal - 1e-5) {
      bestVal = valLoss;
      bestSnap = net.serialize();
      patience = 0;
    } else {
      patience++;
    }

    onProgress({ epoch: e, loss: trainLoss, valLoss });
    if (patience >= 3) {
      onProgress({ epoch: e, loss: trainLoss, valLoss, stopped: true });
      break;
    }
    await new Promise((r) => { setTimeout(r, 0); });
  }

  /* возвращаем лучшие веса */
  if (bestSnap) {
    const best = NNUE.deserialize(bestSnap);
    if (best) {
      net.w1 = best.w1; net.b1 = best.b1; net.w2 = best.w2; net.b2 = best.b2;
    }
  }

  return {
    games: 0,
    positions: all.length,
    loss: bestVal === Infinity ? 0 : bestVal,
    date: new Date().toLocaleDateString('ru-RU'),
    v: 2,
  };
}
