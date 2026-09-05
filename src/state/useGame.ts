/* ============================================================
 * useGame — состояние партии, ввод ходов, навигация, анализ
 * (Scan WASM → встроенный движок), нейросеть (обучение/загрузка/
 * очистка), авто-взятие, авто-ход, localStorage.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  boardToFen, findMove, generateMoves, parseFen, positionsFrom, startBoard, WHITE,
  type Move, type Pos, type Side,
} from '../engine/core';
import { engine, type AnalyzeHandle } from '../engine/client';
import { getScan, type ScanEngine } from '../engine/scan';
import { materialInfo, materialVerdict, type TbVerdict } from '../engine/tablebase';
import { parsePDN } from '../engine/pdn';
import { NNUE, type NetMeta } from '../engine/nn';
import { parseMultiPDN, trainNN } from '../engine/nntrain';
import type { Settings } from './settings';

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

export type EngineKind = 'alpha-beta' | 'scan';

const IDLE: EngineState = {
  thinking: false, forKey: '', depth: 0, nodes: 0, nps: 0, ms: 0, score: null,
  best: null, candidates: [], pv: [], mate: false, book: null,
};

export interface TrainResult {
  ok: boolean;
  error?: string;
  games?: number;
  positions?: number;
  loss?: number;
}

const GAME_KEY = 'sk100.game.v3';
const NET_KEY = 'sk100.net.v2';
const NN_EPOCHS = 30;
const NN_LR = 0.003;

export function useGame(s: Settings) {
  const [state, setState] = useState(() => {
    const fresh = {
      start: { b: startBoard(), side: WHITE } as Pos,
      moves: [] as Move[],
      ply: 0,
      flipped: false,
      showNums: true,
      headers: {} as Record<string, string>,
    };
    try {
      const raw = localStorage.getItem(GAME_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const start = (d.startFen && parseFen(d.startFen)) || { b: startBoard(), side: WHITE };
        let moves: Move[] = [];
        if (Array.isArray(d.pdn)) moves = parsePDN(d.pdn.join('\n')).moves;
        const ply = Math.min(d.ply ?? moves.length, moves.length);
        /* защита от «встречи с победителем»: битые/завершённые сохранения отбрасываем */
        const cur = positionsFrom(start, moves, ply)[ply] ?? start;
        if (generateMoves(cur).length === 0) {
          localStorage.removeItem(GAME_KEY);
          return fresh;
        }
        return {
          start, moves, ply,
          flipped: !!d.flipped,
          showNums: d.showNums !== false,
          headers: (d.headers ?? {}) as Record<string, string>,
        };
      }
    } catch { /* повреждённое хранилище — начинаем заново */ }
    return fresh;
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
  const [engineKind, setEngineKind] = useState<EngineKind>('alpha-beta');
  const [scanAvail, setScanAvail] = useState(false);

  const boardKey = useMemo(() => pos.b.join('') + pos.side, [pos]);
  const lastMove = ply > 0 ? moves[ply - 1] : null;
  const startFen = useMemo(() => boardToFen(start), [start]);
  const fen = useMemo(() => boardToFen(pos.b, pos.side), [pos]);

  const flashHint = useCallback((msg: string) => {
    setHint(msg);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2200);
  }, []);

  /* ---------- нейросеть (загрузка из хранилища) ---------- */
  const [nnMeta, setNnMeta] = useState<NetMeta | null>(() => {
    try {
      const raw = localStorage.getItem(NET_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { meta?: NetMeta };
        if (d.meta) return d.meta;
      }
    } catch { /* noop */ }
    return null;
  });
  const [training, setTraining] = useState(false);
  const [trainProg, setTrainProg] = useState<{ epoch: number; loss: number; valLoss: number; stopped?: boolean } | null>(null);
  const trainToken = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NET_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { json?: string };
        if (d.json) engine.setNet(d.json);
      }
    } catch { /* noop */ }
  }, []);

  /* ---------- доступность Scan WASM ---------- */
  useEffect(() => {
    let on = true;
    void getScan().then((scan) => {
      if (on) setScanAvail(scan !== null);
    });
    return () => { on = false; };
  }, []);

  /* ---------- база фигур ---------- */
  const tb = useMemo<TbVerdict | null>(() => {
    const m = materialInfo(pos.b);
    return m.total <= 9 ? materialVerdict(m) : null;
  }, [pos]);

  /* ---------- анализ: Scan (если есть) → встроенный движок ---------- */
  const scanRef = useRef<ScanEngine | null>(null);
  const genRef = useRef(0);

  useEffect(() => {
    const gen = ++genRef.current;
    if (legal.length === 0) {
      setEngineState({ ...IDLE, forKey: boardKey });
      return;
    }
    setEngineState((e) => ({ ...IDLE, thinking: true, forKey: e.forKey }));

    const history = moves.slice(0, ply).map((m) => m.from * 100 + m.to);

    void (async () => {
      /* 1) пробуем Scan WASM */
      if (s.useScan) {
        const scan = scanRef.current ?? await getScan();
        scanRef.current = scan;
        if (scan && genRef.current === gen) {
          const t0 = performance.now();
          const r = await scan.analyze(fen, s.engineTime);
          if (genRef.current !== gen) return;
          if (r && findMove(legal, r.from, r.to)) {
            const ms = Math.max(1, Math.round(performance.now() - t0));
            setEngineKind('scan');
            setEngineState({
              thinking: false, forKey: boardKey, depth: r.depth, nodes: 0, nps: 0, ms,
              score: r.scoreWhite !== null ? r.scoreWhite * pos.side : null,
              best: { from: r.from, to: r.to },
              candidates: [{ from: r.from, to: r.to, caps: findMove(legal, r.from, r.to)?.captures.length ?? 0, score: r.scoreWhite !== null ? r.scoreWhite * pos.side : 0 }],
              pv: [{ from: r.from, to: r.to }],
              mate: false, book: null,
            });
            return;
          }
        }
      }

      /* 2) встроенный движок в отдельном потоке */
      if (genRef.current !== gen) return;
      setEngineKind('alpha-beta');
      const handle: AnalyzeHandle = engine.analyze(
        {
          fen, history, startFen,
          timeMs: s.engineTime, maxDepth: s.engineDepth,
          humanStyle: s.humanStyle, nnEnabled: s.nnEnabled, nnBlend: s.nnBlend,
        },
        (info) => {
          if (genRef.current !== gen) return;
          setEngineState((e) => (e.thinking ? { ...e, depth: info.depth, nodes: info.nodes, score: info.score } : e));
        },
      );
      const res = await handle.promise;
      if (genRef.current !== gen) return;
      if (!res) { setEngineState({ ...IDLE, forKey: boardKey }); return; }
      setEngineState({
        thinking: false, forKey: boardKey, depth: res.depth, nodes: res.nodes,
        nps: res.nps, ms: res.ms, score: res.score, best: res.best,
        candidates: res.candidates, pv: res.pv, mate: res.mate, book: res.book,
      });
    })();

    return () => { genRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, fen, startFen, ply, legal, s.engineDepth, s.engineTime, s.humanStyle, s.nnEnabled, s.nnBlend, s.useScan]);

  /* ---------- сохранение партии ---------- */
  useEffect(() => {
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify({
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

  /* ---------- автопроигрывание ---------- */
  useEffect(() => {
    if (!auto) return;
    if (ply >= moves.length) { setAuto(false); return; }
    const t = window.setTimeout(() => setState((st) => ({ ...st, ply: Math.min(st.ply + 1, st.moves.length) })), 650);
    return () => window.clearTimeout(t);
  }, [auto, ply, moves.length]);

  const goto = useCallback((p: number) => {
    setSelected(null);
    setState((st) => ({ ...st, ply: Math.max(0, Math.min(p, st.moves.length)) }));
  }, []);

  const playFromTo = useCallback((from: number, to: number): boolean => {
    const m = findMove(legal, from, to);
    if (!m) return false;
    setSelected(null);
    setState((st) => {
      const cur = positionsFrom(st.start, st.moves, st.ply)[st.ply] ?? st.start;
      const chosen = findMove(generateMoves(cur), from, to);
      if (!chosen) return st;
      return { ...st, moves: [...st.moves.slice(0, st.ply), chosen], ply: st.ply + 1 };
    });
    return true;
  }, [legal]);

  /* ---------- авто-взятие (только на живом конце партии) ---------- */
  const engineRef = useRef(engineState);
  engineRef.current = engineState;

  useEffect(() => {
    if (!s.autoCapture || winner !== null || !mustCapture) return;
    if (ply !== moves.length) return;
    const t = window.setTimeout(() => {
      const eng = engineRef.current;
      let choice = legal[0];
      if (eng.best && eng.forKey === boardKey) {
        const byEngine = legal.find((m) => m.from === eng.best!.from && m.to === eng.best!.to);
        if (byEngine) choice = byEngine;
      }
      if (choice) playFromTo(choice.from, choice.to);
    }, s.captureDelay);
    return () => window.clearTimeout(t);
  }, [s.autoCapture, s.captureDelay, boardKey, winner, mustCapture, ply, moves.length, legal, playFromTo]);

  const clickSquare = useCallback((n: number) => {
    if (winner !== null) return;
    if (selected !== null) {
      if (n === selected) { setSelected(null); return; }
      const m = findMove(legal, selected, n);
      if (m) { playFromTo(selected, n); return; }
    }
    if (movableFroms.has(n) && pos.b[n] * pos.side > 0) {
      if (s.autoSingle) {
        const mine = legal.filter((m) => m.from === n);
        const dests = new Set(mine.map((m) => m.to));
        if (mine.length > 0 && dests.size === 1) {
          playFromTo(n, mine[0].to);
          return;
        }
      }
      setSelected(n);
      return;
    }
    if (mustCapture && pos.b[n] * pos.side > 0) {
      flashHint('Взятие обязательно — выберите шашку, которая бьёт');
    }
    setSelected(null);
  }, [selected, legal, movableFroms, mustCapture, pos, winner, playFromTo, flashHint, s.autoSingle]);

  const newGame = useCallback(() => {
    setSelected(null); setAuto(false);
    setState((st) => ({ ...st, start: { b: startBoard(), side: WHITE }, moves: [], ply: 0, headers: {} }));
  }, []);

  const loadFenText = useCallback((text: string): string | null => {
    const p = parseFen(text);
    if (!p) return 'Не удалось разобрать FEN — проверьте формат (W:W…:B…)';
    if (generateMoves(p).length === 0) return 'У стороны, делающей ход, нет ходов';
    setSelected(null); setAuto(false);
    setState((st) => ({ ...st, start: p, moves: [], ply: 0, headers: { ...st.headers, FEN: text.trim() } }));
    return null;
  }, []);

  const loadPDNText = useCallback((text: string): string | null => {
    const doc = parsePDN(text);
    if (doc.moves.length === 0 && doc.error) return doc.error;
    setSelected(null); setAuto(false);
    setState((st) => ({
      ...st, start: doc.start, moves: doc.moves,
      ply: doc.errorIndex >= 0 ? doc.errorIndex : doc.moves.length,
      headers: doc.headers,
    }));
    return doc.error;
  }, []);

  /* ---------- обучение нейросети (v2) ---------- */
  const trainOnPDN = useCallback(async (text: string): Promise<TrainResult> => {
    const parsed = parseMultiPDN(text);
    if (parsed.samples.length === 0) {
      return { ok: false, error: 'Не найдено партий с результатом (1-0 / 0-1 / 1-1)' };
    }
    if (trainToken.current) trainToken.current.cancelled = true;
    const token = { cancelled: false };
    trainToken.current = token;

    const net = new NNUE();
    setTraining(true);
    setTrainProg({ epoch: 0, loss: 1, valLoss: 1 });

    const meta = await trainNN(net, parsed.samples, NN_EPOCHS, NN_LR, (p) => setTrainProg(p), token);
    if (token.cancelled) { setTraining(false); return { ok: false, error: 'Обучение отменено' }; }

    const json = net.serialize();
    const fullMeta: NetMeta = { ...meta, games: parsed.games };
    try { localStorage.setItem(NET_KEY, JSON.stringify({ json, meta: fullMeta })); } catch { /* quota */ }
    setNnMeta(fullMeta);
    engine.setNet(json);
    setTraining(false);
    setTrainProg(null);
    return { ok: true, games: parsed.games, positions: parsed.samples.length, loss: fullMeta.loss };
  }, []);

  const clearNet = useCallback(() => {
    if (trainToken.current) trainToken.current.cancelled = true;
    try { localStorage.removeItem(NET_KEY); } catch { /* noop */ }
    setNnMeta(null);
    engine.setNet(null);
  }, []);

  return {
    start, moves, ply, pos, legal, selected, clickSquare, lastMove, winner,
    mustCapture, movableFroms, goto, toStart: () => goto(0), toEnd: () => goto(moves.length),
    prev: () => goto(ply - 1), next: () => goto(ply + 1), playFromTo, newGame,
    flipped, toggleFlip: () => setState((st) => ({ ...st, flipped: !st.flipped })),
    showNums, toggleNums: () => setState((st) => ({ ...st, showNums: !st.showNums })),
    auto, setAuto, fen, headers, loadFenText, loadPDNText, boardKey,
    engine: engineState, engineKind, scanAvail, tb, hint,
    nnMeta, training, trainProg, trainOnPDN, clearNet,
  };
}

export type GameApi = ReturnType<typeof useGame>;
