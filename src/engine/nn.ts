/** Experimental result-trained MLP v3: pieces + side, 64 ReLU units, sigmoid.
 * The output estimates game-result targets; it is not a calibrated win probability.
 * Training uses seeded initialisation, Adam, and game-level holdout in nntrain.ts.
 */

import { WHITE, type Pos } from './core';

export const FEATURES = 201; // 50 полей × 4 типа фигур + очередь хода
export const HIDDEN = 64;
export const SCALE = 500; // (p − 0.5) × SCALE ≈ сантипешки
const CLIP = 2; // клип градиента по выходу

export interface NetMeta {
  games: number;
  positions: number;
  loss: number;
  date: string;
  v: 3;
  testLoss?: number;
  trainGames?: number;
  validationGames?: number;
  testGames?: number;
  seed?: number;
}

export class NNUE {
  w1 = new Float32Array(FEATURES * HIDDEN);
  b1 = new Float32Array(HIDDEN);
  w2 = new Float32Array(HIDDEN);
  b2 = 0;

  /* Adam-моменты */
  private mw1 = new Float32Array(FEATURES * HIDDEN);
  private vw1 = new Float32Array(FEATURES * HIDDEN);
  private mb1 = new Float32Array(HIDDEN);
  private vb1 = new Float32Array(HIDDEN);
  private mw2 = new Float32Array(HIDDEN);
  private vw2 = new Float32Array(HIDDEN);
  private mb2 = 0;
  private vb2 = 0;
  private t = 0;

  private hid = new Float32Array(HIDDEN);

  constructor(private seed = 100500) {
    this.init();
  }

  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private init(): void {
    const s1 = Math.sqrt(2 / FEATURES);
    for (let i = 0; i < this.w1.length; i++) this.w1[i] = (this.random() * 2 - 1) * s1;
    const s2 = Math.sqrt(2 / HIDDEN);
    for (let i = 0; i < this.w2.length; i++) this.w2[i] = (this.random() * 2 - 1) * s2;
    this.b1.fill(0);
    this.b2 = 0;
  }

  /** Бинарный вектор признаков доски. */
  features(b: Int8Array, out: Float32Array, side: 1 | -1 = 1): void {
    out.fill(0);
    out[200] = side === 1 ? 1 : 0;
    for (let n = 1; n <= 50; n++) {
      const v = b[n];
      if (v === 0) continue;
      const t = v === 1 ? 0 : v === 2 ? 1 : v === -1 ? 2 : 3;
      out[t * 50 + (n - 1)] = 1;
    }
  }

  /** Прямой проход: вероятность победы белых [0..1]. */
  forward(x: Float32Array): number {
    for (let j = 0; j < HIDDEN; j++) {
      let s = this.b1[j];
      const base = j * FEATURES;
      for (let i = 0; i < FEATURES; i++) {
        const xi = x[i];
        if (xi !== 0) s += this.w1[base + i] * xi;
      }
      this.hid[j] = s > 0 ? s : 0;
    }
    let o = this.b2;
    for (let j = 0; j < HIDDEN; j++) o += this.w2[j] * this.hid[j];
    if (o > 12) o = 12;
    else if (o < -12) o = -12;
    return 1 / (1 + Math.exp(-o));
  }

  /** Оценка в сантипешках с точки зрения стороны, делающей ход. */
  evalFor(pos: Pos, x: Float32Array): number {
    const p = this.forward(x);
    const whiteScore = (p - 0.5) * SCALE;
    return pos.side === WHITE ? whiteScore : -whiteScore;
  }

  /** Один обучающий шаг (Adam, MSE по сигмоид-выходу). Возвращает squared error. */
  train(x: Float32Array, target: number, lr: number): number {
    const p = this.forward(x);
    const err = p - target;
    let dOut = err * p * (1 - p);
    if (dOut > CLIP * 0.25) dOut = CLIP * 0.25;
    else if (dOut < -CLIP * 0.25) dOut = -CLIP * 0.25;

    this.t++;
    const t = this.t;
    const b1c = 1 - Math.pow(0.9, t);
    const b2c = 1 - Math.pow(0.999, t);

    const oldW2 = this.w2.slice();
    /* --- выходной слой --- */
    for (let j = 0; j < HIDDEN; j++) {
      const g = dOut * this.hid[j];
      this.mw2[j] = 0.9 * this.mw2[j] + 0.1 * g;
      this.vw2[j] = 0.999 * this.vw2[j] + 0.001 * g * g;
      this.w2[j] -= (lr * (this.mw2[j] / b1c)) / (Math.sqrt(this.vw2[j] / b2c) + 1e-8);
    }
    {
      const g = dOut;
      this.mb2 = 0.9 * this.mb2 + 0.1 * g;
      this.vb2 = 0.999 * this.vb2 + 0.001 * g * g;
      this.b2 -= (lr * (this.mb2 / b1c)) / (Math.sqrt(this.vb2 / b2c) + 1e-8);
    }

    /* Hidden gradients use OLD output weights; Adam decays moments even at zero gradient. */
    for (let j = 0; j < HIDDEN; j++) {
      const dHid = this.hid[j] > 0 ? dOut * oldW2[j] : 0;
      const base = j * FEATURES;
      for (let i = 0; i < FEATURES; i++) {
        const g = dHid * x[i];
        const mi = 0.9 * this.mw1[base + i] + 0.1 * g;
        const vi = 0.999 * this.vw1[base + i] + 0.001 * g * g;
        this.mw1[base + i] = mi;
        this.vw1[base + i] = vi;
        this.w1[base + i] -= (lr * (mi / b1c)) / (Math.sqrt(vi / b2c) + 1e-8);
      }
      const g = dHid;
      this.mb1[j] = 0.9 * this.mb1[j] + 0.1 * g;
      this.vb1[j] = 0.999 * this.vb1[j] + 0.001 * g * g;
      this.b1[j] -= (lr * (this.mb1[j] / b1c)) / (Math.sqrt(this.vb1[j] / b2c) + 1e-8);
    }

    return err * err;
  }

  /** MSE на выборке (для валидации, без обучения). */
  evaluateLoss(samples: { x: Float32Array; target: number }[]): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (const s of samples) {
      const p = this.forward(s.x);
      const e = p - s.target;
      sum += e * e;
    }
    return sum / samples.length;
  }

  serialize(): string {
    return JSON.stringify({
      v: 3,
      h: HIDDEN,
      w1: Array.from(this.w1),
      b1: Array.from(this.b1),
      w2: Array.from(this.w2),
      b2: this.b2,
    });
  }

  static deserialize(json: string): NNUE | null {
    try {
      const d = JSON.parse(json) as {
        v: number;
        h: number;
        w1: number[];
        b1: number[];
        w2: number[];
        b2: number;
      };
      if (
        d.v !== 3 ||
        d.h !== HIDDEN ||
        !Array.isArray(d.w1) ||
        d.w1.length !== FEATURES * HIDDEN ||
        !Array.isArray(d.b1) ||
        d.b1.length !== HIDDEN ||
        !Array.isArray(d.w2) ||
        d.w2.length !== HIDDEN ||
        ![...d.w1, ...d.b1, ...d.w2, d.b2].every(Number.isFinite)
      )
        return null;
      const net = new NNUE();
      net.w1 = Float32Array.from(d.w1);
      net.b1 = Float32Array.from(d.b1);
      net.w2 = Float32Array.from(d.w2);
      net.b2 = d.b2;
      return net;
    } catch {
      return null;
    }
  }
}
