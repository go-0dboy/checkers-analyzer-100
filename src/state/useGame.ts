/* ============================================================
 * useGame — состояние партии, навигация, ввод ходов мышью/пальцем,
 * автопроигрывание, подключение движка и сохранение в localStorage.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Pos, type Move, type Side, WHITE, applyMove, boardToFen, findMove,
  generateMoves, parseFen, positionsFrom, startBoard,
} from '../engine/core';
import { analyze, type Candidate } from '../engine/search';
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

interface GameState {
  start: Pos;
  moves: Move[];
  ply: number;
  flipped: boolean;
  showNums: boolean;
  headers: Record<string, string>;
}

const LS_KEY = 'stokletka:game:v1';

function freshState(): GameState {
  return {
    start: { b: startBoard(), side: WHITE },
    moves: [],
    ply: 0,
    flipped: false,
    showNums: true,
    headers: {},
  };
}

function loadState(): GameState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return freshState();
    const d = JSON.parse(raw) as {
      startFen?: string;
      moves?: { from: number; to: number; path: number[]; captures: number[]; king: boolean }[];
      ply?: number;
      flipped?: boolean;
      showNums?: boolean;
      headers?: Record<string, string>;
    };
    const start = (d.startFen && parseFen(d.startFen)) || { b: startBoard(), side: WHITE };
    // Валидация сохранённых ходов: применяем только легальные
    const moves: Move[] = [];
    let cur = start;
    for (const m of d.moves ?? []) {
      const found = findMove(generateMoves(cur), m.from, m.to);
      if (!found) break;
      moves.push(found);
      cur = applyMove(cur, found);
    }
    const ply = Math.min(Math.max(d.ply ?? moves.length, 0), moves.length);
    return {
      start, moves, ply,
      flipped: !!d.flipped,
      showNums: d.showNums !== false,
      headers: d.headers ?? {},
    };
  } catch {
    return freshState();
  }
}

export function useGame() {
  const [state, setState] = useState<GameState>(loadState);
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [engine, setEngine] = useState<EngineState>(IDLE);
  const hintTimer = useRef<number | undefined>(undefined);

  const positions = useMemo(() => positionsFrom(state.start, state.moves), [state.start, state.moves]);
  const pos = positions[state.ply];
  const legal = useMemo(() => generateMoves(pos), [pos]);
  const lastMove = state.ply > 0 ? state.moves[state.ply - 1] : null;
  const mustCapture = legal.length > 0 && legal[0].captures.length > 0;
  const winner: Side | null = legal.length === 0 ? (pos.side === WHITE ? -1 : 1) : null;
  const fen = useMemo(() => boardToFen(pos), [pos]);
  const boardKey = useMemo(() => pos.b.join('') + pos.side, [pos]);

  const movableFroms = useMemo(() => {
    const s = new Set<number>();
    for (const m of legal) s.add(m.from);
    return s;
  }, [legal]);

  /* ---------- персистентность ---------- */
  useEffect(() => {
    try {
      const data = {
        startFen: boardToFen(state.start),
        moves: state.moves.map((m) => ({
          from: m.from, to: m.to, path: m.path, captures: m.captures, king: m.king,
        })),
        ply: state.ply,
        flipped: state.flipped,
        showNums: state.showNums,
        headers: state.headers,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch { /* приватный режим — игнорируем */ }
  }, [state]);

  /* ---------- движок ---------- */
  useEffect(() => {
    if (winner !== null) { setEngine(IDLE); return; }
    const token = { cancelled: false };
    setEngine((e) => ({ ...IDLE, thinking: true, forKey: boardKey }));
    analyze(pos, { timeMs: 1300, maxDepth: 9 },
      (p) => {
        if (!token.cancelled) {
          setEngine((e) => ({ ...e, depth: p.depth, nodes: p.nodes, score: p.score }));
        }
      }, token)
      .then((res) => {
        if (token.cancelled) return;
        setEngine({
          thinking: false, forKey: boardKey, depth: res.depth, nodes: res.nodes,
          score: res.score, best: res.best, candidates: res.candidates, pv: res.pv, mate: res.mate,
        });
      })
      .catch(() => { /* прервано */ });
    return () => { token.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);

  /* ---------- автопроигрывание ---------- */
  useEffect(() => {
    if (!auto) return;
    if (state.ply >= state.moves.length) { setAuto(false); return; }
    const t = window.setTimeout(() => {
      setState((s) => ({ ...s, ply: Math.min(s.ply + 1, s.moves.length) }));
    }, 900);
    return () => window.clearTimeout(t);
  }, [auto, state.ply, state.moves.length]);

  /* ---------- действия ---------- */
  const flashHint = useCallback((text: string) => {
    setHint(text);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2400);
  }, []);

  const playMove = useCallback((m: Move) => {
    setState((s) => {
      const base = s.moves.slice(0, s.ply); // ветвление: хвост отбрасывается
      return { ...s, moves: [...base, m], ply: s.ply + 1 };
    });
    setSelected(null);
    setAuto(false);
  }, []);

  const playFromTo = useCallback((from: number, to: number): boolean => {
    const m = findMove(legal, from, to);
    if (!m) return false;
    playMove(m);
    return true;
  }, [legal, playMove]);

  const clickSquare = useCallback((n: number) => {
    if (winner !== null) return;
    const v = pos.b[n];
    const own = v !== 0 && v * pos.side > 0;
    if (selected !== null) {
      if (n === selected) { setSelected(null); return; }
      const m = findMove(legal, selected, n);
      if (m) { playMove(m); return; }
      if (own) {
        if (movableFroms.has(n)) setSelected(n);
        else flashHint(mustCapture ? 'Взятие обязательно: эта шашка бить не может' : 'У этой шашки нет ходов');
        return;
      }
      setSelected(null);
      return;
    }
    if (own) {
      if (movableFroms.has(n)) setSelected(n);
      else flashHint(mustCapture ? 'Взятие обязательно: выберите шашку, которая бьёт' : 'У этой шашки нет ходов');
    }
  }, [winner, pos, selected, legal, movableFroms, mustCapture, playMove, flashHint]);

  const goto = useCallback((ply: number) => {
    setSelected(null);
    setState((s) => ({ ...s, ply: Math.min(Math.max(ply, 0), s.moves.length) }));
  }, []);

  const newGame = useCallback(() => {
    setState((s) => ({ ...freshState(), flipped: s.flipped, showNums: s.showNums }));
    setSelected(null);
    setAuto(false);
  }, []);

  const loadFenText = useCallback((text: string): string | null => {
    const p = parseFen(text);
    if (!p) return 'Не удалось разобрать FEN. Пример: W:W31-50:B1-20';
    setState((s) => ({ ...s, start: p, moves: [], ply: 0 }));
    setSelected(null);
    setAuto(false);
    return null;
  }, []);

  const loadPDNText = useCallback((text: string): string | null => {
    const doc = parsePDN(text);
    if (doc.moves.length === 0 && doc.error) return doc.error;
    if (doc.moves.length === 0 && !doc.error && Object.keys(doc.headers).length === 0 && !text.trim()) {
      return 'Пустой текст — вставьте партию в формате PDN';
    }
    setState((s) => ({
      ...s,
      start: doc.start,
      moves: doc.moves,
      ply: doc.moves.length,
      headers: doc.headers,
    }));
    setSelected(null);
    setAuto(false);
    return doc.error;
  }, []);

  const toggleFlip = useCallback(() => setState((s) => ({ ...s, flipped: !s.flipped })), []);
  const toggleNums = useCallback(() => setState((s) => ({ ...s, showNums: !s.showNums })), []);

  return {
    state, pos, positions, ply: state.ply, legal, lastMove, mustCapture, winner,
    fen, boardKey, movableFroms, selected, hint, auto,
    engine, positionsCount: positions.length,
    flipped: state.flipped, showNums: state.showNums, headers: state.headers,
    clickSquare, playMove, playFromTo, goto, newGame,
    toStart: () => goto(0),
    prev: () => goto(state.ply - 1),
    next: () => goto(state.ply + 1),
    toEnd: () => goto(state.moves.length),
    setAuto, toggleFlip, toggleNums,
    loadFenText, loadPDNText,
    moves: state.moves,
  };
}

export type GameApi = ReturnType<typeof useGame>;
