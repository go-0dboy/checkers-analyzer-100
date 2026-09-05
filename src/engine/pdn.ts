/* ============================================================
 * PDN 3.0 (Portable Draughts Notation) — полный формат:
 * заголовки [Tag "..."], ходы 32-28 / 28x19, варианты ( ... ),
 * комментарии { ... }, оценки ходов $1..$6 (! ? !! ?? !? ?!),
 * результат 1-0 / 0-1 / 1-1 / *. Мульти-партийные файлы:
 * каждая партия начинается с нового блока заголовков.
 * ============================================================ */

import {
  applyMove, generateMoves, moveNotation, parseFen, startBoard, WHITE,
  type Move, type Pos, type Side,
} from './core';
import { createNode, NAG_SYMBOLS, nodeSan, type TreeNode } from '../state/tree';

export interface ParsedGame {
  headers: Record<string, string>;
  start: Pos;
  root: TreeNode;
  result: string | null;
  error: string | null;
  /** число успешно разобранных полуходов основной линии + вариантов */
  movesParsed: number;
}

/* ---------- токенизатор ---------- */

type Tok =
  | { t: 'move'; from: number; to: number; cap: boolean; raw: string }
  | { t: 'comment'; text: string }
  | { t: 'nag'; n: number }
  | { t: 'varOpen' } | { t: 'varClose' }
  | { t: 'result'; v: string }
  | { t: 'other' };

const RESULTS = new Set(['1-0', '0-1', '1-1', '*']);

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '{') {
      const end = text.indexOf('}', i);
      const stop = end === -1 ? n : end;
      out.push({ t: 'comment', text: text.slice(i + 1, stop).trim() });
      i = stop + 1;
      continue;
    }
    if (ch === '(') { out.push({ t: 'varOpen' }); i++; continue; }
    if (ch === ')') { out.push({ t: 'varClose' }); i++; continue; }
    if (ch === '$') {
      let j = i + 1;
      while (j < n && /\d/.test(text[j])) j++;
      const num = Number(text.slice(i + 1, j));
      if (j > i + 1) out.push({ t: 'nag', n: num });
      i = j;
      continue;
    }
    if (/\s/.test(ch)) { i++; continue; }
    /* слово */
    let j = i;
    while (j < n && !/[\s{}()$]/.test(text[j])) j++;
    const word = text.slice(i, j);
    i = j;
    if (RESULTS.has(word)) { out.push({ t: 'result', v: word }); continue; }
    if (/^\d+\.+$/.test(word)) continue;             /* номер хода: 12. / 12... */
    const m = /^(\d{1,2})\s*([x×X\-–—])\s*(\d{1,2})$/.exec(word);
    if (m) {
      out.push({
        t: 'move', from: Number(m[1]), to: Number(m[3]),
        cap: /[x×X]/.test(m[2]), raw: word,
      });
      continue;
    }
    if (/^\[\w+\s+"/.test(word)) continue;           /* заголовки отрезаны заранее */
    out.push({ t: 'other' });
  }
  return out;
}

/* ---------- разбор партии ---------- */

export function parsePDNFull(text: string): ParsedGame {
  const headers: Record<string, string> = {};
  const headerRe = /\[\s*(\w+)\s+"([^"]*)"\s*\]/g;
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(text)) !== null) headers[hm[1]] = hm[2];

  const body = text.replace(/\[[^\]]*\]/g, ' ');

  let start: Pos = { b: startBoard(), side: WHITE };
  if (headers['FEN']) start = parseFen(headers['FEN']) ?? start;

  const root = createNode(null, null);
  let result: string | null = null;
  let error: string | null = null;
  let movesParsed = 0;

  const posAt = new Map<string, Pos>([[root.id, start]]);
  let cur: TreeNode = root;
  let curPos: Pos = start;
  const stack: { node: TreeNode; pos: Pos }[] = [];

  const applyLegal = (p: Pos, from: number, to: number, cap: boolean): Move | null => {
    const legal = generateMoves(p);
    return (
      legal.find((l) => l.from === from && l.to === to && (l.captures.length > 0) === cap) ??
      legal.find((l) => l.from === from && l.to === to) ??
      null
    );
  };

  for (const tok of tokenize(body)) {
    if (tok.t === 'result') { result = tok.v; continue; }
    if (tok.t === 'comment') { if (cur.move) cur.comment = tok.text; continue; }
    if (tok.t === 'nag') {
      if (cur.move && tok.n >= 1 && tok.n <= 6 && !cur.nags.includes(tok.n)) cur.nags.push(tok.n);
      continue;
    }
    if (tok.t === 'varOpen') {
      /* вариант ветвится от позиции перед текущим ходом */
      if (cur.parent) {
        stack.push({ node: cur, pos: curPos });
        cur = cur.parent;
        curPos = posAt.get(cur.id) ?? curPos;
      }
      continue;
    }
    if (tok.t === 'varClose') {
      const s = stack.pop();
      if (s) { cur = s.node; curPos = s.pos; }
      continue;
    }
    if (tok.t === 'move') {
      const mv = applyLegal(curPos, tok.from, tok.to, tok.cap);
      if (!mv) {
        error = error ?? `Ход ${tok.raw} невозможен в позиции — разобрано ${movesParsed} полуходов`;
        break;
      }
      let child = cur.children.find((c) => c.move && c.move.from === mv.from && c.move.to === mv.to) ?? null;
      if (!child) {
        child = createNode(mv, cur);
        cur.children.push(child);
      }
      const next = applyMove(curPos, mv);
      posAt.set(child.id, next);
      cur = child;
      curPos = next;
      movesParsed++;
    }
  }

  return { headers, start, root, result, error, movesParsed };
}

/* ---------- сериализация ---------- */

function legalOr(start: Pos, path: Move[]): Pos {
  let p = start;
  for (const mv of path) {
    const found = generateMoves(p).find((l) => l.from === mv.from && l.to === mv.to) ?? mv;
    p = applyMove(p, found);
  }
  return p;
}

function serNode(n: TreeNode, posBefore: Pos, out: string[], num: number, blackNext: boolean): void {
  if (!n.move) return;
  const prefix = blackNext ? `${num}... ` : `${num}. `;
  out.push(prefix + nodeSan(n) + (n.comment ? ` {${n.comment}}` : ''));
  /* варианты — альтернативы этому ходу */
  for (let i = 1; i < n.children.length; i++) {
    out.push('(');
    serNode(n.children[i], posBefore, out, num, blackNext);
    out.push(')');
  }
  const after = legalOr(posBefore, [n.move]);
  const nextNum = blackNext ? num + 1 : num;
  if (n.children[0]) serNode(n.children[0], after, out, nextNum, !blackNext);
}

export function toPDNFull(opts: {
  headers: Record<string, string>;
  start: Pos;
  root: TreeNode;
  result: string;
}): string {
  const { headers, start, root, result } = opts;
  const lines: string[] = [];
  const defs: Record<string, string> = {
    Event: 'СтоКлетка · анализ',
    Site: '—',
    Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    White: '—',
    Black: '—',
  };
  const merged = { ...defs, ...headers, Result: result };
  for (const [k, v] of Object.entries(merged)) lines.push(`[${k} "${v}"]`);
  lines.push('');

  const out: string[] = [];
  const blackNext = start.side !== WHITE;
  if (root.children[0]) serNode(root.children[0], start, out, 1, blackNext);
  out.push(result);

  let cur = '';
  const textLines: string[] = [];
  for (const p of out) {
    if (cur.length + p.length + 1 > 76) { textLines.push(cur.trim()); cur = p; }
    else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur.trim()) textLines.push(cur.trim());
  if (textLines.length === 0) textLines.push(result);
  return [...lines, ...textLines, ''].join('\n');
}

/* ---------- мульти-партийные файлы (PDN 3.0) ---------- */

export function splitGames(text: string): string[] {
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
  return blocks.filter((b) => /\[\w+\s+"/.test(b) || /\d{1,2}[x-]\d{1,2}/.test(b));
}

/* ---------- legacy-обёртки (совместимость) ---------- */

export interface GameDoc {
  headers: Record<string, string>;
  start: Pos;
  moves: Move[];
  result: string | null;
  error: string | null;
  errorIndex: number;
}

/** Разбор с извлечением только основной линии (для старых потребителей). */
export function parsePDN(text: string): GameDoc {
  const g = parsePDNFull(text);
  const moves: Move[] = [];
  let n: TreeNode | undefined = g.root.children[0];
  while (n) {
    if (n.move) moves.push(n.move);
    n = n.children[0];
  }
  return {
    headers: g.headers, start: g.start, moves, result: g.result,
    error: g.error, errorIndex: -1,
  };
}

export function toPDN(headers: Record<string, string>, moves: Move[], result: string): string {
  const root = createNode(null, null);
  let cur = root;
  for (const m of moves) {
    const c = createNode(m, cur);
    cur.children.push(c);
    cur = c;
  }
  return toPDNFull({ headers, start: { b: startBoard(), side: WHITE }, root, result });
}

export const SAMPLE_PDN = `[Event "Пример · Классическое начало"]
[Site "СтоКлетка"]
[Date "2026.01.01"]
[White "—"]
[Black "—"]
[Result "*"]

1.32-28 {Классический размен} 19-23 2.28x19 14x23 (2...13x24 {вариант: бой в другую сторону} 3.37-32)
3.37-32 10-14 4.41-37 5-10 5.46-41 14-19 6.34-29 23x34 7.40x29 20-24 8.29x20 15x24
9.44-40 10-14 10.50-44 14-20 11.40-34 20-25 12.44-40 *
`;
