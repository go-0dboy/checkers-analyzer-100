/** PDN: complete capture routes, nested variations, comments and NAG. */
import {
  applyMove,
  generateMoves,
  moveNotation,
  sameMove,
  boardToFen,
  findMove,
  parseFen,
  startBoard,
  WHITE,
  type Pos,
} from './core';
import { createNode, MAX_TREE_DEPTH, MAX_TREE_NODES, type TreeNode } from '../state/tree';

export interface ParsedGame {
  headers: Record<string, string>;
  start: Pos;
  root: TreeNode;
  result: string | null;
  error: string | null;
  movesParsed: number;
}
type Tok =
  | { t: 'move'; from: number; to: number; path: number[]; cap: boolean; raw: string }
  | { t: 'comment'; text: string }
  | { t: 'nag'; n: number }
  | { t: 'varOpen' }
  | { t: 'varClose' }
  | { t: 'result'; v: string }
  | { t: 'other'; raw: string };
const RESULTS = new Set(['1-0', '0-1', '1-1', '*']);
const ANNOTATIONS: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const tokens = text.match(/\{[^}]*\}|\$\d+|[()]|[^\s{}()$]+|[{}$]/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('{') && token.endsWith('}')) {
      out.push({ t: 'comment', text: token.slice(1, -1).trim() });
      continue;
    }
    if (token === '(' || token === ')') {
      out.push({ t: token === '(' ? 'varOpen' : 'varClose' });
      continue;
    }
    if (/^\$\d+$/.test(token)) {
      out.push({ t: 'nag', n: Number(token.slice(1)) });
      continue;
    }
    let word = token.replace(/^\d+\.+/, '');
    if (!word) continue;
    if (RESULTS.has(word)) {
      out.push({ t: 'result', v: word });
      continue;
    }
    const nag = /([!?]{1,2})$/.exec(word);
    if (nag) word = word.slice(0, -nag[1].length);
    const m = /^(\d{1,2})([x×X\-–—])(\d{1,2}(?:[x×X]\d{1,2})*)$/.exec(word);
    if (!m) {
      out.push({ t: 'other', raw: token });
      continue;
    }
    const path = m[3].split(/[x×X]/).map(Number);
    out.push({
      t: 'move',
      from: Number(m[1]),
      to: path[path.length - 1],
      path,
      cap: /[x×X]/.test(m[2]),
      raw: word,
    });
    if (nag) out.push({ t: 'nag', n: ANNOTATIONS[nag[1]] });
  }
  return out;
}

export function parsePDNFull(text: string): ParsedGame {
  const headers: Record<string, string> = {};
  const headerRe = /\{[^}]*\}|\[\s*(\w+)\s+"((?:\\.|[^"\\])*)"\s*\]/g;
  const body = text.replace(headerRe, (whole: string, key: string | undefined, value: string) => {
    if (!key) return whole;
    headers[key] = value.replace(/\\([\\"])/g, '$1');
    return ' ';
  });
  const root = createNode(null, null);
  const start = headers.FEN ? parseFen(headers.FEN) : { b: startBoard(), side: WHITE };
  const game: ParsedGame = {
    headers,
    start: start ?? { b: startBoard(), side: WHITE },
    root,
    result: RESULTS.has(headers.Result) ? headers.Result : null,
    error: start ? null : 'Некорректный стартовый FEN',
    movesParsed: 0,
  };
  if (game.error) return game;
  if (splitGames(text).length > 1) {
    game.error = 'В тексте несколько партий — выберите одну для загрузки';
    return game;
  }
  const posAt = new Map<string, Pos>([[root.id, game.start]]);
  let cur = root,
    pos = game.start;
  const depths = new Map<string, number>([[root.id, 0]]);
  let nodeCount = 1;
  let ended = false;
  const stack: { node: TreeNode; pos: Pos; ended: boolean }[] = [];
  for (const tok of tokenize(body)) {
    if (tok.t === 'other') {
      game.error = `Неизвестный токен PDN: ${tok.raw}`;
      break;
    }
    if (ended && tok.t !== 'comment' && tok.t !== 'varClose') {
      game.error = 'После результата партии или варианта не должно быть ходов';
      break;
    }
    if (tok.t === 'result') {
      ended = true;
      if (!stack.length) game.result = tok.v;
      continue;
    }
    if (tok.t === 'comment') {
      cur.comment = [cur.comment, tok.text].filter(Boolean).join('\n');
      continue;
    }
    if (tok.t === 'nag') {
      if (cur.move && tok.n >= 1 && tok.n <= 6 && !cur.nags.includes(tok.n)) cur.nags.push(tok.n);
      continue;
    }
    if (tok.t === 'varOpen') {
      if (!cur.parent || stack.length >= 100) {
        game.error = 'Некорректное начало варианта';
        break;
      }
      stack.push({ node: cur, pos, ended });
      ended = false;
      cur = cur.parent;
      pos = posAt.get(cur.id)!;
      continue;
    }
    if (tok.t === 'varClose') {
      const saved = stack.pop();
      if (!saved) {
        game.error = 'Лишняя закрывающая скобка';
        break;
      }
      cur = saved.node;
      pos = saved.pos;
      ended = saved.ended;
      continue;
    }
    const legal = generateMoves(pos).filter((m) => m.captures.length > 0 === tok.cap);
    const mv = findMove(legal, tok.from, tok.to, tok.path.length > 1 ? tok.path : undefined);
    if (!mv) {
      game.error = `Ход ${tok.raw} невозможен или неоднозначен — разобрано ${game.movesParsed} полуходов`;
      break;
    }
    const depth = depths.get(cur.id)! + 1;
    if (depth > MAX_TREE_DEPTH) {
      game.error = `Линия превышает лимит ${MAX_TREE_DEPTH} полуходов`;
      break;
    }
    let child = cur.children.find((c) => c.move && sameMove(c.move, mv));
    if (!child) {
      if (++nodeCount > MAX_TREE_NODES) {
        game.error = `Превышен лимит ${MAX_TREE_NODES - 1} ходов в дереве`;
        break;
      }
      child = createNode(mv, cur);
      depths.set(child.id, depth);
      cur.children.push(child);
    }
    pos = applyMove(pos, mv);
    cur = child;
    posAt.set(cur.id, pos);
    game.movesParsed++;
    if (game.movesParsed > MAX_TREE_NODES - 1) {
      game.error = 'Превышен лимит ходов';
      break;
    }
  }
  if (!game.error && stack.length) game.error = 'Незакрытый вариант';
  return game;
}

function emitMove(node: TreeNode, pos: Pos, out: string[], num: number): Pos {
  const move = generateMoves(pos).find((m) => node.move && sameMove(m, node.move));
  if (!move) throw new Error('Нелегальный ход при экспорте PDN');
  out.push(`${num}${pos.side === WHITE ? '.' : '...'} ${moveNotation(move)}`);
  for (const nag of node.nags) out.push(`$${nag}`);
  if (node.comment) out.push(`{${node.comment.replace(/[{}]/g, (c) => (c === '{' ? '❴' : '❵'))}}`);
  return applyMove(pos, move);
}
function emitLine(node: TreeNode, pos: Pos, out: string[], num: number): void {
  const after = emitMove(node, pos, out, num);
  emitChildren(node, after, out, pos.side === WHITE ? num : num + 1);
}
function emitChildren(parent: TreeNode, pos: Pos, out: string[], num: number): void {
  const main = parent.children[0];
  if (!main) return;
  const after = emitMove(main, pos, out, num);
  for (const variant of parent.children.slice(1)) {
    out.push('(');
    emitLine(variant, pos, out, num);
    out.push(')');
  }
  emitChildren(main, after, out, pos.side === WHITE ? num : num + 1);
}
export function toPDNFull(opts: {
  headers: Record<string, string>;
  start: Pos;
  root: TreeNode;
  result: string;
}): string {
  const { headers, start, root, result } = opts;
  const merged: Record<string, string> = {
    Event: 'СтоКлетка · анализ',
    Site: '—',
    Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    White: '—',
    Black: '—',
    ...headers,
    GameType: '20',
    Result: result,
  };
  const fen = boardToFen(start.b, start.side);
  if (fen !== 'W:W31-50:B1-20') {
    merged.FEN = fen;
    merged.SetUp = '1';
  } else {
    delete merged.FEN;
    delete merged.SetUp;
  }
  const lines = Object.entries(merged).map(
    ([k, v]) =>
      `[${k} "${v
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/[\r\n]/g, ' ')}"]`,
  );
  const out: string[] = [];
  if (root.comment) out.push(`{${root.comment.replace(/[{}]/g, (c) => (c === '{' ? '❴' : '❵'))}}`);
  emitChildren(root, start, out, 1);
  out.push(result);
  return [...lines, '', out.join(' '), ''].join('\n');
}
/** Split only at top-level game boundaries, never inside comments or variations. */
export function splitGames(text: string): string[] {
  const blocks: string[] = [];
  const tokens = /\{[^}]*\}|\[\s*\w+\s+"(?:\\.|[^"\\])*"\s*\]|[()]|[^\s{}()[\]]+|[{}[\]]/g;
  let start = 0,
    depth = 0,
    body = false,
    ended = false;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith('{')) continue;
    const header = token.startsWith('[') && token.endsWith(']');
    if (!depth && ((header && body) || (ended && /^1\./.test(token)))) {
      const block = text.slice(start, match.index).trim();
      if (block) blocks.push(block);
      start = match.index;
      body = ended = false;
    }
    if (header) continue;
    if (token === '(') depth++;
    else if (token === ')') depth = Math.max(0, depth - 1);
    else {
      body = true;
      if (!depth && RESULTS.has(token)) ended = true;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) blocks.push(tail);
  return blocks;
}

export const SAMPLE_PDN = `[Event "Пример · варианты"]
[Result "*"]
1.32-28! (1.33-29 {Альтернативное начало}) 19-23 2.28x19 14x23 *
`;
