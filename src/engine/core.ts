/* ============================================================
 * Ядро правил международных шашек (100 клеток, ФМЖД).
 * Нумерация полей 1–50: 1 = b10, 46 = a1 (тёмное, левый нижний
 * угол у белых), 50 = i1. r — 0-based сверху, c — 0-based (a=0).
 * Реализовано: обязательное взятие (вперёд и назад), правило
 * большинства, летающие дамки, превращение при остановке на
 * последней горизонтали, блокировка побитых шашек в серии.
 * ============================================================ */

export type Side = 1 | -1;
export const WHITE: Side = 1;
export const BLACK: Side = -1;

export interface Move {
  from: number;
  to: number;
  path: number[];
  captures: number[];
  king: boolean;
}

export interface Pos {
  /** 0 пусто, 1 белая, 2 белая дамка, -1 чёрная, -2 чёрная дамка */
  b: Int8Array;
  side: Side;
}

/* ---------- геометрия ---------- */

const ROW_OF = new Int8Array(51);
const COL_OF = new Int8Array(51);
const SQ = new Int8Array(100).fill(-1);

for (let r = 0; r < 10; r++) {
  for (let c = 0; c < 10; c++) {
    if ((r + c) % 2 === 1) {
      /* n = r*5 + ceil((c+1)/2) — единственная формула нумерации;
         все слои (сетка, шашки, стрелки, клики) используют её */
      const n = r * 5 + Math.ceil((c + 1) / 2);
      SQ[r * 10 + c] = n;
      ROW_OF[n] = r;
      COL_OF[n] = c;
    }
  }
}

export const sq = (r: number, c: number): number => SQ[r * 10 + c];
export const rc = (n: number): [number, number] => [ROW_OF[n], COL_OF[n]];

const DIRS = [
  [-1, -1], [-1, 1], [1, -1], [1, 1],
] as const;

const inB = (r: number, c: number) => r >= 0 && r < 10 && c >= 0 && c < 10;

/* ---------- генерация ходов ---------- */

function collectMan(b: Int8Array, cur: number, side: Side, captured: Set<number>, path: number[], out: Move[]): void {
  const [r, c] = rc(cur);
  let any = false;
  for (const [dr, dc] of DIRS) {
    const r1 = r + dr; const c1 = c + dc;
    const r2 = r + 2 * dr; const c2 = c + 2 * dc;
    if (!inB(r2, c2)) continue;
    const mid = sq(r1, c1); const land = sq(r2, c2);
    const v = b[mid];
    if (v === 0 || v * side > 0 || captured.has(mid)) continue;
    if (b[land] !== 0) continue;
    captured.add(mid);
    path.push(land);
    any = true;
    collectMan(b, land, side, captured, path, out);
    path.pop();
    captured.delete(mid);
  }
  if (!any && captured.size > 0) {
    out.push({ from: path[0], to: cur, path: path.slice(1), captures: [...captured], king: false });
  }
}

function collectKing(b: Int8Array, cur: number, side: Side, captured: Set<number>, path: number[], out: Move[]): void {
  const [r, c] = rc(cur);
  let any = false;
  for (const [dr, dc] of DIRS) {
    let r1 = r + dr; let c1 = c + dc;
    while (inB(r1, c1) && b[sq(r1, c1)] === 0) { r1 += dr; c1 += dc; }
    if (!inB(r1, c1)) continue;
    const mid = sq(r1, c1);
    const v = b[mid];
    if (v * side >= 0 || captured.has(mid)) continue;
    let r2 = r1 + dr; let c2 = c1 + dc;
    while (inB(r2, c2)) {
      const land = sq(r2, c2);
      if (b[land] !== 0) break;
      captured.add(mid);
      path.push(land);
      any = true;
      collectKing(b, land, side, captured, path, out);
      path.pop();
      captured.delete(mid);
      r2 += dr; c2 += dc;
    }
  }
  if (!any && captured.size > 0) {
    out.push({ from: path[0], to: cur, path: path.slice(1), captures: [...captured], king: true });
  }
}

function genQuiet(b: Int8Array, from: number, side: Side, out: Move[]): void {
  const [r, c] = rc(from);
  const v = b[from];
  if (v === side) {
    const fwd = side === WHITE ? -1 : 1;
    for (const dc of [-1, 1]) {
      const r1 = r + fwd; const c1 = c + dc;
      if (inB(r1, c1) && b[sq(r1, c1)] === 0) {
        out.push({ from, to: sq(r1, c1), path: [], captures: [], king: false });
      }
    }
  } else {
    for (const [dr, dc] of DIRS) {
      let r1 = r + dr; let c1 = c + dc;
      while (inB(r1, c1) && b[sq(r1, c1)] === 0) {
        out.push({ from, to: sq(r1, c1), path: [], captures: [], king: true });
        r1 += dr; c1 += dc;
      }
    }
  }
}

export function generateMoves(pos: Pos): Move[] {
  const out: Move[] = [];
  const caps: Move[] = [];
  const { b, side } = pos;
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 0 || v * side < 0) continue;
    if (v === side) collectMan(b, n, side, new Set(), [n], caps);
    else collectKing(b, n, side, new Set(), [n], caps);
  }
  if (caps.length > 0) {
    let mx = 0;
    for (const m of caps) mx = Math.max(mx, m.captures.length);
    for (const m of caps) if (m.captures.length === mx) out.push(m);
    return out;
  }
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 0 || v * side < 0) continue;
    genQuiet(b, n, side, out);
  }
  return out;
}

export function applyMove(pos: Pos, m: Move): Pos {
  const b = pos.b.slice();
  let v = b[m.from];
  b[m.from] = 0;
  for (const c of m.captures) b[c] = 0;
  /* превращение — если ход (в т.ч. взятие) завершается на последней горизонтали */
  if (v === WHITE && ROW_OF[m.to] === 0) v = 2;
  else if (v === BLACK && ROW_OF[m.to] === 9) v = -2;
  b[m.to] = v;
  return { b, side: (pos.side === WHITE ? BLACK : WHITE) };
}

export function findMove(moves: Move[], from: number, to: number): Move | undefined {
  return moves.find((m) => m.from === from && m.to === to);
}

/* ---------- стартовая позиция и FEN (Liens / PDN) ---------- */

export function startBoard(): Int8Array {
  const b = new Int8Array(51);
  for (let n = 1; n <= 20; n++) b[n] = -1;
  for (let n = 31; n <= 50; n++) b[n] = 1;
  return b;
}

export function boardToFen(b: Int8Array, side: Side = WHITE): string {
  const w: string[] = []; const bl: string[] = [];
  let wRun: number[] = []; let bRun: number[] = [];
  const flushW = () => { if (wRun.length) { w.push(`${wRun[0]}-${wRun[wRun.length - 1]}`); wRun = []; } };
  const flushB = () => { if (bRun.length) { bl.push(`${bRun[0]}-${bRun[bRun.length - 1]}`); bRun = []; } };
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 1) { flushW(); wRun.push(n); }
    else if (v === 2) { flushW(); w.push(`K${n}`); }
    else if (v === -1) { flushB(); bRun.push(n); }
    else if (v === -2) { flushB(); bl.push(`K${n}`); }
  }
  flushW(); flushB();
  return `${side === WHITE ? 'W' : 'B'}:W${w.join(',')}:B${bl.join(',')}`;
}

export function parseFen(fen: string): Pos | null {
  const parts = fen.trim().split(':');
  if (parts.length !== 3) return null;
  const side = parts[0].toUpperCase() === 'B' ? BLACK : WHITE;
  const b = new Int8Array(51);
  const fill = (part: string, sign: Side): boolean => {
    const s = part.replace(/^[WB]/i, '');
    if (!s) return true;
    for (const tok of s.split(',')) {
      const t = tok.trim();
      if (!t) continue;
      const king = /^K/i.test(t);
      const nums = t.replace(/^K/i, '').split('-').map(Number);
      if (nums.some((x) => !Number.isInteger(x) || x < 1 || x > 50)) return false;
      const [a, z] = nums.length === 1 ? [nums[0], nums[0]] : nums;
      if (a > z) return false;
      for (let n = a; n <= z; n++) {
        if (b[n] !== 0) return false;
        b[n] = sign * (king ? 2 : 1);
      }
    }
    return true;
  };
  if (!fill(parts[1], WHITE) || !fill(parts[2], BLACK)) return null;
  return { b, side };
}

/* ---------- нотация и разное ---------- */

export function moveNotation(m: Move | { from: number; to: number; captures?: number[] }): string {
  return `${m.from}${m.captures && m.captures.length > 0 ? 'x' : '-'}${m.to}`;
}

export function positionsFrom(start: Pos, moves: Move[], ply: number): Pos[] {
  const res: Pos[] = [start];
  for (let i = 0; i < Math.min(ply, moves.length); i++) res.push(applyMove(res[res.length - 1], moves[i]));
  return res;
}

export function tempi(b: Int8Array): number {
  let t = 0;
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 1) t += 10 - ROW_OF[n];
    else if (v === -1) t -= ROW_OF[n] + 1;
  }
  return t;
}
