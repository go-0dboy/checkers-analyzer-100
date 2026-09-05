/* ============================================================
 * useGame — состояние разбора: дерево ходов с ветвлениями,
 * комментарии и NAG, навигация, анализ (Scan WASM → встроенный
 * движок), нейросеть, авто-взятие/авто-ход, IndexedDB, сохранение.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  boardToFen, findMove, generateMoves, parseFen, startBoard, WHITE,
  type Move, type Pos, type Side,
} from '../engine/core';
import { engine, type AnalyzeHandle } from '../engine/client';
import { getScan, type ScanEngine } from '../engine/scan';
import { materialInfo, materialVerdict, type TbVerdict } from '../engine/tablebase';
import { parsePDNFull, toPDNFull } from '../engine/pdn';
import { NNUE, type NetMeta } from '../engine/nn';
import { parseMultiPDN, trainNN } from '../engine/nntrain';
import type { Settings } from './settings';
import {
  createNode, deserializeTree, mainlineLength, pathPositions, pathTo,
  rootTree, serializeTree, type TreeNode,
} from './tree';
import { deleteGame, listGames, saveGame, type DbGame } from './db';

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

const GAME_KEY = 'sk100.game.v4';
const NET_KEY = 'sk100.net.v2';
const NN_EPOCHS = 30;
const NN_LR = 0.003;

interface GameState {
  start: Pos;
  root: TreeNode;
  /** путь от корня: id узлов */
  path: string[];
  flipped: boolean;
  showNums: boolean;
  headers: Record<string, string>;
  result: string;
}

export function useGame(s: Settings) {
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const [state, setState] = useState<GameState>(() => {
    const fresh = (): GameState => ({
      start: { b: startBoard(), side: WHITE },
      root: rootTree(),
      path: [],
      flipped: false,
      showNums: true,
      headers: {},
      result: '*',
    });
    try {
      const raw = localStorage.getItem(GAME_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const start = (d.startFen && parseFen(d.startFen)) || { b: startBoard(), side: WHITE };
        const root = (d.treeJson && deserializeTree(d.treeJson)) || rootTree();
        const path: string[] = Array.isArray(d.path) ? d.path : [];
        return {
          start, root, path,
          flipped: !!d.flipped,
          showNums: d.showNums !== false,
          headers: d.headers ?? {},
          result: d.result ?? '*',
        };
      }
    } catch { /* начинаем заново */ }
    return fresh();
  });

  const { start, root, path, flipped, showNums, headers, result } = state;

  /* ---------- производные: текущий узел, позиция, легальные ходы ---------- */
  const nodeMap = useMemo(() => {
    const m = new Map<string, TreeNode>();
    const walk = (n: TreeNode) => { m.set(n.id, n); n.children.forEach(walk); };
    walk(root);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, tick]);

  const pathNodes = useMemo<TreeNode[]>(() => {
    const arr: TreeNode[] = [root];
    for (let i = 1; i < path.length; i++) {
      const n = nodeMap.get(path[i]);
      if (!n) break;
      arr.push(n);
    }
    return arr;
  }, [root, path, nodeMap]);

  const curNode = pathNodes[pathNodes.length - 1];
  const positions = useMemo(() => pathPositions(start, pathNodes), [start, pathNodes]);
  const pos = positions[positions.length - 1] ?? start;

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
  const lastMove = curNode.move ?? null;
  const startFen = useMemo(() => boardToFen(start.b, start.side), [start]);
  const fen = useMemo(() => boardToFen(pos.b, pos.side), [pos]);

  const flashHint = useCallback((msg: string) => {
    setHint(msg);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2200);
  }, []);

  /* ---------- нейросеть ---------- */
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

  /* ---------- Scan WASM ---------- */
  useEffect(() => {
    let on = true;
    void getScan().then((scan) => { if (on) setScanAvail(scan !== null); });
    return () => { on = false; };
  }, []);

  /* ---------- база фигур ---------- */
  const tb = useMemo<TbVerdict | null>(() => {
    const m = materialInfo(pos.b);
    return m.total <= 9 ? materialVerdict(m) : null;
  }, [pos]);

  /* ---------- анализ ---------- */
  const scanRef = useRef<ScanEngine | null>(null);
  const genRef = useRef(0);

  useEffect(() => {
    const gen = ++genRef.current;
    if (legal.length === 0) {
      setEngineState({ ...IDLE, forKey: boardKey });
      return;
    }
    setEngineState((e) => ({ ...IDLE, thinking: true, forKey: e.forKey }));
    const history = pathNodes.slice(1).map((n) => n.move!.from * 100 + n.move!.to);

    void (async () => {
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
              candidates: [{
                from: r.from, to: r.to,
                caps: findMove(legal, r.from, r.to)?.captures.length ?? 0,
                score: r.scoreWhite !== null ? r.scoreWhite * pos.side : 0,
              }],
              pv: [{ from: r.from, to: r.to }],
              mate: false, book: null,
            });
            return;
          }
        }
      }

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
  }, [boardKey, fen, startFen, path, legal, s.engineDepth, s.engineTime, s.humanStyle, s.nnEnabled, s.nnBlend, s.useScan]);

  /* ---------- автосохранение ---------- */
  useEffect(() => {
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify({
        startFen,
        treeJson: serializeTree(root),
        path,
        flipped, showNums, headers, result,
      }));
    } catch { /* приватный режим */ }
  }, [startFen, root, path, flipped, showNums, headers, result, tick]);

  /* ---------- автопроигрывание основной линии ---------- */
  useEffect(() => {
    if (!auto) return;
    if (curNode.children.length === 0) { setAuto(false); return; }
    const t = window.setTimeout(() => {
      setState((st) => ({ ...st, path: [...st.path, curNode.children[0].id] }));
    }, 650);
    return () => window.clearTimeout(t);
  }, [auto, curNode]);

  /* ---------- навигация ---------- */
  const gotoNode = useCallback((id: string) => {
    const n = nodeMap.get(id);
    if (!n) return;
    setSelected(null);
    setState((st) => ({ ...st, path: pathTo(n).slice(1).map((x) => x.id) }));
  }, [nodeMap]);

  const gotoPly = useCallback((ply: number) => {
    /* ply: 0 = корень; вдоль текущего пути */
    setSelected(null);
    setState((st) => ({ ...st, path: st.path.slice(0, Math.max(0, Math.min(ply, st.path.length))) }));
  }, []);

  const prev = useCallback(() => gotoPly(path.length - 1), [gotoPly, path.length]);
  const next = useCallback(() => {
    if (curNode.children.length > 0) gotoNode(curNode.children[0].id);
  }, [curNode, gotoNode]);
  const toStart = useCallback(() => gotoPly(0), [gotoPly]);
  const toEnd = useCallback(() => {
    let n = curNode;
    while (n.children.length > 0) n = n.children[0];
    gotoNode(n.id);
  }, [curNode, gotoNode]);

  /* ---------- ходы: существующий узел или новое ветвление ---------- */
  const playFromTo = useCallback((from: number, to: number): boolean => {
    const m = findMove(legal, from, to);
    if (!m) return false;
    setSelected(null);
    const existing = curNode.children.find((c) => c.move && c.move.from === from && c.move.to === to);
    if (existing) {
      setState((st) => ({ ...st, path: [...st.path, existing.id] }));
    } else {
      const child = createNode(m, curNode);
      curNode.children.push(child);   /* первый ребёнок — линия, следующие — варианты */
      setState((st) => ({ ...st, path: [...st.path, child.id] }));
      bump();
    }
    return true;
  }, [legal, curNode]);

  /* ---------- комментарии и NAG ---------- */
  const setComment = useCallback((text: string) => {
    if (!curNode.move) return;
    curNode.comment = text;
    bump();
  }, [curNode]);

  const toggleNag = useCallback((nag: number) => {
    if (!curNode.move) return;
    const i = curNode.nags.indexOf(nag);
    if (i >= 0) curNode.nags.splice(i, 1);
    else { curNode.nags = [nag]; }
    bump();
  }, [curNode]);

  /* ---------- авто-взятие ---------- */
  const engineRef = useRef(engineState);
  engineRef.current = engineState;

  useEffect(() => {
    if (!s.autoCapture || winner !== null || !mustCapture) return;
    /* только на живом конце линии: при просмотре истории ветки не создаются */
    if (curNode.children.length > 0) return;
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
  }, [s.autoCapture, s.captureDelay, boardKey, winner, mustCapture, legal, playFromTo, curNode]);

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

  /* ---------- новая партия / расстановка / загрузка ---------- */
  const newGame = useCallback(() => {
    setSelected(null); setAuto(false);
    const r = rootTree();
    setState((st) => ({
      ...st, start: { b: startBoard(), side: WHITE }, root: r, path: [],
      headers: {}, result: '*',
    }));
  }, []);

  const applySetup = useCallback((p: Pos, keepHeaders = false) => {
    setSelected(null); setAuto(false);
    const r = rootTree();
    const nonStd = boardToFen(p.b, p.side) !== 'W:W31-50:B1-20';
    setState((st) => ({
      ...st, start: p, root: r, path: [],
      headers: keepHeaders ? st.headers : (nonStd ? { FEN: boardToFen(p.b, p.side) } : {}),
      result: '*',
    }));
  }, []);

  const loadFenText = useCallback((text: string): string | null => {
    const p = parseFen(text);
    if (!p) return 'Не удалось разобрать FEN — проверьте формат (W:W…:B…)';
    if (generateMoves(p).length === 0) return 'У стороны, делающей ход, нет ходов';
    applySetup(p);
    return null;
  }, [applySetup]);

  const loadPDNText = useCallback((text: string): string | null => {
    const g = parsePDNFull(text);
    if (g.movesParsed === 0) return g.error ?? 'Не найдено ходов в PDN';
    setSelected(null); setAuto(false);
    const r = g.root;
    let end: TreeNode = r;
    while (end.children.length > 0) end = end.children[0];
    setState((st) => ({
      ...st, start: g.start, root: r, path: pathTo(end).slice(1).map((x) => x.id),
      headers: g.headers, result: g.result ?? '*',
    }));
    return g.error;
  }, []);

  const exportPDN = useCallback((): string => {
    return toPDNFull({ headers, start, root, result });
  }, [headers, start, root, result]);

  /* ---------- база партий (IndexedDB) ---------- */
  const [dbGames, setDbGames] = useState<DbGame[]>([]);
  const refreshDb = useCallback(async () => {
    try { setDbGames(await listGames()); } catch { /* noop */ }
  }, []);
  useEffect(() => { void refreshDb(); }, [refreshDb]);

  const saveToDb = useCallback(async (name: string): Promise<boolean> => {
    try {
      const mainLen = mainlineLength(root);
      const hasAnnotations = (() => {
        let found = false;
        const walk = (n: TreeNode) => {
          if (found) return;
          if (n.children.length > 1) found = true;
          if (n.comment.trim() || n.nags.length > 0) found = true;
          n.children.forEach(walk);
        };
        walk(root);
        return found;
      })();
      await saveGame({
        id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim() || `Партия ${new Date().toLocaleDateString('ru-RU')}`,
        date: new Date().toISOString(),
        white: headers['White'] ?? '—',
        black: headers['Black'] ?? '—',
        event: headers['Event'] ?? '—',
        result,
        startFen,
        treeJson: serializeTree(root),
        moves: mainLen,
        annotated: hasAnnotations,
      });
      await refreshDb();
      return true;
    } catch {
      return false;
    }
  }, [root, headers, result, startFen, refreshDb]);

  const loadFromDb = useCallback((g: DbGame): string | null => {
    const r = deserializeTree(g.treeJson);
    if (!r) return 'Не удалось прочитать партию из базы';
    const start = parseFen(g.startFen) ?? { b: startBoard(), side: WHITE };
    setSelected(null); setAuto(false);
    let end: TreeNode = r;
    while (end.children.length > 0) end = end.children[0];
    setState((st) => ({
      ...st, start, root: r, path: pathTo(end).slice(1).map((x) => x.id),
      headers: { Event: g.event, White: g.white, Black: g.black },
      result: g.result,
    }));
    return null;
  }, []);

  const deleteFromDb = useCallback(async (id: string) => {
    try { await deleteGame(id); await refreshDb(); } catch { /* noop */ }
  }, [refreshDb]);

  /* ---------- обучение нейросети ---------- */
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
    start, root, path: pathNodes, curNode, positions,
    pos, legal, selected, clickSquare, lastMove, winner,
    mustCapture, movableFroms,
    gotoNode, gotoPly, toStart, toEnd, prev, next, playFromTo, newGame,
    setComment, toggleNag,
    flipped, toggleFlip: () => setState((st) => ({ ...st, flipped: !st.flipped })),
    showNums, toggleNums: () => setState((st) => ({ ...st, showNums: !st.showNums })),
    auto, setAuto, fen, startFen, headers, result, setResult: (r: string) => setState((st) => ({ ...st, result: r })),
    loadFenText, loadPDNText, exportPDN, applySetup, boardKey,
    engine: engineState, engineKind, scanAvail, tb, hint,
    dbGames, refreshDb, saveToDb, loadFromDb, deleteFromDb,
    nnMeta, training, trainProg, trainOnPDN, clearNet,
    movesTotal: mainlineLength(root),
  };
}

export type GameApi = ReturnType<typeof useGame>;
