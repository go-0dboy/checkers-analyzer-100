/* ============================================================
 * СтоКлетка · ядро правил международных шашек (100 клеток, ФМЖД)
 * Внутренняя нумерация полей: 1..50 (только тёмные), как в нотации.
 * Доска: Int8Array(51), индекс 0 не используется.
 *   +1 белый простой, +2 белая дамка, -1 чёрный простой, -2 чёрная дамка.
 * ============================================================ */

export type Side = 1 | -1;
export const WHITE: Side = 1;
export const BLACK: Side = -1;

export interface Pos {
  b: Int8Array;
  side: Side; // чей ход
}

export interface Move {
  from: number;
  to: number;
  path: number[];    // промежуточные поля приземления (заканчивается `to`)
  captures: number[]; // побитые поля
  king: boolean;     // превращение в дамку (только при завершении хода на последней горизонтали)
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 1], [1, -1], [1, 1],
];

/** Поле 1..50 → [строка, колонка]. Строка 0 — верх (тылы чёрных). */
export function rc(n: number): [number, number] {
  const i = n - 1;
  const r = (i / 5) | 0;
  const k = i % 5;
  return [r, 2 * k + (r % 2 === 0 ? 1 : 0)];
}

/** [строка, колонка] → поле 1..50 (или -1, если поле светлое/вне доски). */
export function sq(r: number, c: number): number {
  if (r < 0 || r > 9 || c < 0 || c > 9 || (r + c) % 2 !== 1) return -1;
  return r * 5 + (c - (r % 2 === 0 ? 1 : 0)) / 2 + 1;
}

export function isLastRow(n: number, side: Side): boolean {
  return rc(n)[0] === (side === WHITE ? 0 : 9);
}

export function startBoard(): Int8Array {
  const b = new Int8Array(51);
  for (let n = 1; n <= 20; n++) b[n] = -1;
  for (let n = 31; n <= 50; n++) b[n] = 1;
  return b;
}

export function startFen(): string {
  return 'W:W31-50:B1-20';
}

/* ---------------- Генерация ходов ---------------- */

function pushCapture(
  out: Move[], from: number, to: number, path: number[], captures: number[], isMan: boolean, own: Side,
) {
  out.push({
    from, to,
    path: [...path],
    captures: [...captures],
    king: isMan && isLastRow(to, own),
  });
}

/** Серии взятий простого (бьёт и вперёд, и назад; только через одно поле). */
function manCaptures(b: Int8Array, from: number, own: Side, out: Move[]) {
  const bb = b.slice();
  bb[from] = 0; // своя шашка физически перемещается — стартовое поле свободно
  const captured: number[] = [];
  const path: number[] = [];
  const dfs = (cur: number) => {
    const [r, c] = rc(cur);
    let extended = false;
    for (const [dr, dc] of DIRS) {
      const mi = sq(r + dr, c + dc);
      if (mi < 0) continue;
      const mv = bb[mi];
      if (mv === 0 || mv * own >= 0 || captured.includes(mi)) continue;
      const li = sq(r + 2 * dr, c + 2 * dc);
      if (li < 0 || bb[li] !== 0) continue; // побитые остаются на доске до конца серии
      captured.push(mi); path.push(li); extended = true;
      dfs(li);
      captured.pop(); path.pop();
    }
    if (!extended && captured.length > 0) pushCapture(out, from, cur, path, captured, true, own);
  };
  dfs(from);
}

/** Серии взятий летающей дамки. */
function kingCaptures(b: Int8Array, from: number, own: Side, out: Move[]) {
  const bb = b.slice();
  bb[from] = 0;
  const captured: number[] = [];
  const path: number[] = [];
  const dfs = (cur: number) => {
    const [r, c] = rc(cur);
    let extended = false;
    for (const [dr, dc] of DIRS) {
      let rr = r + dr, cc = c + dc;
      let mi = sq(rr, cc);
      while (mi > 0 && bb[mi] === 0) { rr += dr; cc += dc; mi = sq(rr, cc); }
      if (mi < 0) continue;
      const mv = bb[mi];
      if (mv === 0 || mv * own >= 0 || captured.includes(mi)) continue;
      let lr = rr + dr, lc = cc + dc, li = sq(lr, lc);
      while (li > 0 && bb[li] === 0) {
        captured.push(mi); path.push(li); extended = true;
        dfs(li);
        captured.pop(); path.pop();
        lr += dr; lc += dc; li = sq(lr, lc);
      }
    }
    if (!extended && captured.length > 0) pushCapture(out, from, cur, path, captured, false, own);
  };
  dfs(from);
}

/**
 * Все легальные ходы позиции.
 * Если есть хоть одно взятие — возвращаются только взятия с МАКСИМАЛЬНЫМ
 * числом побитых (правило большинства ФМЖД).
 */
export function generateMoves(pos: Pos): Move[] {
  const { b, side } = pos;
  const captures: Move[] = [];
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 0 || v * side <= 0) continue;
    if (v * side === 1) manCaptures(b, n, side, captures);
    else kingCaptures(b, n, side, captures);
  }
  if (captures.length > 0) {
    let max = 0;
    for (const m of captures) if (m.captures.length > max) max = m.captures.length;
    return captures.filter((m) => m.captures.length === max);
  }
  const quiet: Move[] = [];
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 0 || v * side <= 0) continue;
    const [r, c] = rc(n);
    if (v === side) {
      const dr = side === WHITE ? -1 : 1;
      for (const dc of [-1, 1]) {
        const t = sq(r + dr, c + dc);
        if (t > 0 && b[t] === 0) {
          quiet.push({ from: n, to: t, path: [t], captures: [], king: isLastRow(t, side) });
        }
      }
    } else {
      for (const [dr, dc] of DIRS) {
        let rr = r + dr, cc = c + dc, t = sq(rr, cc);
        while (t > 0 && b[t] === 0) {
          quiet.push({ from: n, to: t, path: [t], captures: [], king: false });
          rr += dr; cc += dc; t = sq(rr, cc);
        }
      }
    }
  }
  return quiet;
}

export function applyMove(pos: Pos, m: Move): Pos {
  const b = pos.b.slice();
  const v = b[m.from];
  for (const c of m.captures) b[c] = 0;
  b[m.from] = 0;
  b[m.to] = m.king ? ((pos.side * 2) as 2 | -2) : v;
  return { b, side: (pos.side === WHITE ? BLACK : WHITE) };
}

export function moveNotation(m: Move): string {
  return `${m.from}${m.captures.length > 0 ? 'x' : '-'}${m.to}`;
}

export function findMove(moves: Move[], from: number, to: number): Move | null {
  let fallback: Move | null = null;
  for (const m of moves) {
    if (m.from !== from || m.to !== to) continue;
    if (m.captures.length > 0) return m; // при совпадении полей приоритет взятию
    if (!fallback) fallback = m;
  }
  return fallback;
}

export function positionsFrom(start: Pos, moves: Move[]): Pos[] {
  const out: Pos[] = [start];
  let cur = start;
  for (const m of moves) { cur = applyMove(cur, m); out.push(cur); }
  return out;
}

/** Темпы: суммарное продвижение простых (белые − чёрные). */
export function tempi(b: Int8Array): number {
  let t = 0;
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 1) t += 9 - rc(n)[0];
    else if (v === -1) t -= rc(n)[0];
  }
  return t;
}

/* ---------------- FEN (формат Liens / PDN) ----------------
 * Пример:  W:W31-50:B1-20   |   B:WK48,44:BK25:10
 * Стороны: W/B, дамки с префиксом K, диапазоны через «-», списки через «,». */

export function boardToFen(pos: Pos): string {
  const parts: string[] = [pos.side === WHITE ? 'W' : 'B'];
  for (const color of [1, -1] as const) {
    const men: number[] = [];
    const kings: number[] = [];
    for (let n = 1; n <= 50; n++) {
      const v = pos.b[n];
      if (v === 0 || v * color < 0) continue;
      (Math.abs(v) === 2 ? kings : men).push(n);
    }
    if (men.length === 0 && kings.length === 0) continue;
    const tokens: string[] = [];
    let i = 0;
    while (i < men.length) {
      let j = i;
      while (j + 1 < men.length && men[j + 1] === men[j] + 1) j++;
      tokens.push(j > i ? `${men[i]}-${men[j]}` : `${men[i]}`);
      i = j + 1;
    }
    for (const k of kings) tokens.push(`K${k}`);
    parts.push((color === 1 ? 'W' : 'B') + tokens.join(','));
  }
  return parts.join(':');
}

export function parseFen(input: string): Pos | null {
  const fen = input.trim().replace(/["']/g, '');
  if (!fen) return null;
  const fields = fen.split(':').map((f) => f.trim());
  const sideCh = fields[0].toUpperCase();
  if (sideCh !== 'W' && sideCh !== 'B') return null;
  const b = new Int8Array(51);
  const tokRe = /^K?(\d+)(?:-(\d+))?$/i;
  for (const f of fields.slice(1)) {
    if (!f) continue;
    const colorCh = f[0].toUpperCase();
    if (colorCh !== 'W' && colorCh !== 'B') return null;
    const sign: 1 | -1 = colorCh === 'W' ? 1 : -1;
    for (const tokRaw of f.slice(1).split(',')) {
      const tok = tokRaw.trim();
      if (!tok) continue;
      const m = tokRe.exec(tok);
      if (!m) return null;
      const a = Number(m[1]);
      const z = m[2] ? Number(m[2]) : a;
      const isKing = tok[0].toUpperCase() === 'K';
      if (a < 1 || z > 50 || a > z || (isKing && a !== z)) return null;
      for (let n = a; n <= z; n++) {
        if (b[n] !== 0) return null;
        b[n] = (sign * (isKing ? 2 : 1)) as 1 | 2 | -1 | -2;
      }
    }
  }
  return { b, side: sideCh === 'W' ? WHITE : BLACK };
}
