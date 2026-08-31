/* ============================================================
 * PDN (Portable Draughts Notation) — разбор и сериализация партий,
 * а также пример партии для быстрой загрузки.
 * ============================================================ */

import {
  type Pos, type Move, applyMove, generateMoves, parseFen, startBoard, moveNotation, WHITE,
} from './core';

export interface GameDoc {
  headers: Record<string, string>;
  start: Pos;
  moves: Move[];
  result: string | null;
  error: string | null;
  errorIndex: number; // -1, если ошибки нет
}

const RESULT_RE = /(1-0|0-1|1-1|\*)\s*$/;

export function parsePDN(text: string): GameDoc {
  const headers: Record<string, string> = {};
  const headerRe = /\[\s*(\w+)\s+"([^"]*)"\s*\]/g;
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(text)) !== null) headers[hm[1]] = hm[2];

  let body = text.replace(/\[[^\]]*\]/g, ' ');
  body = body.replace(/\{[^}]*\}/g, ' ');
  // вырезаем варианты в скобках (вложенные — за несколько проходов)
  for (let i = 0; i < 4; i++) body = body.replace(/\([^()]*\)/g, ' ');

  let start: Pos | null = null;
  if (headers['FEN']) start = parseFen(headers['FEN']);
  if (!start) start = { b: startBoard(), side: WHITE };

  const resMatch = RESULT_RE.exec(body.trim());
  const result = resMatch ? resMatch[1] : null;
  body = body.replace(RESULT_RE, ' '); // чтобы «1-0» не прочиталось как ход

  const moveRe = /(\d{1,2})\s*([x×X\-–—])\s*(\d{1,2})/g;
  const moves: Move[] = [];
  let pos = start;
  let error: string | null = null;
  let errorIndex = -1;
  let idx = 0;
  let mm: RegExpExecArray | null;
  while ((mm = moveRe.exec(body)) !== null) {
    const from = Number(mm[1]);
    const to = Number(mm[3]);
    const isCap = /[x×X]/.test(mm[2]);
    const legal = generateMoves(pos);
    const chosen =
      legal.find((l) => l.from === from && l.to === to && (l.captures.length > 0) === isCap) ??
      legal.find((l) => l.from === from && l.to === to);
    if (!chosen) {
      error = `Ход №${idx + 1} (${mm[0]}) невозможен в текущей позиции — загружено ${idx} ходов`;
      errorIndex = idx;
      break;
    }
    moves.push(chosen);
    pos = applyMove(pos, chosen);
    idx++;
  }

  return { headers, start, moves, result, error, errorIndex };
}

export function toPDN(headers: Record<string, string>, moves: Move[], result: string): string {
  const lines: string[] = [];
  const defs: Record<string, string> = {
    Event: 'СтоКлетка · анализ',
    Site: '—',
    Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    White: '—',
    Black: '—',
    Result: result,
  };
  const merged = { ...defs, ...headers, Result: result };
  for (const [k, v] of Object.entries(merged)) lines.push(`[${k} "${v}"]`);
  lines.push('');

  const parts: string[] = [];
  moves.forEach((mv, i) => {
    parts.push(i % 2 === 0 ? `${i / 2 + 1}.${moveNotation(mv)}` : moveNotation(mv));
  });
  parts.push(result);

  let cur = '';
  const textLines: string[] = [];
  for (const p of parts) {
    if (cur.length + p.length + 1 > 76) { textLines.push(cur.trim()); cur = p; }
    else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur.trim()) textLines.push(cur.trim());
  return [...lines, ...textLines, ''].join('\n');
}

export const SAMPLE_PDN = `[Event "Пример · Классическое начало"]
[Site "СтоКлетка"]
[Date "2026.01.01"]
[White "—"]
[Black "—"]
[Result "*"]

1.32-28 19-23 2.28x19 14x23 3.37-32 10-14 4.41-37 5-10 5.46-41 14-19 6.34-29 23x34
7.40x29 20-24 8.29x20 15x24 9.44-40 10-14 10.50-44 14-20 11.40-34 20-25 12.44-40 *
`;
