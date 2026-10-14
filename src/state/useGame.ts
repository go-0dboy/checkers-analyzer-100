/* ============================================================
 * useGame — состояние разбора: дерево ходов с ветвлениями,
 * комментарии и NAG, навигация, анализ (Scan WASM → встроенный
 * движок), авто-взятие/авто-ход, IndexedDB, сохранение.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  boardToFen,
  findMove,
  generateMoves,
  sameMove,
  parseFen,
  startBoard,
  WHITE,
  type Move,
  type Pos,
  type Side,
} from '../engine/core';
import { drawFromPositions, drawReason } from '../engine/draw';
import { engine, type AnalyzeHandle } from '../engine/client';
import { getScan, type ScanEngine } from '../engine/scan';
import { materialInfo, materialVerdict, type TbVerdict } from '../engine/tablebase';
import { parsePDNFull, toPDNFull } from '../engine/pdn';
import type { Settings } from './settings';
import {
  createNode,
  deserializeTree,
  mainlineLength,
  MAX_TREE_DEPTH,
  MAX_TREE_NODES,
  pathPositions,
  pathTo,
  rootTree,
  serializeTree,
  resolvePath,
  validateTree,
  type TreeNode,
} from './tree';
import { deleteGame, listGames, saveGame, type DbGame } from './db';

export interface CandidateLite extends Move {
  caps: number;
  score: number | null;
}

export interface EngineState {
  thinking: boolean;
  forKey: string;
  depth: number;
  nodes: number;
  nps: number;
  ms: number;
  score: number | null;
  best: Move | null;
  candidates: CandidateLite[];
  pv: Move[];
  error?: string;
  mate: boolean;
  book: string | null;
}

export type EngineKind = 'alpha-beta' | 'scan';

const IDLE: EngineState = {
  thinking: false,
  forKey: '',
  depth: 0,
  nodes: 0,
  nps: 0,
  ms: 0,
  score: null,
  best: null,
  candidates: [],
  pv: [],
  mate: false,
  book: null,
};

const GAME_KEY = 'sk100.game.v4';

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
  const [structureTick, setStructureTick] = useState(0);
  const recoveryRef = useRef<string | null>(null);

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
        recoveryRef.current = raw;
        const d = JSON.parse(raw);
        const start = parseFen(d.startFen);
        const root = typeof d.treeJson === 'string' ? deserializeTree(d.treeJson) : null;
        if (!start || !root || !validateTree(start, root)) return fresh();
        const path: string[] = Array.isArray(d.path)
          ? d.path.filter((id: unknown) => typeof id === 'string')
          : [];
        recoveryRef.current = null;
        return {
          start,
          root,
          path,
          flipped: !!d.flipped,
          showNums: d.showNums !== false,
          headers: d.headers ?? {},
          result: d.result ?? '*',
        };
      }
    } catch {
      /* начинаем заново */
    }
    return fresh();
  });

  const [recovery, setRecovery] = useState(recoveryRef.current);
  const [storageError, setStorageError] = useState<string | null>(null);
  const { start, root, path, flipped, showNums, headers, result } = state;

  /* ---------- производные: текущий узел, позиция, легальные ходы ---------- */
  const nodeMap = useMemo(() => {
    const m = new Map<string, TreeNode>();
    const walk = (n: TreeNode) => {
      m.set(n.id, n);
      n.children.forEach(walk);
    };
    walk(root);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, structureTick]);

  const pathNodes = useMemo(() => resolvePath(root, path), [root, path]);

  const curNode = pathNodes[pathNodes.length - 1];
  const positionCache = useMemo(() => new WeakMap<TreeNode, Pos>(), [start, root]);
  const positions = useMemo(
    () => pathPositions(start, pathNodes, positionCache),
    [start, pathNodes, positionCache],
  );
  const pos = positions[positions.length - 1] ?? start;

  const legal = useMemo(() => generateMoves(pos), [pos]);
  const winner = useMemo<Side | null>(
    () => (legal.length === 0 ? ((pos.side === WHITE ? -1 : 1) as Side) : null),
    [legal, pos],
  );
  const draw = useMemo(
    () =>
      legal.length
        ? drawReason(
            pos,
            drawFromPositions(
              positions,
              pathNodes.slice(1).map((n) => n.move!),
            ),
          )
        : null,
    [pos, positions, pathNodes, legal],
  );
  const mustCapture = legal.length > 0 && legal[0].captures.length > 0;
  const movableFroms = useMemo(() => new Set(legal.map((m) => m.from)), [legal]);

  const [routeChoices, setRouteChoices] = useState<Move[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | undefined>(undefined);
  const [engineState, setEngineState] = useState<EngineState>(IDLE);
  const [engineKind, setEngineKind] = useState<EngineKind>('alpha-beta');
  const [scanAvail, setScanAvail] = useState<boolean | null>(null);
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const humanStyle = s.humanStyle && !s.useScan;

  const boardKey = useMemo(() => pos.b.join('') + pos.side, [pos]);
  const lastMove = curNode.move ?? null;
  const startFen = useMemo(() => boardToFen(start.b, start.side), [start]);
  const fen = useMemo(() => boardToFen(pos.b, pos.side), [pos]);

  const flashHint = useCallback((msg: string) => {
    setHint(msg);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2200);
  }, []);

  useEffect(() => {
    setSelected(null);
    setRouteChoices([]);
  }, [boardKey]);

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
    if (legal.length === 0 || draw) {
      setEngineState({ ...IDLE, forKey: boardKey });
      return;
    }
    setEngineState((e) => ({ ...IDLE, thinking: true, forKey: e.forKey }));
    const history = pathNodes.slice(1).map((n) => n.move!);
    let handle: AnalyzeHandle | null = null;
    const scanAbort = new AbortController();

    void (async () => {
      if (s.useScan) {
        const scan = scanRef.current ?? (await getScan());
        if (genRef.current !== gen) return;
        scanRef.current = scan;
        setScanAvail(scan !== null);
        if (scan && genRef.current === gen) {
          const t0 = performance.now();
          const r = await scan.analyze(
            fen,
            s.engineTime,
            scanAbort.signal,
            history,
            startFen,
            s.engineDepth,
          );
          if (genRef.current !== gen) return;
          if (r && findMove(legal, r.move.from, r.move.to, r.move.path, r.move.captures)) {
            const ms = Math.max(1, Math.round(performance.now() - t0));
            setEngineKind('scan');
            setEngineState({
              thinking: false,
              forKey: boardKey,
              depth: r.depth,
              nodes: 0,
              nps: 0,
              ms,
              score: r.scoreWhite !== null ? r.scoreWhite * pos.side : null,
              best: r.move,
              candidates: [
                {
                  ...r.move,
                  caps: r.move.captures.length,
                  score: r.scoreWhite !== null ? r.scoreWhite * pos.side : null,
                },
              ],
              pv: r.pv,
              mate: false,
              book: null,
            });
            return;
          }
        }
      }

      if (genRef.current !== gen) return;
      setEngineKind('alpha-beta');
      handle = engine.analyze(
        {
          fen,
          history,
          startFen,
          timeMs: s.engineTime,
          maxDepth: s.engineDepth,
          humanStyle,
        },
        (info) => {
          if (genRef.current !== gen) return;
          setEngineState((e) =>
            e.thinking ? { ...e, depth: info.depth, nodes: info.nodes, score: info.score } : e,
          );
        },
      );
      const res = await handle.promise;
      if (genRef.current !== gen) return;
      if (!res) {
        setEngineState({
          ...IDLE,
          forKey: boardKey,
          error: 'Анализ не завершён: ошибка движка или превышено время ожидания',
        });
        return;
      }
      setEngineState({
        thinking: false,
        forKey: boardKey,
        depth: res.depth,
        nodes: res.nodes,
        nps: res.nps,
        ms: res.ms,
        score: res.score,
        best: res.best,
        candidates: res.candidates,
        pv: res.pv,
        mate: res.mate,
        book: res.book,
        error: res.error,
      });
    })().catch((error) => {
      if (genRef.current === gen)
        setEngineState({
          ...IDLE,
          forKey: boardKey,
          error: error instanceof Error ? error.message : String(error),
        });
    });

    return () => {
      genRef.current++;
      handle?.cancel();
      scanAbort.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    boardKey,
    fen,
    startFen,
    path,
    legal,
    s.engineDepth,
    s.engineTime,
    humanStyle,
    analysisRevision,
    s.useScan,
    draw,
  ]);

  /* ---------- автосохранение ---------- */
  const persistRef = useRef<(() => void) | null>(null);
  const savedStateRef = useRef<GameState | null>(null);
  const serializedRef = useRef<{ root: TreeNode; tick: number; json: string } | null>(null);
  useEffect(() => {
    if (recovery) {
      persistRef.current = null;
      return;
    }
    const persist = () => {
      try {
        let tree = serializedRef.current;
        if (!tree || tree.root !== root || tree.tick !== tick) {
          tree = { root, tick, json: serializeTree(root) };
          serializedRef.current = tree;
        }
        localStorage.setItem(
          GAME_KEY,
          JSON.stringify({
            startFen,
            treeJson: tree.json,
            path,
            flipped,
            showNums,
            headers,
            result,
          }),
        );
        setStorageError(null);
      } catch {
        setStorageError('Автосохранение недоступно. Скачайте PDN, чтобы сохранить разбор.');
      }
    };
    persistRef.current = persist;
    const annotationsOnly = savedStateRef.current === state;
    savedStateRef.current = state;
    if (!annotationsOnly) {
      persist();
      return;
    }
    const timer = window.setTimeout(persist, 300);
    return () => window.clearTimeout(timer);
  }, [state, startFen, root, path, flipped, showNums, headers, result, tick, recovery]);

  useEffect(() => {
    const flush = () => persistRef.current?.();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, []);

  /* ---------- автопроигрывание основной линии ---------- */
  useEffect(() => {
    if (!auto) return;
    if (curNode.children.length === 0) {
      setAuto(false);
      return;
    }
    const t = window.setTimeout(() => {
      setState((st) => ({ ...st, path: [...st.path, curNode.children[0].id] }));
    }, 650);
    return () => window.clearTimeout(t);
  }, [auto, curNode]);

  /* ---------- навигация ---------- */
  const gotoNode = useCallback(
    (id: string) => {
      const n = nodeMap.get(id);
      if (!n) return;
      setSelected(null);
      setState((st) => ({
        ...st,
        path: pathTo(n)
          .slice(1)
          .map((x) => x.id),
      }));
    },
    [nodeMap],
  );

  const gotoPly = useCallback((ply: number) => {
    /* ply: 0 = корень; вдоль текущего пути */
    setSelected(null);
    setState((st) => ({
      ...st,
      path: st.path.slice(0, Math.max(0, Math.min(ply, st.path.length))),
    }));
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
  const playFromTo = useCallback(
    (from: number, to: number, route?: Move): boolean => {
      if (recovery) {
        flashHint('Сначала скачайте повреждённое сохранение и начните новую партию');
        return false;
      }
      const matches = legal.filter((m) => m.from === from && m.to === to);
      if (!route && matches.length > 1) {
        setRouteChoices(matches);
        return false;
      }
      const m = findMove(legal, from, to, route?.path, route?.captures);
      if (!m) return false;
      setSelected(null);
      setRouteChoices([]);
      const existing = curNode.children.find((c) => c.move && sameMove(c.move, m));
      if (existing) {
        setState((st) => ({ ...st, path: [...st.path, existing.id] }));
      } else {
        if (pathNodes.length > MAX_TREE_DEPTH || nodeMap.size >= MAX_TREE_NODES) {
          flashHint(
            `Лимит: ${MAX_TREE_DEPTH} полуходов в линии, ${MAX_TREE_NODES - 1} ходов в дереве`,
          );
          return false;
        }
        const child = createNode(m, curNode);
        curNode.children.push(child); /* первый ребёнок — линия, следующие — варианты */
        setState((st) => ({ ...st, path: [...st.path, child.id] }));
        setStructureTick((t) => t + 1);
        bump();
      }
      return true;
    },
    [legal, curNode, pathNodes.length, nodeMap, flashHint, recovery],
  );

  /* ---------- комментарии и NAG ---------- */
  const setComment = useCallback(
    (text: string) => {
      if (!curNode.move) return;
      curNode.comment = text;
      bump();
    },
    [curNode],
  );

  const toggleNag = useCallback(
    (nag: number) => {
      if (!curNode.move) return;
      const i = curNode.nags.indexOf(nag);
      if (i >= 0) curNode.nags.splice(i, 1);
      else {
        curNode.nags = [nag];
      }
      bump();
    },
    [curNode],
  );

  /* ---------- авто-взятие ---------- */
  const engineRef = useRef(engineState);
  engineRef.current = engineState;

  useEffect(() => {
    if (!s.autoCapture || winner !== null || draw || !mustCapture) return;
    /* только на живом конце линии: при просмотре истории ветки не создаются */
    if (curNode.children.length > 0) return;
    const t = window.setTimeout(() => {
      const eng = engineRef.current;
      let choice = legal[0];
      if (!eng.thinking && eng.best && eng.forKey === boardKey) {
        const byEngine = legal.find((m) => sameMove(m, eng.best!));
        if (byEngine) choice = byEngine;
      }
      if (choice) playFromTo(choice.from, choice.to, choice);
    }, s.captureDelay);
    return () => window.clearTimeout(t);
  }, [
    s.autoCapture,
    s.captureDelay,
    boardKey,
    winner,
    draw,
    mustCapture,
    legal,
    playFromTo,
    curNode,
  ]);

  const clickSquare = useCallback(
    (n: number) => {
      if (winner !== null || draw) return;
      if (selected !== null) {
        if (n === selected) {
          setSelected(null);
          return;
        }
        if (legal.some((m) => m.from === selected && m.to === n)) {
          playFromTo(selected, n);
          return;
        }
      }
      if (movableFroms.has(n) && pos.b[n] * pos.side > 0) {
        if (s.autoSingle) {
          const mine = legal.filter((m) => m.from === n);
          const dests = new Set(mine.map((m) => m.to));
          if (mine.length === 1 && dests.size === 1) {
            playFromTo(n, mine[0].to, mine[0]);
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
    },
    [
      selected,
      legal,
      movableFroms,
      mustCapture,
      pos,
      winner,
      draw,
      playFromTo,
      flashHint,
      s.autoSingle,
    ],
  );

  /* ---------- новая партия / расстановка / загрузка ---------- */
  const newGame = useCallback(() => {
    setRecovery(null);
    setSelected(null);
    setAuto(false);
    const r = rootTree();
    setState((st) => ({
      ...st,
      start: { b: startBoard(), side: WHITE },
      root: r,
      path: [],
      headers: {},
      result: '*',
    }));
  }, []);

  const applySetup = useCallback((p: Pos, keepHeaders = false) => {
    setRecovery(null);
    setSelected(null);
    setAuto(false);
    const r = rootTree();
    const nonStd = boardToFen(p.b, p.side) !== 'W:W31-50:B1-20';
    setState((st) => ({
      ...st,
      start: p,
      root: r,
      path: [],
      headers: keepHeaders ? st.headers : nonStd ? { FEN: boardToFen(p.b, p.side) } : {},
      result: '*',
    }));
  }, []);

  const loadFenText = useCallback(
    (text: string): string | null => {
      const p = parseFen(text);
      if (!p) return 'Не удалось разобрать FEN — проверьте формат (W:W…:B…)';
      if (generateMoves(p).length === 0) return 'У стороны, делающей ход, нет ходов';
      applySetup(p);
      return null;
    },
    [applySetup],
  );

  const loadPDNText = useCallback((text: string): string | null => {
    const g = parsePDNFull(text);
    if (g.error) return g.error;
    if (g.movesParsed === 0 && !g.headers.FEN) return 'Не найдено ходов в PDN';
    setRecovery(null);
    setSelected(null);
    setAuto(false);
    const r = g.root;
    let end: TreeNode = r;
    while (end.children.length > 0) end = end.children[0];
    setState((st) => ({
      ...st,
      start: g.start,
      root: r,
      path: pathTo(end)
        .slice(1)
        .map((x) => x.id),
      headers: g.headers,
      result: g.result ?? '*',
    }));
    return g.error;
  }, []);

  const exportPDN = useCallback((): string => {
    return toPDNFull({ headers, start, root, result });
  }, [headers, start, root, result]);

  /* ---------- база партий (IndexedDB) ---------- */
  const [dbGames, setDbGames] = useState<DbGame[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const refreshDb = useCallback(async () => {
    try {
      setDbGames(await listGames());
      setDbError(null);
    } catch {
      setDbError('Не удалось прочитать базу партий');
    }
  }, []);
  useEffect(() => {
    void refreshDb();
  }, [refreshDb]);

  const saveToDb = useCallback(
    async (name: string): Promise<boolean> => {
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
          headers: { ...headers },
          result,
          startFen,
          treeJson: serializeTree(root),
          moves: mainLen,
          annotated: hasAnnotations,
        });
        await refreshDb();
        return true;
      } catch {
        setDbError('Не удалось сохранить партию в базу');
        return false;
      }
    },
    [root, headers, result, startFen, refreshDb],
  );

  const loadFromDb = useCallback((g: DbGame): string | null => {
    const r = deserializeTree(g.treeJson);
    if (!r) return 'Не удалось прочитать партию из базы';
    const start = parseFen(g.startFen);
    if (!start || !validateTree(start, r)) return 'Повреждённые позиции или ходы в базе';
    setRecovery(null);
    setSelected(null);
    setAuto(false);
    let end: TreeNode = r;
    while (end.children.length > 0) end = end.children[0];
    setState((st) => ({
      ...st,
      start,
      root: r,
      path: pathTo(end)
        .slice(1)
        .map((x) => x.id),
      headers: g.headers ?? { Event: g.event, White: g.white, Black: g.black },
      result: g.result,
    }));
    return null;
  }, []);

  const deleteFromDb = useCallback(
    async (id: string) => {
      try {
        await deleteGame(id);
        await refreshDb();
      } catch {
        setDbError('Не удалось удалить партию из базы');
      }
    },
    [refreshDb],
  );

  return {
    start,
    root,
    path: pathNodes,
    curNode,
    positions,
    pos,
    legal,
    selected,
    clickSquare,
    lastMove,
    winner,
    mustCapture,
    movableFroms,
    draw,
    routeChoices,
    chooseRoute: (move: Move) => playFromTo(move.from, move.to, move),
    cancelRoute: () => setRouteChoices([]),
    gotoNode,
    gotoPly,
    toStart,
    toEnd,
    prev,
    next,
    playFromTo,
    newGame,
    setComment,
    toggleNag,
    flipped,
    toggleFlip: () => setState((st) => ({ ...st, flipped: !st.flipped })),
    showNums,
    toggleNums: () => setState((st) => ({ ...st, showNums: !st.showNums })),
    auto,
    setAuto,
    fen,
    startFen,
    headers,
    result,
    setResult: (r: string) => {
      if (['*', '1-0', '0-1', '1-1'].includes(r)) setState((st) => ({ ...st, result: r }));
    },
    loadFenText,
    loadPDNText,
    exportPDN,
    applySetup,
    boardKey,
    engine: engineState,
    engineKind,
    scanAvail,
    retryAnalysis: () => setAnalysisRevision((n) => n + 1),
    recovery,
    storageError,
    dbError,
    tb,
    hint,
    dbGames,
    refreshDb,
    saveToDb,
    loadFromDb,
    deleteFromDb,
    movesTotal: mainlineLength(root),
  };
}

export type GameApi = ReturnType<typeof useGame>;
