/* ============================================================
 * СтоКлетка — мобильный анализатор международных шашек
 * (100 клеток, правила ФМЖД). Mobile-first: доска с координатами
 * внутри, движок в отдельном потоке, база фигур, авто-взятие,
 * настройки глубины/времени анализа, темы оформления.
 * ============================================================ */

import {
  useEffect, useMemo, useRef, useState,
  type ReactNode, type SVGProps,
} from 'react';
import { useGame, type GameApi } from './state/useGame';
import { type Move, type Pos, type Side, WHITE, rc, sq, moveNotation, tempi } from './engine/core';
import { type TbVerdict, materialInfo } from './engine/tablebase';
import { toPDN, SAMPLE_PDN } from './engine/pdn';
import { THEMES, applyTheme, initialTheme, type ThemeId } from './themes';
import { loadSettings, saveSettings, type Settings } from './state/settings';

/* ================= иконки (inline SVG) ================= */

type IP = SVGProps<SVGSVGElement> & { size?: number };
const base = (p: IP) => ({
  width: p.size ?? 18, height: p.size ?? 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const, ...p,
});
const IFirst = (p: IP) => <svg {...base(p)}><path d="M11 17l-5-5 5-5" /><path d="M18 17l-5-5 5-5" /></svg>;
const IPrev = (p: IP) => <svg {...base(p)}><path d="M15 18l-6-6 6-6" /></svg>;
const INext = (p: IP) => <svg {...base(p)}><path d="M9 18l6-6-6-6" /></svg>;
const ILast = (p: IP) => <svg {...base(p)}><path d="M13 17l5-5-5-5" /><path d="M6 17l5-5-5-5" /></svg>;
const IPlay = (p: IP) => <svg {...base(p)}><path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" /></svg>;
const IPause = (p: IP) => <svg {...base(p)}><path d="M7 5v14M17 5v14" strokeWidth={3} /></svg>;
const IFlip = (p: IP) => <svg {...base(p)}><path d="M4 9h13l-3.5-3.5" /><path d="M20 15H7l3.5 3.5" /></svg>;
const IPlus = (p: IP) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
const ICopy = (p: IP) => <svg {...base(p)}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>;
const IDown = (p: IP) => <svg {...base(p)}><path d="M12 4v12m0 0l-5-5m5 5l5-5" /><path d="M5 20h14" /></svg>;
const ILoad = (p: IP) => <svg {...base(p)}><path d="M12 20V8m0 0l-5 5m5-5l5 5" /><path d="M5 4h14" /></svg>;
const IBook = (p: IP) => <svg {...base(p)}><path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14z" /><path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5" /></svg>;
const ICheck = (p: IP) => <svg {...base(p)}><path d="M4 12.5l5 5L20 6.5" /></svg>;
const IWarn = (p: IP) => <svg {...base(p)}><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.5" /></svg>;
const IPalette = (p: IP) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><circle cx="8" cy="9" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="7" r="1.4" fill="currentColor" stroke="none" /><circle cx="16" cy="9" r="1.4" fill="currentColor" stroke="none" /><path d="M12 21c1.8 0 2.5-1.2 1.6-2.4-.7-1-.2-2.6 1.4-2.6H17a4 4 0 004-4" /></svg>;
const IGear = (p: IP) => <svg {...base(p)}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09a1.7 1.7 0 001.55-1 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h.09a1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.55 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v.09a1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.55 1z" /></svg>;

/* ================= мелкие блоки UI ================= */

function TBtn({
  children, onClick, title, disabled, active, accent, className = '',
}: {
  children: ReactNode; onClick?: () => void; title?: string;
  disabled?: boolean; active?: boolean; accent?: boolean; className?: string;
}) {
  return (
    <button
      type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={[
        'inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg border px-2.5',
        'transition-all duration-150 select-none',
        active
          ? 'border-acc/70 bg-acc/15 text-acc2 shadow-[0_0_14px_color-mix(in_oklab,var(--accent)_18%,transparent)]'
          : accent
            ? 'border-acc/50 bg-acc/10 text-acc2 hover:bg-acc/20'
            : 'border-white/10 bg-white/[.04] text-body hover:bg-white/[.09]',
        disabled ? 'cursor-not-allowed opacity-30' : 'active:scale-[.93]',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className="absolute h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
      <span className="relative h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-center gap-3 py-1 text-left">
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-body">{label}</span>
        {hint && <span className="block text-[10px] leading-tight text-dim">{hint}</span>}
      </span>
      <span className={`relative h-5.5 w-10 shrink-0 rounded-full border transition-colors duration-200 ${on ? 'border-acc/70 bg-acc/40' : 'border-white/15 bg-white/[.06]'}`} style={{ height: 22 }}>
        <span
          className="absolute top-[2px] h-4 w-4 rounded-full transition-all duration-200"
          style={{ left: on ? 21 : 3, background: on ? 'var(--accent-2)' : '#8fa3a0', boxShadow: '0 1px 3px rgba(0,0,0,.5)' }}
        />
      </span>
    </button>
  );
}

function SliderRow({ label, value, min, max, step, fmt, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="py-1">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-body">{label}</span>
        <span className="font-mono text-[11px] text-acc2">{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  );
}

/* ================= выбор темы ================= */

function ThemePicker() {
  const [themeId, setThemeId] = useState<ThemeId>(() => initialTheme());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <TBtn title="Тема оформления" active={open} onClick={() => setOpen((v) => !v)} className="h-10 w-10 px-0">
        <IPalette size={17} />
      </TBtn>
      {open && (
        <div className="pop-in absolute right-0 top-12 z-50 w-[290px] rounded-xl border border-white/12 bg-pan/95 p-2 shadow-[0_18px_50px_rgba(0,0,0,.55)] backdrop-blur-md">
          <div className="px-2 pb-1 pt-1 font-display text-[10px] font-bold tracking-[.22em] text-dim">ТЕМА ОФОРМЛЕНИЯ</div>
          <div className="grid grid-cols-2 gap-1.5">
            {THEMES.map((t) => {
              const active = t.id === themeId;
              return (
                <button
                  key={t.id} type="button"
                  onClick={() => { setThemeId(t.id); applyTheme(t.id); }}
                  className={`theme-card rounded-lg border p-2 text-left transition-all duration-150 active:scale-[.96] ${
                    active ? 'border-acc/70 bg-acc/10' : 'border-white/10 bg-white/[.03] hover:bg-white/[.07]'}`}
                >
                  <div
                    className="grid aspect-[5/2] w-full grid-cols-4 grid-rows-2 overflow-hidden rounded-md border border-black/40"
                    style={{ background: t.preview.light }}
                  >
                    {[1, 0, 1, 0, 0, 1, 0, 1].map((d, i) => (
                      <div key={i} style={{ background: d ? t.preview.dark : 'transparent' }} />
                    ))}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-semibold text-body">{t.name}</span>
                    {active && <ICheck size={12} className="shrink-0 text-acc2" />}
                  </div>
                  <div className="text-[10px] leading-tight text-dim">{t.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= панель настроек ================= */

function SettingsPanel({
  s, set, game,
}: { s: Settings; set: (p: Partial<Settings>) => void; game: GameApi }) {
  return (
    <div className="flex flex-col gap-1 divide-y divide-white/[.06]">
      <div className="pb-2">
        <div className="mb-1 font-display text-[9px] font-bold tracking-[.22em] text-dim">ДОСКА</div>
        <Toggle on={s.showArrows} onChange={(v) => set({ showArrows: v })} label="Стрелка лучшего хода" hint="и превью-стрелки кандидатов" />
        <Toggle on={game.showNums} onChange={() => game.toggleNums()} label="Номера полей 1–50" />
      </div>
      <div className="py-2">
        <div className="mb-1 font-display text-[9px] font-bold tracking-[.22em] text-dim">ИГРА</div>
        <Toggle on={s.autoCapture} onChange={(v) => set({ autoCapture: v })} label="Авто-взятие" hint="обязательный бой — автоматически; максимум по правилу большинства" />
        {s.autoCapture && (
          <SliderRow
            label="Темп взятия" value={s.captureDelay} min={200} max={2000} step={100}
            fmt={(v) => `${(v / 1000).toFixed(1)} с`} onChange={(v) => set({ captureDelay: v })}
          />
        )}
        <Toggle on={s.autoSingle} onChange={(v) => set({ autoSingle: v })} label="Авто-ход" hint="клик по шашке с единственным ходом — сразу ходит" />
      </div>
      <div className="pt-2">
        <div className="mb-1 font-display text-[9px] font-bold tracking-[.22em] text-dim">ДВИЖОК</div>
        <SliderRow
          label="Глубина анализа" value={s.engineDepth} min={4} max={16} step={1}
          fmt={(v) => `${v} п/х`} onChange={(v) => set({ engineDepth: v })}
        />
        <SliderRow
          label="Время на ход" value={s.engineTime} min={500} max={5000} step={250}
          fmt={(v) => `${(v / 1000).toFixed(1)} с`} onChange={(v) => set({ engineTime: v })}
        />
        <p className="mt-1 text-[10px] leading-relaxed text-dim">
          Счёт идёт в отдельном потоке (PVS + LMR, хеш-таблица между позициями). Лучший ход
          «пондерится» заранее: сыграете его — анализ отдаётся мгновенно.
        </p>
      </div>
    </div>
  );
}

/* ================= доска ================= */


function Crown() {
  return (
    <svg viewBox="0 0 24 24" className="h-[46%] w-[46%] drop-shadow-[0_1px_2px_rgba(0,0,0,.6)]">
      <path d="M4 17h16l1.5-8.5-4.7 3.4L12 5.5 7.2 11.9 2.5 8.5z" fill="#e8b04b" stroke="#8a5f1d" strokeWidth="1" strokeLinejoin="round" />
      <rect x="4" y="17.6" width="16" height="2.4" rx="0.8" fill="#e8b04b" stroke="#8a5f1d" strokeWidth="0.8" />
    </svg>
  );
}

interface ArrowMove { from: number; to: number; path: number[]; captures: number[] }
interface PieceInfo { n: number; color: Side; king: boolean; id: number; fresh: boolean }

function BoardView({
  pos, legal, selected, lastMove, best, preview, flipped, showNums, winner, movableFroms, onSquare,
}: {
  pos: Pos; legal: Move[]; selected: number | null; lastMove: Move | null;
  best: ArrowMove | null; preview: ArrowMove | null;
  flipped: boolean; showNums: boolean;
  winner: Side | null; movableFroms: Set<number>; onSquare: (n: number) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(360);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setPx(Math.max(200, e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const prevInfo = useRef<Map<number, { id: number; color: Side }>>(new Map());
  const counter = useRef(0);
  const cache = useRef<{ key: string; list: PieceInfo[] } | null>(null);

  const pieces = useMemo(() => {
    const key = pos.b.join('') + pos.side;
    if (cache.current?.key === key) return cache.current.list;
    const prev = prevInfo.current;
    const prevIds = new Set([...prev.values()].map((v) => v.id));
    const next = new Map<number, { id: number; color: Side }>();
    const placed = new Set<number>();
    const list: PieceInfo[] = [];
    const add = (n: number, color: Side, king: boolean, id: number) => {
      next.set(n, { id, color }); placed.add(n);
      list.push({ n, color, king, id, fresh: !prevIds.has(id) });
    };
    if (lastMove) {
      const e = prev.get(lastMove.from);
      const v = pos.b[lastMove.to];
      if (e && v !== 0 && Math.sign(v) === e.color) add(lastMove.to, e.color, Math.abs(v) === 2, e.id);
    }
    for (let n = 1; n <= 50; n++) {
      const v = pos.b[n];
      if (v === 0 || placed.has(n)) continue;
      const e = prev.get(n);
      if (e && e.color === Math.sign(v)) add(n, e.color, Math.abs(v) === 2, e.id);
    }
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

  const selMoves = useMemo(() => (selected !== null ? legal.filter((m) => m.from === selected) : []), [selected, legal]);
  const destQuiet = useMemo(() => new Set(selMoves.filter((m) => m.captures.length === 0).map((m) => m.to)), [selMoves]);
  const destCaps = useMemo(() => new Set(selMoves.filter((m) => m.captures.length > 0).map((m) => m.to)), [selMoves]);
  const victims = useMemo(() => {
    const s = new Set<number>();
    for (const m of selMoves) for (const c of m.captures) s.add(c);
    return s;
  }, [selMoves]);

  /* стрелка: координаты в пикселях доски — толщина зависит от размера */
  const arrowMove = preview ?? best;
  const arrow = useMemo(() => {
    if (!arrowMove) return null;
    const cell = px / 10;
    const sw = Math.max(2.5, px * 0.011);
    const head = Math.max(7, px * 0.028);
    const ring = Math.max(1.5, px * 0.004);
    const seq = [arrowMove.from, ...(arrowMove.path.length > 0 ? arrowMove.path : [arrowMove.to])];
    const pts: [number, number][] = [];
    for (const n of seq) {
      const [r, c] = rc(n);
      const rr = flipped ? 9 - r : r;
      const cc = flipped ? 9 - c : c;
      const p: [number, number] = [(cc + 0.5) * cell, (rr + 0.5) * cell];
      const last = pts[pts.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      pts.push(p);
    }
    if (pts.length >= 2) {
      const a = pts[pts.length - 2]; const b = pts[pts.length - 1];
      const dx = b[0] - a[0]; const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const cut = Math.min(cell * 0.35, head * 0.6);
      pts[pts.length - 1] = [b[0] - (dx / len) * cut, b[1] - (dy / len) * cut];
    }
    return {
      d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '),
      caps: arrowMove.captures, isCap: arrowMove.captures.length > 0,
      sw, head, ring, cell,
    };
  }, [arrowMove, flipped, px]);

  return (
    <div ref={frameRef} className={`board-frame relative aspect-square w-full overflow-hidden rounded-xl ${winner !== null ? 'saturate-[.7]' : ''}`}>
      {/* поля + координаты внутри доски */}
      <div className="absolute inset-0 grid grid-cols-10 grid-rows-10">
        {Array.from({ length: 100 }, (_, i) => {
          /* sr/sc — экранные координаты, r/c — board (с учётом переворота).
             Единый маппинг: экран ↔ доска, как у шашек, стрелок и кликов. */
          const sr = (i / 10) | 0; const sc = i % 10;
          const r = flipped ? 9 - sr : sr;
          const c = flipped ? 9 - sc : sc;
          const n = sq(r, c);
          const dark = (r + c) % 2 === 1;
          /* светлые поля неинтерактивны; ключ — экранный индекс, стабилен
             при перевороте, поэтому клетки не пересоздаются и не пропадают */
          if (!dark) return <div key={i} className="sq-light relative block h-full w-full" />;
          const isLast = lastMove !== null && (lastMove.from === n || lastMove.to === n);
          const isSel = selected === n;
          return (
            <button key={i} type="button" onClick={() => onSquare(n)} className="sq-dark relative block h-full w-full">
              {showNums && <span className="sq-num">{n}</span>}
              {isLast && <span className="pointer-events-none absolute inset-0 bg-acc/20" />}
              {isSel && <span className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-acc" />}
              {destQuiet.has(n) && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="h-[30%] w-[30%] rounded-full border border-acc/70 bg-acc/35 shadow-[0_0_10px_color-mix(in_oklab,var(--accent)_50%,transparent)]" />
                </span>
              )}
              {destCaps.has(n) && <span className="dest-pulse pointer-events-none absolute inset-0 ring-[3px] ring-inset ring-[#d9534a]/90" />}
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
        return (
          <div
            key={p.id}
            className="piece-layer"
            style={{ transform: `translate(${cc * 100}%, ${rr * 100}%)` }}
            onClick={() => onSquare(p.n)}
          >
            <div className={[
              'piece-disc',
              p.color === WHITE ? 'piece-white' : 'piece-black',
              p.fresh ? 'piece-pop' : '',
              selected === p.n ? 'piece-selected' : '',
            ].join(' ')}>
              {p.king && <Crown />}
            </div>
          </div>
        );
      })}

      {/* стрелка: рисуется сразу, без анимации прорисовки */}
      {arrow && (
        <svg viewBox={`0 0 ${px} ${px}`} className="pointer-events-none absolute inset-0 z-30 h-full w-full">
          <defs>
            <marker
              id="ah" markerUnits="userSpaceOnUse"
              markerWidth={arrow.head} markerHeight={arrow.head}
              refX={arrow.head * 0.82} refY={arrow.head / 2} orient="auto"
            >
              <path d={`M0,0 L${arrow.head},${arrow.head / 2} L0,${arrow.head} Z`} fill={preview ? '#7fc4a4' : 'var(--accent)'} />
            </marker>
          </defs>
          <path
            d={arrow.d} fill="none"
            stroke={preview ? '#7fc4a4' : 'var(--accent)'}
            strokeOpacity={preview ? 0.85 : 0.95}
            strokeWidth={arrow.sw}
            strokeLinecap="round" strokeLinejoin="round"
            markerEnd="url(#ah)"
            style={{ filter: `drop-shadow(0 0 ${Math.max(2, px * 0.006)}px ${preview ? 'rgba(127,196,164,.45)' : 'color-mix(in oklab, var(--accent) 45%, transparent)'})` }}
          />
          {arrow.caps.map((n) => {
            const [r, c] = rc(n);
            const rr = flipped ? 9 - r : r; const cc = flipped ? 9 - c : c;
            return (
              <circle
                key={n}
                cx={(cc + 0.5) * arrow.cell} cy={(rr + 0.5) * arrow.cell} r={arrow.cell * 0.28}
                fill="rgba(217,83,74,.16)" stroke="#d9534a" strokeWidth={arrow.ring}
              />
            );
          })}
        </svg>
      )}

      {winner !== null && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#0a1214]/55 backdrop-blur-[2px]">
          <div className="rounded-lg border border-acc/40 bg-pan/95 px-6 py-4 text-center shadow-[0_10px_40px_rgba(0,0,0,.5)]">
            <div className="font-display text-sm font-bold tracking-[.18em] text-acc2 sm:text-base">
              {winner === WHITE ? 'ПОБЕДА БЕЛЫХ' : 'ПОБЕДА ЧЁРНЫХ'}
            </div>
            <div className="mt-1 text-xs text-mut">у соперника нет ходов · ФМЖД</div>
          </div>
        </div>
      )}
    </div>
  );
}

function EvalBar({ pos }: { pos: Pos }) {
  const mat = useMemo(() => {
    let m = 0;
    for (let n = 1; n <= 50; n++) {
      const v = pos.b[n];
      if (v === 1) m++; else if (v === -1) m--;
      else if (v === 2) m += 3; else if (v === -2) m -= 3;
    }
    return m;
  }, [pos]);
  const pct = 50 + Math.max(-46, Math.min(46, mat * 9));
  return (
    <div className="mt-2.5 flex h-2 overflow-hidden rounded-full border border-white/10 bg-[#101d20]" title={`Материал: ${mat > 0 ? `+${mat} у белых` : mat < 0 ? `+${-mat} у чёрных` : 'поровну'}`}>
      <div className="eval-h-white" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ================= панель анализа ================= */

/* Склонение существительных: 1 шашка, 2 шашки, 5 шашек */
const plural = (n: number, [one, few, many]: [string, string, string]): string => {
  const m10 = n % 10; const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const menStr = (n: number): string => (n ? `${n} ${plural(n, ['шашка', 'шашки', 'шашек'])}` : '');
const kingStr = (n: number): string => (n ? `${n} ${plural(n, ['дамка', 'дамки', 'дамок'])}` : '');
const sideStr = (men: number, kings: number): string =>
  [menStr(men), kingStr(kings)].filter(Boolean).join(' · ') || 'нет фигур';

/* Мини-кружок шашки для строки материала */
function MatDot({ king, light }: { king?: boolean; light: boolean }) {
  return (
    <span
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${
        light
          ? 'bg-[#eadbb4] shadow-[inset_0_0_0_1px_rgba(120,90,40,.4)]'
          : 'bg-[#262b31] shadow-[inset_0_0_0_1px_rgba(235,255,250,.3)]'
      }`}
    >
      {king && (
        <svg viewBox="0 0 24 24" className="h-2 w-2">
          <path d="M4 17h16l1.5-8-4.5 3L12 5l-5 7-4.5-3z" fill="#e8b04b" />
        </svg>
      )}
    </span>
  );
}

function TbBlock({ tb, b }: { tb: TbVerdict; b: Int8Array }) {
  const m = materialInfo(b);
  const label = tb.result === 1 ? 'Выигрыш белых' : tb.result === -1 ? 'Выигрыш чёрных' : 'Ничья';
  const conf = tb.confidence === 'theory' ? 'точная теория' : 'практически решено';
  const tone = tb.result === 0
    ? 'border-white/15 bg-white/[.05]'
    : tb.result === 1
      ? 'border-[#5fb287]/45 bg-[#5fb287]/10'
      : 'border-[#d9534a]/45 bg-[#d9534a]/10';
  const toneText = tb.result === 0 ? 'text-body' : tb.result === 1 ? 'text-[#8ed0ae]' : 'text-[#e5938b]';
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2.5 ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="chip chip-amber shrink-0">ЭНДШПИЛЬ · БАЗА ФИГУР</span>
        <span className={`text-xs font-bold ${toneText}`}>{label}</span>
        <span className={`ml-auto text-[9px] uppercase tracking-[.14em] ${toneText} opacity-80`}>{conf}</span>
      </div>
      {/* состав материала, из которого сделан вывод */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-mut">
        <span className="inline-flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {Array.from({ length: m.wM }, (_, i) => <MatDot key={`wm${i}`} light />)}
            {Array.from({ length: m.wK }, (_, i) => <MatDot key={`wk${i}`} light king />)}
          </span>
          белые {sideStr(m.wM, m.wK)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {Array.from({ length: m.bM }, (_, i) => <MatDot key={`bm${i}`} light={false} />)}
            {Array.from({ length: m.bK }, (_, i) => <MatDot key={`bk${i}`} light={false} king />)}
          </span>
          чёрные {sideStr(m.bM, m.bK)}
        </span>
      </div>
      <div className={`mt-1 text-[10px] leading-snug ${toneText} opacity-90`}>{tb.note}</div>
    </div>
  );
}

function AnalysisPanel({
  game, s, onPlay, onHover,
}: {
  game: GameApi; s: Settings;
  onPlay: (from: number, to: number) => void;
  onHover: (m: ArrowMove | null) => void;
}) {
  const { engine, boardKey, pos, tb } = game;
  const stale = engine.forKey !== boardKey;
  const thinking = engine.thinking || stale;
  const whiteScore = engine.score !== null ? engine.score * pos.side : null;
  const t = tempi(pos.b);

  const scoreText = whiteScore === null ? '—'
    : engine.mate ? (whiteScore > 0 ? 'мат · белые' : 'мат · чёрные')
      : `${whiteScore / 100 > 0 ? '+' : ''}${(whiteScore / 100).toFixed(2)}`;

  const verdict = whiteScore === null ? 'расчёт позиции…'
    : engine.mate ? 'форсированный выигрыш'
      : Math.abs(whiteScore) < 15 ? 'равная позиция'
        : Math.abs(whiteScore) < 60 ? 'небольшой перевес'
          : Math.abs(whiteScore) < 160 ? 'заметный перевес' : 'решающий перевес';

  const materialChip = whiteScore !== null && !engine.mate && Math.abs(whiteScore) >= 100
    ? `${whiteScore > 0 ? '+' : '−'}${Math.floor(Math.abs(whiteScore) / 100)} шаш.` : null;

  const hoverCandidate = (from: number, to: number) => {
    const m = game.legal.find((mm) => mm.from === from && mm.to === to);
    onHover(m ? { from: m.from, to: m.to, path: m.path, captures: m.captures } : { from, to, path: [], captures: [] });
  };

  return (
    <section className="panel p-3.5 sm:p-4" onMouseLeave={() => onHover(null)}>
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">АНАЛИЗ</h2>
        <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-[10px] text-mut">
          <Dot color={thinking ? 'var(--accent)' : '#5fb287'} pulse={thinking} />
          {thinking ? `счёт · d${engine.depth || '…'}` : `готово · d${engine.depth} · ${engine.ms} мс`}
        </span>
      </header>

      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={`font-mono text-[2.1rem] font-bold leading-none tabular-nums sm:text-[2.5rem] ${
            whiteScore === null ? 'text-dim' : whiteScore > 10 ? 'text-ink' : whiteScore < -10 ? 'text-mut' : 'text-body'
          } ${thinking ? 'score-thinking' : ''}`}>
            {scoreText}
          </div>
          <div className="mt-1 text-[11px] text-mut">
            {verdict}{whiteScore !== null && !engine.mate ? ` · ${whiteScore >= 0 ? 'белые' : 'чёрные'}` : ''}
            {engine.book && <span className="chip chip-amber ml-2">{engine.book}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="chip">{engine.nodes ? `${(engine.nodes / 1000).toFixed(0)}k узлов` : '—'}</span>
          <span className="chip">{engine.nps ? `${(engine.nps / 1000).toFixed(0)}kN/с` : '—'}</span>
          <span className="chip">темпы {t > 0 ? `+${t}` : t}</span>
          {materialChip && <span className="chip chip-amber">{materialChip}</span>}
        </div>
      </div>

      {thinking && <div className="shimmer mt-2 h-0.5 w-full overflow-hidden rounded-full opacity-70" />}

      {tb && <TbBlock tb={tb} b={pos.b} />}

      {engine.best && !stale ? (
        <button
          type="button" onClick={() => onPlay(engine.best!.from, engine.best!.to)}
          className="group mt-3 flex w-full items-center justify-between rounded-lg border border-acc/40 bg-acc/10 px-4 py-3 text-left transition-all duration-150 hover:border-acc/80 hover:bg-acc/18 active:scale-[.98]"
        >
          <span>
            <span className="block text-[9px] font-semibold uppercase tracking-[.18em] text-acc">Лучший ход</span>
            <span className="font-mono text-xl font-bold text-acc2 sm:text-2xl">
              {engine.best.from}{(() => {
                const m = game.legal.find((mm) => mm.from === engine.best!.from && mm.to === engine.best!.to);
                return m && m.captures.length > 0 ? 'x' : '-';
              })()}{engine.best.to}
            </span>
          </span>
          <span className="rounded-lg border border-acc/50 px-3 py-2 text-xs font-semibold text-acc2 group-hover:bg-acc/20">
            сыграть →
          </span>
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-white/8 bg-white/[.03] px-4 py-3">
          <span className="spinner" />
          <span className="text-xs text-mut">{stale ? 'позиция изменилась — пересчёт…' : 'движок ищет лучший ход…'}</span>
        </div>
      )}

      {s.showArrows && engine.candidates.length > 0 && !stale && (
        <div className="mt-3">
          <div className="sr-only">Кандидаты</div>
          <ul className="divide-y divide-white/[.06] overflow-hidden rounded-lg border border-white/10">
            {engine.candidates.map((c, i) => {
              const sc = (c.score * pos.side) / 100;
              return (
                <li key={`${c.from}-${c.to}-${i}`}>
                  <button
                    type="button"
                    onMouseEnter={() => hoverCandidate(c.from, c.to)}
                    onFocus={() => hoverCandidate(c.from, c.to)}
                    onClick={() => onPlay(c.from, c.to)}
                    className="flex w-full items-center gap-2.5 bg-white/[.02] px-3 py-2.5 text-left transition-colors hover:bg-acc/10 active:bg-acc/20"
                  >
                    <span className="w-4 font-mono text-[11px] text-dim">{i + 1}</span>
                    <span className="font-mono text-base font-semibold text-ink">{c.from}{c.caps > 0 ? 'x' : '-'}{c.to}</span>
                    {c.caps > 0 && (
                      <span className="rounded bg-[#d9534a]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#e58a82]">×{c.caps}</span>
                    )}
                    <span className={`ml-auto font-mono text-xs tabular-nums ${sc >= 0 ? 'text-[#8ed0ae]' : 'text-[#c9a0a0]'}`}>
                      {sc > 0 ? '+' : ''}{sc.toFixed(2)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {engine.pv.length > 1 && !stale && (
        <div className="mt-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[.18em] text-dim">Главная линия</div>
          <div className="font-mono text-xs leading-relaxed text-mut">
            {engine.pv.map((m, i) => (
              <span key={i}>
                <span className="text-dim">{Math.floor(i / 2) + 1}{i % 2 === 0 ? '.' : '…'}</span>{' '}
                <span className={i === 0 ? 'text-acc2' : ''}>{m.from}-{m.to}</span>{' '}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ================= лента ходов ================= */

function MovesPanel({ game }: { game: GameApi }) {
  const { moves, ply, goto } = game;
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [ply]);

  const rows: { no: number; w?: Move; wPly: number; b?: Move; bPly: number }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ no: i / 2 + 1, w: moves[i], wPly: i + 1, b: moves[i + 1], bPly: i + 2 });
  }

  return (
    <section className="panel flex flex-col p-3.5 sm:p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">ПАРТИЯ</h2>
        <span className="font-mono text-[11px] text-dim">ход {ply}/{moves.length}</span>
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-white/10 scroll-slim sm:max-h-80">
        <button
          type="button" ref={ply === 0 ? activeRef : undefined} onClick={() => goto(0)}
          className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[.06] ${ply === 0 ? 'bg-acc/12' : ''}`}
        >
          <span className="w-8 font-mono text-[11px] text-dim">—</span>
          <span className="text-xs text-mut">начальная позиция{ply === 0 ? ' · сейчас' : ''}</span>
        </button>
        {rows.map((row) => (
          <div key={row.no} className="flex items-stretch border-t border-white/[.05]">
            <span className="flex w-9 shrink-0 items-center justify-center font-mono text-[11px] text-dim">{row.no}.</span>
            <button
              type="button" ref={ply === row.wPly ? activeRef : undefined} onClick={() => goto(row.wPly)}
              className={`flex-1 px-2 py-2 text-left font-mono text-sm transition-colors hover:bg-white/[.07] active:bg-acc/20 ${
                ply === row.wPly ? 'bg-acc/15 font-bold text-acc2' : 'text-body'}`}
            >
              {row.w ? moveNotation(row.w) : ''}
            </button>
            <button
              type="button" ref={ply === row.bPly ? activeRef : undefined} onClick={() => row.b && goto(row.bPly)}
              className={`flex-1 px-2 py-2 text-left font-mono text-sm transition-colors hover:bg-white/[.07] active:bg-acc/20 ${
                ply === row.bPly ? 'bg-acc/15 font-bold text-acc2' : 'text-body'} ${row.b ? '' : 'cursor-default opacity-30'}`}
            >
              {row.b ? moveNotation(row.b) : '…'}
            </button>
          </div>
        ))}
        {moves.length === 0 && (
          <div className="px-3 py-5 text-center text-xs text-dim">
            Ходов пока нет — делайте ходы на доске или загрузите партию во вкладке «Форматы».
          </div>
        )}
      </div>
      <div className="mt-2 text-[10px] leading-relaxed text-dim">
        Ход с середины партии создаёт новый вариант — хвост отбрасывается.
      </div>
    </section>
  );
}

/* ================= форматы ================= */

function FormatsPanel({ game }: { game: GameApi }) {
  const { fen, moves, headers, loadFenText, loadPDNText } = game;
  const [fenInput, setFenInput] = useState('');
  const [pdnInput, setPdnInput] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const pdnText = toPDN(headers, moves, '*');

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
      setMsg({ kind: 'ok', text: `${what} скопирован` });
    } catch { setMsg({ kind: 'err', text: 'Буфер обмена недоступен' }); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([pdnText], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'partiya.pdn'; a.click();
    URL.revokeObjectURL(url);
    setMsg({ kind: 'ok', text: 'partiya.pdn сохранён' });
  };

  return (
    <div className="flex flex-col gap-3.5">
      {msg && (
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
          msg.kind === 'ok' ? 'border-[#5fb287]/40 bg-[#5fb287]/10 text-[#8ed0ae]' : 'border-[#d9534a]/40 bg-[#d9534a]/10 text-[#e5938b]'}`}>
          {msg.kind === 'ok' ? <ICheck size={14} /> : <IWarn size={14} />}
          {msg.text}
        </div>
      )}
      <section className="panel p-3.5 sm:p-4">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">FEN ПОЗИЦИИ</h2>
          <span className="chip">Liens</span>
        </header>
        <div className="flex gap-1.5">
          <input value={fen} readOnly spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 font-mono text-xs text-body outline-none" />
          <TBtn title="Копировать FEN" onClick={() => copy(fen, 'FEN')} className="shrink-0">
            {copied === 'FEN' ? <ICheck size={15} /> : <ICopy size={15} />}
          </TBtn>
        </div>
        <div className="mt-2 flex gap-1.5">
          <input value={fenInput} onChange={(e) => setFenInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const err = loadFenText(fenInput);
                setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Позиция загружена' });
              }
            }}
            placeholder="W:W31-50:B1-20" spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 font-mono text-xs text-ink outline-none transition-colors placeholder:text-dim focus:border-acc/60" />
          <TBtn title="Загрузить позицию" accent onClick={() => {
            const err = loadFenText(fenInput);
            setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Позиция из FEN загружена' });
          }} className="shrink-0">
            <ILoad size={15} />
          </TBtn>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-dim">
          <span className="font-mono text-mut">сторона:белые:чёрные</span>, дамки — <span className="font-mono text-mut">K</span>, диапазоны через дефис.
        </p>
      </section>

      <section className="panel p-3.5 sm:p-4">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">ПАРТИЯ · PDN</h2>
          <span className="chip">{moves.length} полуходов</span>
        </header>
        <textarea value={pdnInput} onChange={(e) => setPdnInput(e.target.value)} rows={6} spellCheck={false}
          placeholder={'Вставьте партию в PDN:\n1.32-28 19-23 2.28x19 14x23 ...'}
          className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 font-mono text-xs leading-relaxed text-ink outline-none transition-colors placeholder:text-dim focus:border-acc/60 scroll-slim" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <TBtn accent title="Разобрать PDN" onClick={() => {
            const err = loadPDNText(pdnInput);
            setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Партия загружена' });
          }}>
            <ILoad size={15} /><span className="text-xs font-semibold">Загрузить</span>
          </TBtn>
          <TBtn title="Пример партии" onClick={() => {
            setPdnInput(SAMPLE_PDN);
            const err = loadPDNText(SAMPLE_PDN);
            setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Пример загружен — листайте ходы' });
          }}>
            <IBook size={15} /><span className="text-xs">Пример</span>
          </TBtn>
          <TBtn title="Копировать PDN" onClick={() => copy(pdnText, 'PDN')}>
            {copied === 'PDN' ? <ICheck size={15} /> : <ICopy size={15} />}
          </TBtn>
          <TBtn title="Скачать .pdn" onClick={download}>
            <IDown size={15} /><span className="text-xs">.pdn</span>
          </TBtn>
        </div>
      </section>
    </div>
  );
}

/* ================= приложение ================= */

type Tab = 'analysis' | 'game' | 'formats';

const TABS: { id: Tab; label: string }[] = [
  { id: 'analysis', label: 'Анализ' },
  { id: 'game', label: 'Партия' },
  { id: 'formats', label: 'Форматы' },
];

function Logo() {
  return (
    <svg viewBox="0 0 36 36" className="h-8 w-8 shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,.5)] sm:h-9 sm:w-9">
      <rect x="1" y="1" width="34" height="34" rx="7" fill="#132a2e" stroke="#2c5a5e" strokeWidth="1.4" />
      <path d="M1 8a7 7 0 017-7h9v17H1z" fill="#d8e0d8" opacity=".9" />
      <path d="M18 18h17v10a7 7 0 01-7 7H18z" fill="#d8e0d8" opacity=".9" />
      <circle cx="18" cy="18" r="8.2" fill="url(#lg)" stroke="#8a5f1d" strokeWidth="1" />
      <path d="M13.6 19.4h8.8l.8-4.4-2.5 1.8L18 13.4l-2.7 3.4-2.5-1.8z" fill="#f6d489" stroke="#8a5f1d" strokeWidth=".7" />
      <defs>
        <radialGradient id="lg" cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#3d434b" /><stop offset="60%" stopColor="#20242a" /><stop offset="100%" stopColor="#0d0f12" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export default function App() {
  const [s, setSState] = useState<Settings>(loadSettings);
  const set = (p: Partial<Settings>) => setSState((prev) => ({ ...prev, ...p }));
  useEffect(() => { saveSettings(s); }, [s]);

  const g = useGame({
    engineDepth: s.engineDepth, engineTime: s.engineTime,
    autoCapture: s.autoCapture, captureDelay: s.captureDelay, autoSingle: s.autoSingle,
  });

  const [tab, setTab] = useState<Tab>('analysis');
  const [preview, setPreview] = useState<ArrowMove | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef(g);
  gameRef.current = g;

  useEffect(() => {
    if (!settingsOpen) return;
    const onDoc = (e: PointerEvent) => { if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [settingsOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const gg = gameRef.current;
      if (e.key === 'ArrowLeft') { e.preventDefault(); gg.prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); gg.next(); }
      else if (e.key === 'Home') { e.preventDefault(); gg.toStart(); }
      else if (e.key === 'End') { e.preventDefault(); gg.toEnd(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const engineReady = g.engine.forKey === g.boardKey;
  const bestFull = useMemo(() => {
    if (!engineReady || !g.engine.best) return null;
    const b = g.engine.best;
    return g.legal.find((m) => m.from === b.from && m.to === b.to) ?? null;
  }, [engineReady, g.engine.best, g.legal]);
  const best: ArrowMove | null = s.showArrows && bestFull
    ? { from: bestFull.from, to: bestFull.to, path: bestFull.path, captures: bestFull.captures }
    : null;

  return (
    <div className="min-h-dvh">
      {/* шапка */}
      <header className="relative z-50 border-b border-white/[.07] bg-pan/80 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1120px] items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4">
          <Logo />
          <div className="min-w-0">
            <h1 className="font-display text-[13px] font-black leading-none tracking-[.12em] text-ink sm:text-base">
              СТО<span className="text-acc2">КЛЕТКА</span>
            </h1>
            <p className="mt-0.5 truncate text-[10px] leading-none text-dim">шашки 100 · ФМЖД</p>
          </div>
          <div className="ml-auto hidden items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 md:flex">
            <Dot color={g.engine.thinking ? 'var(--accent)' : '#5fb287'} pulse={g.engine.thinking} />
            <span className="font-mono text-[11px] text-mut">
              движок 0.2 · PVS+LMR{g.engine.thinking ? ` · d${g.engine.depth || 1}…` : g.engine.depth ? ` · d${g.engine.depth}` : ''}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <ThemePicker />
            <div ref={settingsRef} className="relative">
              <TBtn title="Настройки" active={settingsOpen} onClick={() => setSettingsOpen((v) => !v)} className="h-10 w-10 px-0">
                <IGear size={17} />
              </TBtn>
              {settingsOpen && (
                <div className="pop-in absolute right-0 top-12 z-50 w-[300px] rounded-xl border border-white/12 bg-pan/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,.55)] backdrop-blur-md">
                  <div className="mb-2 font-display text-[10px] font-bold tracking-[.22em] text-dim">НАСТРОЙКИ</div>
                  <SettingsPanel s={s} set={set} game={g} />
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1120px] gap-5 px-3 py-4 min-[760px]:grid-cols-[minmax(0,1fr)_370px] min-[760px]:gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* левая колонка: доска + пульт */}
        <div className="min-w-0">
          <div className="mx-auto max-w-[560px]">
            <BoardView
              pos={g.pos} legal={g.legal} selected={g.selected} lastMove={g.lastMove}
              best={best} preview={preview} flipped={g.flipped} showNums={g.showNums}
              winner={g.winner} movableFroms={g.movableFroms} onSquare={g.clickSquare}
            />
            <EvalBar pos={g.pos} />
          </div>

          <div className="mx-auto mt-3 max-w-[560px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all duration-300 ${
                !g.winner && g.pos.side === WHITE ? 'border-acc/60 bg-acc/12 text-acc2' : 'border-white/10 bg-white/[.03] text-dim'}`}>
                <span className="h-2 w-2 rounded-full bg-ink" />Белые
              </span>
              <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all duration-300 ${
                !g.winner && g.pos.side !== WHITE ? 'border-acc/60 bg-acc/12 text-acc2' : 'border-white/10 bg-white/[.03] text-dim'}`}>
                <span className="h-2 w-2 rounded-full bg-[#15181c] shadow-[0_0_0_1px_rgba(255,255,255,.3)]" />Чёрные
              </span>
              <span className="ml-auto font-mono text-[10px] text-dim">
                {g.winner !== null ? 'партия окончена' : `ход ${g.pos.side === WHITE ? 'белых' : 'чёрных'}`}
              </span>
            </div>

            {g.mustCapture && g.winner === null && (
              <div className={`mt-2 flex items-center gap-1.5 rounded-lg border border-[#d9534a]/50 bg-[#d9534a]/12 px-3 py-1.5 text-[11px] font-bold tracking-wide text-[#e58a82] ${s.autoCapture ? '' : 'dest-pulse'}`}>
                <IWarn size={13} />ВЗЯТИЕ ОБЯЗАТЕЛЬНО{s.autoCapture ? <span className="chip chip-amber ml-1">АВТО</span> : ''}
              </div>
            )}

            <div className="mt-2.5 flex items-center gap-1.5">
              <TBtn title="В начало" onClick={g.toStart} disabled={g.ply === 0} className="h-12 flex-1"><IFirst /></TBtn>
              <TBtn title="Назад" onClick={g.prev} disabled={g.ply === 0} className="h-12 flex-1"><IPrev /></TBtn>
              <TBtn
                title={g.auto ? 'Пауза' : 'Автопроигрывание'} accent active={g.auto}
                onClick={() => g.setAuto(!g.auto)} disabled={g.moves.length === 0}
                className="h-12 flex-1"
              >
                {g.auto ? <IPause /> : <IPlay />}
              </TBtn>
              <TBtn title="Вперёд" onClick={g.next} disabled={g.ply >= g.moves.length} className="h-12 flex-1"><INext /></TBtn>
              <TBtn title="В конец" onClick={g.toEnd} disabled={g.ply >= g.moves.length} className="h-12 flex-1"><ILast /></TBtn>
              <span className="mx-0.5 hidden h-7 w-px bg-white/10 sm:block" />
              <TBtn title="Перевернуть доску" onClick={g.toggleFlip} active={g.flipped} className="h-12 w-11 px-0"><IFlip /></TBtn>
              <TBtn title="Номера полей 1–50 на доске" onClick={g.toggleNums} active={g.showNums} className="h-12 w-12 px-0">
                <span className="font-mono text-[11px] font-bold">1–50</span>
              </TBtn>
              <TBtn title="Новая партия" onClick={g.newGame} className="h-12 w-11 px-0"><IPlus /></TBtn>
            </div>

            <p className="mt-2.5 hidden text-[10px] leading-relaxed text-dim min-[760px]:block">
              Клик по своей шашке — выбор, по подсвеченному полю — ход. «×» — побиваемые поля. Стрелка — лучший ход движка.
            </p>
          </div>
        </div>

        {/* правая колонка */}
        <div className="flex min-w-0 flex-col gap-3.5">
          <nav className="grid grid-cols-3 rounded-xl border border-white/10 bg-white/[.03] p-1">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={`rounded-lg px-2 py-2.5 text-xs font-semibold transition-all duration-150 active:scale-[.97] ${
                  tab === t.id
                    ? 'bg-acc/15 text-acc2 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_35%,transparent)]'
                    : 'text-mut hover:bg-white/[.05] hover:text-body'}`}>
                {t.label}
              </button>
            ))}
          </nav>

          {tab === 'analysis' && (
            <AnalysisPanel game={g} s={s} onPlay={(from, to) => g.playFromTo(from, to)} onHover={setPreview} />
          )}
          {tab === 'game' && <MovesPanel game={g} />}
          {tab === 'formats' && <FormatsPanel game={g} />}
        </div>
      </main>

      {/* пустой отступ под жестовую панель (без текста) */}
      <div className="h-[calc(1rem+env(safe-area-inset-bottom))]" aria-hidden="true" />

      {g.hint && (
        <div className="toast-in pointer-events-none fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex items-center gap-2 rounded-lg border border-acc/50 bg-pan/95 px-4 py-2.5 text-xs font-semibold text-acc2 shadow-[0_10px_30px_rgba(0,0,0,.5)] backdrop-blur-sm">
          <IWarn size={14} />{g.hint}
        </div>
      )}
    </div>
  );
}
