/* ============================================================
 * useGame — состояние партии, ввод ходов, навигация, движок,
 * база фигур и сохранение в localStorage.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Pos, type Move, type Side, WHITE, applyMove, boardToFen, findMove,
  generateMoves, parseFen, positionsFrom, startBoard,
} from '../engine/core';
import { analyze, type Candidate } from '../engine/search';
import { materialInfo, materialVerdict, type TbVerdict } from '../engine/tablebase';
import { parsePDN } from '../engine/pdn';

export interface EngineState {
  thinking: boolean;
  forKey: string;
  depth: number;
  nodes: number;
  score: number | null;
  best: Move | null;
  candidates: Candidate[];
  pv: Move[];
  mate: boolean;
}

const IDLE: EngineState = {
  thinking: false, forKey: '', depth: 0, nodes: 0, score: null,
  best: null, candidates: [], pv: [], mate: false,
};

const STORE_KEY = 'sk100.game.v1';
const TIME_MS = 1100;
const MAX_DEPTH = 9;

export interface GameApi {
  start: Pos;
  moves: Move[];
  ply: number;
  pos: Pos;
  legal: Move[];
  selected: number | null;
  clickSquare: (n: number) => void;
  lastMove: Move | null;
  winner: Side | null;
  mustCapture: boolean;
  movableFroms: Set<number>;
  goto: (ply: number) => void;
  toStart: () => void;
  toEnd: () => void;
  prev: () => void;
  next: () => void;
  playFromTo: (from: number, to: number) => boolean;
  playMove: (m: Move) => void;
  newGame: () => void;
  flipped: boolean;
  toggleFlip: () => void;
  showNums: boolean;
  toggleNums: () => void;
  auto: boolean;
  setAuto: (v: boolean) => void;
  fen: string;
  headers: Record<string, string>;
  loadFenText: (text: string) => string | null;
  loadPDNText: (text: string) => string | null;
  boardKey: string;
  engine: EngineState;
  tb: TbVerdict | null;
  hint: string | null;
}

export function useGame(): GameApi {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const start = (d.startFen && parseFen(d.startFen)) || { b: startBoard(), side: WHITE };
        const doc = { headers: d.headers ?? {}, start, moves: [] as Move[], result: '*', error: null, errorIndex: -1 };
        if (Array.isArray(d.pdn)) {
          const parsed = parsePDN(d.pdn.join('\n'));
          doc.moves = parsed.moves;
        }
        return {
          start: doc.start,
          moves: doc.moves,
          ply: Math.min(d.ply ?? doc.moves.length, doc.moves.length),
          flipped: !!d.flipped,
          showNums: d.showNums !== false,
          headers: doc.headers,
        };
      }
    } catch { /* повреждённое хранилище — начинаем заново */ }
    return {
      start: { b: startBoard(), side: WHITE } as Pos,
      moves: [] as Move[],
      ply: 0,
      flipped: false,
      showNums: true,
      headers: {} as Record<string, string>,
    };
  });

  const { start, moves, ply, flipped, showNums, headers } = state;

  const positions = useMemo(() => positionsFrom(start, moves, moves.length), [start, moves]);
  const pos = useMemo(() => positionsFrom(start, moves, ply)[ply] ?? start, [start, moves, ply]);

  const legal = useMemo(() => generateMoves(pos), [pos]);
  const winner = useMemo<Side | null>(() => (legal.length === 0 ? ((pos.side === WHITE ? -1 : 1) as Side) : null), [legal, pos]);
  const mustCapture = legal.length > 0 && legal[0].captures.length > 0;
  const movableFroms = useMemo(() => new Set(legal.map((m) => m.from)), [legal]);

  const [selected, setSelected] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | undefined>(undefined);
  const [engine, setEngine] = useState<EngineState>(IDLE);

  const boardKey = useMemo(() => pos.b.join('') + pos.side, [pos]);
  const lastMove = ply > 0 ? moves[ply - 1] : null;

  const flashHint = useCallback((msg: string) => {
    setHint(msg);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2200);
  }, []);

  /* база фигур: точный вердикт по составу материала */
  const tb = useMemo<TbVerdict | null>(() => {
    const m = materialInfo(pos.b);
    return m.total <= 9 ? materialVerdict(m) : null;
  }, [pos]);

  /* движок */
  useEffect(() => {
    const token = { cancelled: false };
    if (legal.length === 0) {
      setEngine({ ...IDLE, forKey: boardKey });
      return () => { token.cancelled = true; };
    }
    setEngine((e) => ({ ...IDLE, thinking: true, forKey: e.forKey }));
    analyze(pos, { timeMs: TIME_MS, maxDepth: MAX_DEPTH }, (p) => {
      if (token.cancelled) return;
      setEngine((e) => ({ ...e, depth: p.depth, nodes: p.nodes, score: p.score }));
    }, token).then((res) => {
      if (token.cancelled) return;
      setEngine({
        thinking: false, forKey: boardKey, depth: res.depth, nodes: res.nodes,
        score: res.best ? res.score : null, best: res.best, candidates: res.candidates,
        pv: res.pv, mate: res.mate,
      });
    });
    return () => { token.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);

  /* сохранение */
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        startFen: boardToFen(start),
        pdn: moves.length > 0 ? [
          Object.entries(headers).map(([k, v]) => `[${k} "${v}"]`).join('\n'),
          ...Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => {
            const w = moves[i * 2]; const b = moves[i * 2 + 1];
            return `${i + 1}.${w.from}${w.captures.length ? 'x' : '-'}${w.to}${b ? ` ${b.from}${b.captures.length ? 'x' : '-'}${b.to}` : ''}`;
          }),
        ] : [],
        ply, flipped, showNums, headers,
      }));
    } catch { /* приватный режим */ }
  }, [start, moves, ply, flipped, showNums, headers]);

  /* автопроигрывание */
  useEffect(() => {
    if (!auto) return;
    if (ply >= moves.length) { setAuto(false); return; }
    const t = window.setTimeout(() => setState((s) => ({ ...s, ply: Math.min(s.ply + 1, s.moves.length) })), 650);
    return () => window.clearTimeout(t);
  }, [auto, ply, moves.length]);

  const goto = useCallback((p: number) => {
    setSelected(null);
    setState((s) => ({ ...s, ply: Math.max(0, Math.min(p, s.moves.length)) }));
  }, []);

  const playMove = useCallback((m: Move) => {
    setState((s) => {
      const cur = positionsFrom(s.start, s.moves, s.ply)[s.ply] ?? s.start;
      const legalNow = generateMoves(cur);
      const chosen = findMove(legalNow, m.from, m.to);
      if (!chosen) return s;
      const prefix = s.moves.slice(0, s.ply);
      return { ...s, moves: [...prefix, chosen], ply: s.ply + 1 };
    });
    setSelected(null);
  }, []);

  const playFromTo = useCallback((from: number, to: number): boolean => {
    const m = findMove(legal, from, to);
    if (!m) return false;
    playMove(m);
    return true;
  }, [legal, playMove]);

  const clickSquare = useCallback((n: number) => {
    if (winner !== null) return;
    if (selected !== null) {
      if (n === selected) { setSelected(null); return; }
      const m = findMove(legal, selected, n);
      if (m) { playMove(m); return; }
    }
    if (movableFroms.has(n) && pos.b[n] * pos.side > 0) {
      setSelected(n);
      return;
    }
    if (mustCapture && pos.b[n] * pos.side > 0 && !movableFroms.has(n)) {
      flashHint('Взятие обязательно — выберите шашку, которая бьёт');
    }
    setSelected(null);
  }, [selected, legal, movableFroms, mustCapture, pos, winner, playMove, flashHint]);

  const newGame = useCallback(() => {
    setSelected(null); setAuto(false);
    setState((s) => ({ ...s, start: { b: startBoard(), side: WHITE }, moves: [], ply: 0, headers: {} }));
  }, []);

  const loadFenText = useCallback((text: string): string | null => {
    const p = parseFen(text);
    if (!p) return 'Не удалось разобрать FEN — проверьте формат (W:W…:B…)';
    if (generateMoves(p).length === 0) return 'В этой позиции у стороны, делающей ход, нет ходов';
    setSelected(null); setAuto(false);
    setState((s) => ({ ...s, start: p, moves: [], ply: 0, headers: { ...s.headers, FEN: text.trim() } }));
    return null;
  }, []);

  const loadPDNText = useCallback((text: string): string | null => {
    const doc = parsePDN(text);
    if (doc.moves.length === 0 && doc.error) return doc.error;
    setSelected(null); setAuto(false);
    setState((s) => ({
      ...s, start: doc.start, moves: doc.moves,
      ply: doc.errorIndex >= 0 ? doc.errorIndex : doc.moves.length,
      headers: doc.headers,
    }));
    return doc.error;
  }, []);

  const fen = useMemo(() => boardToFen(pos.b, pos.side), [pos]);

  return {
    start, moves, ply, pos, legal, selected, clickSquare, lastMove, winner,
    mustCapture, movableFroms, goto, toStart: () => goto(0), toEnd: () => goto(moves.length),
    prev: () => goto(ply - 1), next: () => goto(ply + 1), playFromTo, playMove, newGame,
    flipped, toggleFlip: () => setState((s) => ({ ...s, flipped: !s.flipped })),
    showNums, toggleNums: () => setState((s) => ({ ...s, showNums: !s.showNums })),
    auto, setAuto, fen, headers, loadFenText, loadPDNText, boardKey, engine, tb, hint,
  };
}
