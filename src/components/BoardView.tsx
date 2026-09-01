/* ============================================================
 * BoardView — доска 10×10: поля с нумерацией 1–50, координаты a–j/1–10,
 * анимированные шашки, подсветки ходов, стрелка лучшего хода (SVG).
 * Цвета доски и акцента — из активной темы (CSS-переменные).
 * ============================================================ */

import { useMemo, useRef } from 'react';
import { type Move, type Pos, type Side, rc, sq, WHITE } from '../engine/core';

interface PieceInfo { n: number; color: Side; king: boolean; id: number; fresh: boolean }

const FILES = 'abcdefghij';

function CrownSvg() {
  return (
    <svg viewBox="0 0 24 24" className="h-[46%] w-[46%] drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]">
      <path
        d="M4 17h16l1.5-8.5-4.7 3.4L12 5.5 7.2 11.9 2.5 8.5z"
        fill="#e8b04b" stroke="#8a5f1d" strokeWidth="1" strokeLinejoin="round"
      />
      <rect x="4" y="17.6" width="16" height="2.4" rx="0.8" fill="#e8b04b" stroke="#8a5f1d" strokeWidth="0.8" />
    </svg>
  );
}

export default function BoardView({
  pos, legal, selected, lastMove, best, preview, flipped, showNums,
  winner, movableFroms, onSquare,
}: {
  pos: Pos;
  legal: Move[];
  selected: number | null;
  lastMove: Move | null;
  best: Move | null;
  preview: Move | null;
  flipped: boolean;
  showNums: boolean;
  winner: Side | null;
  movableFroms: Set<number>;
  onSquare: (n: number) => void;
}) {
  const prevInfo = useRef<Map<number, { id: number; color: Side }>>(new Map());
  const counter = useRef(0);
  const cache = useRef<{ key: string; list: PieceInfo[] } | null>(null);

  const pieces = useMemo(() => {
    const key = pos.b.join('') + pos.side;
    if (cache.current && cache.current.key === key) return cache.current.list;
    const prev = prevInfo.current;
    const prevIds = new Set([...prev.values()].map((v) => v.id));
    const next = new Map<number, { id: number; color: Side }>();
    const list: PieceInfo[] = [];
    const placed = new Set<number>();

    const add = (n: number, color: Side, king: boolean, id: number) => {
      next.set(n, { id, color });
      placed.add(n);
      list.push({ n, color, king, id, fresh: !prevIds.has(id) });
    };

    // 1) Шашка, сделавшая последний ход, сохраняет свой id → плавный переезд
    if (lastMove) {
      const e = prev.get(lastMove.from);
      const v = pos.b[lastMove.to];
      if (e && v !== 0 && Math.sign(v) === e.color) {
        add(lastMove.to, e.color, Math.abs(v) === 2, e.id);
      }
    }
    // 2) Совпавшие по полю и цвету
    for (let n = 1; n <= 50; n++) {
      const v = pos.b[n];
      if (v === 0 || placed.has(n)) continue;
      const e = prev.get(n);
      if (e && e.color === Math.sign(v)) add(n, e.color, Math.abs(v) === 2, e.id);
    }
    // 3) Новые (выставление с руки / взятия) — получают новые id и «выпрыгивают»
    for (let n = 1; n <= 50; n++) {
      const v = pos.b[n];
      if (v === 0 || placed.has(n)) continue;
      counter.current += 1;
      add(n, Math.sign(v) as Side, Math.abs(v) === 2, counter.current);
    }
    prevInfo.current = next;
    cache.current = { key, list };
    return list;
  }, [pos, lastMove]);

  /* Подсветки */
  const selMoves = useMemo(
    () => (selected !== null ? legal.filter((m) => m.from === selected) : []),
    [selected, legal],
  );
  const destQuiet = useMemo(() => new Set(selMoves.filter((m) => m.captures.length === 0).map((m) => m.to)), [selMoves]);
  const destCaps = useMemo(() => new Set(selMoves.filter((m) => m.captures.length > 0).map((m) => m.to)), [selMoves]);
  const victims = useMemo(() => {
    const s = new Set<number>();
    for (const m of selMoves) for (const c of m.captures) s.add(c);
    return s;
  }, [selMoves]);

  const arrowMove = preview ?? best;

  /* Геометрия стрелки */
  const arrow = useMemo(() => {
    if (!arrowMove) return null;
    const pts: [number, number][] = [];
    for (const n of [arrowMove.from, ...arrowMove.path]) {
      const [r, c] = rc(n);
      const rr = flipped ? 9 - r : r;
      const cc = flipped ? 9 - c : c;
      const last = pts[pts.length - 1];
      const p: [number, number] = [cc * 10 + 5, rr * 10 + 5];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      pts.push(p);
    }
    // слегка укорачиваем хвост у наконечника
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const dx = b[0] - a[0]; const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      pts[pts.length - 1] = [b[0] - (dx / len) * 2.2, b[1] - (dy / len) * 2.2];
    }
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
    return { d, caps: arrowMove.captures, isCap: arrowMove.captures.length > 0 };
  }, [arrowMove, flipped]);

  const ranks = Array.from({ length: 10 }, (_, i) => (flipped ? i + 1 : 10 - i));
  const files = Array.from({ length: 10 }, (_, i) => FILES[flipped ? 9 - i : i]);

  const arrowColor = preview ? '#7fc4a4' : 'var(--accent)';

  return (
    <div className="flex items-stretch gap-2.5 sm:gap-3">
      <EvalBarColumn pos={pos} />

      <div className="relative min-w-0 flex-1">
        {/* координаты: вертикаль слева */}
        <div className="absolute -left-5 top-0 flex h-full flex-col sm:-left-6">
          {ranks.map((r) => (
            <div key={`r${r}`} className="flex flex-1 items-center font-mono text-[10px] text-dim sm:text-xs">{r}</div>
          ))}
        </div>
        {/* координаты: горизонталь снизу */}
        <div className="absolute -bottom-5 left-0 flex w-full flex-row sm:-bottom-6">
          {files.map((f) => (
            <div key={`f${f}`} className="flex flex-1 items-center justify-center font-mono text-[10px] text-dim sm:text-xs">{f}</div>
          ))}
        </div>

        <div
          className={`board-frame relative aspect-square w-full overflow-hidden rounded-lg ${winner !== null ? 'saturate-[.7]' : ''}`}
        >
          {/* поля */}
          <div className="absolute inset-0 grid grid-cols-10 grid-rows-10">
            {Array.from({ length: 100 }, (_, i) => {
              const r = (i / 10) | 0;
              const c = i % 10;
              const n = sq(r, c);
              const dark = (r + c) % 2 === 1;
              const isLast = lastMove !== null && (lastMove.from === n || lastMove.to === n);
              const isSel = selected === n;
              const canFrom = selected === null && winner === null && pos.b[n] !== 0
                && pos.b[n] * pos.side > 0 && movableFroms.has(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => onSquare(n)}
                  className={[
                    'relative block h-full w-full',
                    dark ? 'sq-dark' : 'sq-light',
                    canFrom ? 'cursor-pointer' : '',
                  ].join(' ')}
                >
                  {dark && showNums && (
                    <span className="pointer-events-none absolute left-[6%] top-[3%] font-mono text-[9px] leading-none text-white/25 sm:text-[11px]">
                      {n}
                    </span>
                  )}
                  {isLast && <span className="pointer-events-none absolute inset-0 bg-acc/20" />}
                  {isSel && <span className="sq-sel pointer-events-none absolute inset-0" />}
                  {destQuiet.has(n) && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="h-[30%] w-[30%] rounded-full border border-acc/70 bg-acc/35 shadow-[0_0_10px_color-mix(in_oklab,var(--accent)_50%,transparent)]" />
                    </span>
                  )}
                  {destCaps.has(n) && (
                    <span className="pointer-events-none absolute inset-0 ring-[3px] ring-inset ring-[#d9534a]/90 dest-pulse" />
                  )}
                  {victims.has(n) && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="relative h-[46%] w-[46%]">
                        <span className="absolute left-1/2 top-1/2 h-[14%] w-full -translate-x-1/2 -translate-y-1/2 rotate-45 rounded bg-[#d9534a]/90" />
                        <span className="absolute left-1/2 top-1/2 h-[14%] w-full -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded bg-[#d9534a]/90" />
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* шашки */}
          {pieces.map((p) => {
            const [r, c] = rc(p.n);
            const rr = flipped ? 9 - r : r;
            const cc = flipped ? 9 - c : c;
            const isSel = selected === p.n;
            const movable = winner === null && p.color === pos.side && movableFroms.has(p.n);
            return (
              <div
                key={p.id}
                className="piece-layer"
                style={{ transform: `translate(${cc * 100}%, ${rr * 100}%)` }}
                onClick={() => onSquare(p.n)}
              >
                <div
                  className={[
                    'piece-disc',
                    p.color === WHITE ? 'piece-white' : 'piece-black',
                    p.fresh ? 'piece-pop' : '',
                    isSel ? 'piece-selected' : '',
                    movable && !isSel ? 'piece-movable' : '',
                  ].join(' ')}
                >
                  {p.king && <CrownSvg />}
                </div>
              </div>
            );
          })}

          {/* стрелка лучшего хода / превью варианта */}
          {arrow && (
            <svg
              key={(preview ? 'p' : 'b') + arrow.d}
              viewBox="0 0 100 100"
              className="pointer-events-none absolute inset-0 z-30 h-full w-full"
            >
              <defs>
                <marker id="arrowHead" markerWidth="5" markerHeight="5" refX="2.6" refY="2.5" orient="auto">
                  <path d="M0,0 L5,2.5 L0,5 z" style={{ fill: arrowColor }} />
                </marker>
              </defs>
              <path
                d={arrow.d}
                pathLength={1}
                fill="none"
                strokeOpacity={preview ? 0.85 : 0.95}
                strokeWidth={arrow.isCap ? 2.6 : 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                markerEnd="url(#arrowHead)"
                className="arrow-draw"
                style={{
                  stroke: arrowColor,
                  filter: preview
                    ? 'drop-shadow(0 0 3px rgba(127,196,164,.5))'
                    : 'drop-shadow(0 0 4px color-mix(in oklab, var(--accent) 45%, transparent))',
                }}
              />
              {arrow.caps.map((n) => {
                const [r, c] = rc(n);
                const rr = flipped ? 9 - r : r;
                const cc = flipped ? 9 - c : c;
                return (
                  <circle
                    key={n}
                    cx={cc * 10 + 5}
                    cy={rr * 10 + 5}
                    r={3.1}
                    fill="rgba(217,83,74,.18)"
                    stroke="#d9534a"
                    strokeWidth={0.8}
                    className="arrow-draw-cap"
                  />
                );
              })}
            </svg>
          )}

          {winner !== null && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#0a1214]/55 backdrop-blur-[2px]">
              <div className="rounded-md border border-acc/40 bg-pan/95 px-6 py-4 text-center shadow-[0_10px_40px_rgba(0,0,0,.5)]">
                <div className="font-display text-sm font-bold tracking-[.18em] text-acc2 sm:text-base">
                  {winner === WHITE ? 'ПОБЕДА БЕЛЫХ' : 'ПОБЕДА ЧЁРНЫХ'}
                </div>
                <div className="mt-1 text-xs text-mut">у соперника нет ходов · правила ФМЖД</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Вертикальная шкала оценки рядом с доской */
function EvalBarColumn({ pos }: { pos: Pos }) {
  const mat = useMemo(() => {
    let w = 0; let b = 0;
    for (let n = 1; n <= 50; n++) {
      const v = pos.b[n];
      if (v === 1) w++; else if (v === -1) b++;
      else if (v === 2) w += 3; else if (v === -2) b += 3;
    }
    return w - b;
  }, [pos]);

  return (
    <div className="flex w-4 flex-col overflow-hidden rounded-md border border-white/10 bg-[#101d20] sm:w-5">
      <div className="eval-seg-top" style={{ height: `${50 + Math.max(-46, Math.min(46, mat * 9))}%` }} />
      <div className="eval-seg-bottom flex-1" />
      <div className="sr-only">Материал: {mat > 0 ? `+${mat} у белых` : mat < 0 ? `+${-mat} у чёрных` : 'поровну'}</div>
    </div>
  );
}
