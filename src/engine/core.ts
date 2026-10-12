/* ============================================================
 * Ядро правил международных шашек (100 клеток, ФМЖД).
 * Нумерация полей 1–50: 1 = b10 (верх), 46 = a1 (тёмное, левый
 * нижний угол у белых), 50 = i1. Белые внизу, ходят вверх.
 *
 * Реализовано: обязательное взятие (вперёд и назад), правило
 * большинства, летающие дамки, простая бьёт назад, превращение
 * в дамку только при остановке на последней горизонтали,
 * блокировка побитых шашек в серии взятий.
 * ============================================================ */

export type Side = 1 | -1;
export const WHITE: Side = 1;
export const BLACK: Side = -1;

export interface Move {
  from: number;
  to: number;
  /** промежуточные поля приземлений (для серий дамки) */
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
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

const inB = (r: number, c: number) => r >= 0 && r < 10 && c >= 0 && c < 10;

/* ---------- генерация ходов ---------- */

/** Серии взятий простой шашкой. Побитые шашки остаются и блокируют траекторию. */
function collectMan(
  b: Int8Array,
  cur: number,
  side: Side,
  captured: Set<number>,
  path: number[],
  out: Move[],
): void {
  const [r, c] = rc(cur);
  let any = false;
  for (const [dr, dc] of DIRS) {
    const r1 = r + dr;
    const c1 = c + dc;
    const r2 = r + 2 * dr;
    const c2 = c + 2 * dc;
    if (!inB(r2, c2)) continue;
    const mid = sq(r1, c1);
    const land = sq(r2, c2);
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
    out.push({
      from: path[0],
      to: cur,
      path: path.slice(1),
      captures: [...captured],
      king: false,
    });
  }
}

/** Серии взятий летающей дамкой. */
function collectKing(
  b: Int8Array,
  cur: number,
  side: Side,
  captured: Set<number>,
  path: number[],
  out: Move[],
): void {
  const [r, c] = rc(cur);
  let any = false;
  for (const [dr, dc] of DIRS) {
    let r1 = r + dr;
    let c1 = c + dc;
    while (inB(r1, c1) && b[sq(r1, c1)] === 0) {
      r1 += dr;
      c1 += dc;
    }
    if (!inB(r1, c1)) continue;
    const mid = sq(r1, c1);
    const v = b[mid];
    if (v * side >= 0 || captured.has(mid)) continue;
    let r2 = r1 + dr;
    let c2 = c1 + dc;
    while (inB(r2, c2)) {
      const land = sq(r2, c2);
      if (b[land] !== 0) break;
      captured.add(mid);
      path.push(land);
      any = true;
      collectKing(b, land, side, captured, path, out);
      path.pop();
      captured.delete(mid);
      r2 += dr;
      c2 += dc;
    }
  }
  if (!any && captured.size > 0) {
    out.push({
      from: path[0],
      to: cur,
      path: path.slice(1),
      captures: [...captured],
      king: true,
    });
  }
}

/** Тихие ходы, когда взятий нет. */
function genQuiet(b: Int8Array, from: number, side: Side, out: Move[]): void {
  const [r, c] = rc(from);
  const v = b[from];
  if (v === side) {
    const fwd = side === WHITE ? -1 : 1;
    for (const dc of [-1, 1]) {
      const r1 = r + fwd;
      const c1 = c + dc;
      if (inB(r1, c1) && b[sq(r1, c1)] === 0) {
        out.push({ from, to: sq(r1, c1), path: [], captures: [], king: false });
      }
    }
  } else {
    for (const [dr, dc] of DIRS) {
      let r1 = r + dr;
      let c1 = c + dc;
      while (inB(r1, c1) && b[sq(r1, c1)] === 0) {
        out.push({ from, to: sq(r1, c1), path: [], captures: [], king: true });
        r1 += dr;
        c1 += dc;
      }
    }
  }
}

/** Все легальные ходы позиции (с учётом правила большинства). */
export function generateMoves(pos: Pos): Move[] {
  const out: Move[] = [];
  const caps: Move[] = [];
  const { side } = pos;
  const b = pos.b.slice();
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 0 || v * side < 0) continue;
    // The moving piece vacates its origin; captured pieces remain blockers.
    b[n] = 0;
    if (v === side) collectMan(b, n, side, new Set(), [n], caps);
    else collectKing(b, n, side, new Set(), [n], caps);
    b[n] = v;
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
  // превращение — при завершении хода на последней горизонтали
  if (v === WHITE && ROW_OF[m.to] === 0) v = 2;
  else if (v === BLACK && ROW_OF[m.to] === 9) v = -2;
  b[m.to] = v;
  return { b, side: pos.side === WHITE ? BLACK : WHITE };
}

/** Stable identity includes the complete landing route and captured pieces. */
export function moveKey(m: Move): string {
  return `${m.from}:${m.to}:${m.path.join(',')}:${[...m.captures].sort((a, b) => a - b).join(',')}`;
}

export function sameMove(a: Move, b: Move): boolean {
  return moveKey(a) === moveKey(b);
}

export function findMove(
  moves: Move[],
  from: number,
  to: number,
  path?: number[],
  captures?: number[],
): Move | undefined {
  const matches = moves.filter(
    (m) =>
      m.from === from &&
      m.to === to &&
      (!path || m.path.join(',') === path.join(',')) &&
      (!captures ||
        [...m.captures].sort((a, b) => a - b).join(',') ===
          [...captures].sort((a, b) => a - b).join(',')),
  );
  // Different routes with the same resulting position are interchangeable for short PDN.
  if (
    !path &&
    !captures &&
    matches.some(
      (m) => [...m.captures].sort().join(',') !== [...matches[0].captures].sort().join(','),
    )
  )
    return undefined;
  return matches[0];
}

export function isMove(value: unknown): value is Move {
  if (!value || typeof value !== 'object') return false;
  const m = value as Move;
  const square = (n: unknown) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 50;
  return (
    square(m.from) &&
    square(m.to) &&
    typeof m.king === 'boolean' &&
    Array.isArray(m.path) &&
    m.path.length <= 50 &&
    m.path.every(square) &&
    Array.isArray(m.captures) &&
    m.captures.length <= 40 &&
    m.captures.every(square) &&
    new Set(m.captures).size === m.captures.length &&
    (m.captures.length === 0
      ? m.path.length === 0
      : m.path.length === m.captures.length && m.path[m.path.length - 1] === m.to)
  );
}

/* ---------- стартовая позиция и FEN (формат Liens / PDN) ---------- */

export function startBoard(): Int8Array {
  const b = new Int8Array(51);
  for (let n = 1; n <= 20; n++) b[n] = -1;
  for (let n = 31; n <= 50; n++) b[n] = 1;
  return b;
}

export function boardToFen(b: Int8Array, side: Side = WHITE): string {
  const encode = (side: Side): string => {
    const tokens: string[] = [];
    for (let n = 1; n <= 50; n++) {
      if (b[n] === side * 2) tokens.push(`K${n}`);
      if (b[n] !== side) continue;
      const first = n;
      while (n < 50 && b[n + 1] === side) n++;
      tokens.push(first === n ? `${n}` : `${first}-${n}`);
    }
    return tokens.join(',');
  };
  return `${side === WHITE ? 'W' : 'B'}:W${encode(WHITE)}:B${encode(BLACK)}`;
}

export function parseFen(fen: string): Pos | null {
  const parts = fen.trim().split(':');
  if (parts.length !== 3 || !/^[WB]$/i.test(parts[0])) return null;
  const side = parts[0].toUpperCase() === 'B' ? BLACK : WHITE;
  const b = new Int8Array(51);
  const seen = new Set<string>();
  for (const part of parts.slice(1)) {
    const color = part[0]?.toUpperCase();
    if (!['W', 'B'].includes(color) || seen.has(color)) return null;
    seen.add(color);
    const list = part.slice(1).trim();
    if (!list) continue;
    for (const token of list.split(',')) {
      const match = /^(K?)(\d{1,2})(?:-(\d{1,2}))?$/i.exec(token.trim());
      if (!match) return null;
      const first = Number(match[2]),
        last = Number(match[3] ?? match[2]);
      if (first < 1 || last > 50 || first > last) return null;
      for (let n = first; n <= last; n++) {
        if (b[n] !== 0) return null;
        b[n] = (color === 'W' ? WHITE : BLACK) * (match[1] ? 2 : 1);
      }
    }
  }
  return { b, side };
}

/* ---------- нотация ---------- */

export function moveNotation(m: Move): string {
  return m.captures.length ? [m.from, ...m.path].join('x') : `${m.from}-${m.to}`;
}

export function positionsFrom(start: Pos, moves: Move[], ply: number): Pos[] {
  const res: Pos[] = [start];
  for (let i = 0; i < Math.min(ply, moves.length); i++)
    res.push(applyMove(res[res.length - 1], moves[i]));
  return res;
}

/** Темпы (разность темпов) — для панели анализа. */
export function tempi(b: Int8Array): number {
  let t = 0;
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 1) t += 10 - ROW_OF[n];
    else if (v === -1) t -= ROW_OF[n] + 1;
  }
  return t;
}
