/* ============================================================
 * useGame — состояние партии, ввод ходов, навигация, движок
 * (отдельный поток), дебютная книга, база фигур, localStorage.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Pos, type Move, type Side, WHITE, boardToFen, findMove,
  generateMoves, parseFen, positionsFrom, startBoard,
} from '../engine/core';
import { engine, type AnalyzeHandle } from '../engine/client';
import { materialInfo, materialVerdict, type TbVerdict } from '../engine/tablebase';
import { parsePDN } from '../engine/pdn';

export interface CandidateLite { from: number; to: number; caps: number; score: number }

export interface EngineState {
  thinking: boolean;
  forKey: string;
  depth: number;
  nodes: number;
  nps: number;
  ms: number;
  score: number | null;
  best: { from: number; to: number } | null;
  candidates: CandidateLite[];
  pv: { from: number; to: number }[];
  mate: boolean;
  book: string | null;
}

const IDLE: EngineState = {
  thinking: false, forKey: '', depth: 0, nodes: 0, nps: 0, ms: 0, score: null,
  best: null, candidates: [], pv: [], mate: false, book: null,
};

const STORE_KEY = 'sk100.game.v1';
const TIME_MS = 1300;
const MAX_DEPTH = 11;

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
        let moves: Move[] = [];
        if (Array.isArray(d.pdn)) {
          moves = parsePDN(d.pdn.join('\n')).moves;
        }
        return {
          start,
          moves,
          ply: Math.min(d.ply ?? moves.length, moves.length),
          flipped: !!d.flipped,
          showNums: d.showNums !== false,
          headers: (d.headers ?? {}) as Record<string, string>,
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

  const pos = useMemo(() => positionsFrom(start, moves, ply)[ply] ?? start, [start, moves, ply]);
  const legal = useMemo(() => generateMoves(pos), [pos]);
  const winner = useMemo<Side | null>(
    () => (legal.length === 0 ? ((pos.side === WHITE ? -1 : 1) as Side) : null),
    [legal, pos],
  );
  const mustCapture = legal.length > 0 && legal[0].captures.length > 0;
  const movableFroms = useMemo(() => new Set(legal.map((m) => m.from)), [legal]);

  const [selected, setSelected] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | undefined>(undefined);
  const [engineState, setEngineState] = useState<EngineState>(IDLE);

  const boardKey = useMemo(() => pos.b.join('') + pos.side, [pos]);
  const lastMove = ply > 0 ? moves[ply - 1] : null;
  const startFen = useMemo(() => boardToFen(start), [start]);
  const fen = useMemo(() => boardToFen(pos.b, pos.side), [pos]);

  const flashHint = useCallback((msg: string) => {
    setHint(msg);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2200);
  }, []);

  /* база фигур: мгновенный вердикт по составу материала */
  const tb = useMemo<TbVerdict | null>(() => {
    const m = materialInfo(pos.b);
    return m.total <= 9 ? materialVerdict(m) : null;
  }, [pos]);

  /* движок в отдельном потоке */
  const genRef = useRef(0);
  useEffect(() => {
    const gen = ++genRef.current;
    if (legal.length === 0) {
      setEngineState({ ...IDLE, forKey: boardKey });
      return;
    }
    setEngineState((e) => ({ ...IDLE, thinking: true, forKey: e.forKey }));
    const history = moves.slice(0, ply).map((m) => m.from * 100 + m.to);
    const handle: AnalyzeHandle = engine.analyze(
      { fen, history, startFen, timeMs: TIME_MS, maxDepth: MAX_DEPTH },
      (info) => {
        if (genRef.current !== gen) return;
        setEngineState((e) => (e.thinking ? { ...e, depth: info.depth, nodes: info.nodes, score: info.score } : e));
      },
    );
    void handle.promise.then((res) => {
      if (genRef.current !== gen) return;
      if (!res) { setEngineState({ ...IDLE, forKey: boardKey }); return; }
      setEngineState({
        thinking: false, forKey: boardKey, depth: res.depth, nodes: res.nodes,
        nps: res.nps, ms: res.ms, score: res.score, best: res.best,
        candidates: res.candidates, pv: res.pv, mate: res.mate, book: res.book,
      });
    });
    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, fen, startFen, ply, legal.length]);

  /* сохранение */
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        startFen,
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
  }, [startFen, moves, ply, flipped, showNums, headers]);

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

  const playFromTo = useCallback((from: number, to: number): boolean => {
    const m = findMove(legal, from, to);
    if (!m) return false;
    setSelected(null);
    setState((s) => {
      const cur = positionsFrom(s.start, s.moves, s.ply)[s.ply] ?? s.start;
      const chosen = findMove(generateMoves(cur), from, to);
      if (!chosen) return s;
      return { ...s, moves: [...s.moves.slice(0, s.ply), chosen], ply: s.ply + 1 };
    });
    return true;
  }, [legal]);

  const clickSquare = useCallback((n: number) => {
    if (winner !== null) return;
    if (selected !== null) {
      if (n === selected) { setSelected(null); return; }
      const m = findMove(legal, selected, n);
      if (m) { playFromTo(selected, n); return; }
    }
    if (movableFroms.has(n) && pos.b[n] * pos.side > 0) { setSelected(n); return; }
    if (mustCapture && pos.b[n] * pos.side > 0) {
      flashHint('Взятие обязательно — выберите шашку, которая бьёт');
    }
    setSelected(null);
  }, [selected, legal, movableFroms, mustCapture, pos, winner, playFromTo, flashHint]);

  const newGame = useCallback(() => {
    setSelected(null); setAuto(false);
    setState((s) => ({ ...s, start: { b: startBoard(), side: WHITE }, moves: [], ply: 0, headers: {} }));
  }, []);

  const loadFenText = useCallback((text: string): string | null => {
    const p = parseFen(text);
    if (!p) return 'Не удалось разобрать FEN — проверьте формат (W:W…:B…)';
    if (generateMoves(p).length === 0) return 'У стороны, делающей ход, нет ходов';
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

  return {
    start, moves, ply, pos, legal, selected, clickSquare, lastMove, winner,
    mustCapture, movableFroms, goto, toStart: () => goto(0), toEnd: () => goto(moves.length),
    prev: () => goto(ply - 1), next: () => goto(ply + 1), playFromTo, newGame,
    flipped, toggleFlip: () => setState((s) => ({ ...s, flipped: !s.flipped })),
    showNums, toggleNums: () => setState((s) => ({ ...s, showNums: !s.showNums })),
    auto, setAuto, fen, headers, loadFenText, loadPDNText, boardKey,
    engine: engineState, tb, hint,
  };
}
