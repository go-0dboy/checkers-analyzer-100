/* ============================================================
 * СтоКлетка — инструмент разбора международных шашек (100 клеток,
 * ФМЖД). Дерево ходов с ветвлениями, комментарии и оценки ходов
 * (PDN 3.0), база партий в IndexedDB, расстановка позиций и FEN,
 * анализ (Scan WASM → встроенный движок), обучаемая нейросеть.
 * Mobile-first: нижняя навигация, крупные зоны касания.
 * ============================================================ */

import {
  useEffect, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent, type ReactNode, type SVGProps,
} from 'react';
import {
  type Move, type Pos, type Side, WHITE, rc, sq, tempi,
} from './engine/core';
import { materialInfo } from './engine/tablebase';
import { SAMPLE_PDN } from './engine/pdn';
import { loadSettings, saveSettings, type Settings } from './state/settings';
import { useGame, type GameApi, type CandidateLite } from './state/useGame';
import { NAG_SYMBOLS, nodeSan, pathPositions, type TreeNode } from './state/tree';
import { THEMES, applyTheme, initialTheme, type ThemeId } from './themes';

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
const ITrash = (p: IP) => <svg {...base(p)}><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" /></svg>;
const IBolt = (p: IP) => <svg {...base(p)}><path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5z" fill="currentColor" stroke="none" /></svg>;
const IChipIc = (p: IP) => <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="1.5" /><rect x="10" y="10" width="4" height="4" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></svg>;
const IList = (p: IP) => <svg {...base(p)}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /></svg>;
const IDb = (p: IP) => <svg {...base(p)}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" /></svg>;
const IGrid = (p: IP) => <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>;
const ISave = (p: IP) => <svg {...base(p)}><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>;
const IBranch = (p: IP) => <svg {...base(p)}><circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="9" r="2.2" /><path d="M6 7.2v9.6M6 12c0-2 2-3 4.5-3H15" /></svg>;

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
      <span
        className={`relative w-10 shrink-0 rounded-full border transition-colors duration-200 ${on ? 'border-acc/70 bg-acc/40' : 'border-white/15 bg-white/[.06]'}`}
        style={{ height: 22 }}
      >
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

function SettingsPanel({ s, set, game, onClose }: {
  s: Settings; set: (p: Partial<Settings>) => void; game: GameApi; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div ref={ref} className="pop-in absolute right-0 top-12 z-50 w-[300px] rounded-xl border border-white/12 bg-pan/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,.55)] backdrop-blur-md">
      <div className="mb-2 font-display text-[10px] font-bold tracking-[.22em] text-dim">НАСТРОЙКИ</div>
      <div className="flex flex-col gap-1 divide-y divide-white/[.06]">
        <div className="pb-2">
          <div className="mb-1 font-display text-[9px] font-bold tracking-[.22em] text-dim">ДОСКА</div>
          <Toggle on={s.showArrows} onChange={(v) => set({ showArrows: v })} label="Стрелка лучшего хода" hint="и превью-стрелки кандидатов" />
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
          <Toggle on={s.humanStyle} onChange={(v) => set({ humanStyle: v })} label="Человеческий стиль" hint="среди равных ходов выбирать типичные для игроков" />
        </div>
        <div className="py-2">
          <div className="mb-1 font-display text-[9px] font-bold tracking-[.22em] text-dim">ДВИЖОК</div>
          <Toggle
            on={s.useScan} onChange={(v) => set({ useScan: v })}
            label="Scan 3.1 (WASM)"
            hint={game.scanAvail
              ? 'модуль найден — приоритет над встроенным движком'
              : 'бинарник не найден (public/scan/) — работает встроенный движок'}
          />
          <SliderRow label="Глубина анализа" value={s.engineDepth} min={4} max={14} step={1}
            fmt={(v) => `${v} п/х`} onChange={(v) => set({ engineDepth: v })} />
          <SliderRow label="Время на ход" value={s.engineTime} min={500} max={5000} step={250}
            fmt={(v) => `${(v / 1000).toFixed(1)} с`} onChange={(v) => set({ engineTime: v })} />
        </div>
        <div className="pt-2">
          <div className="mb-1 font-display text-[9px] font-bold tracking-[.22em] text-dim">НЕЙРОСЕТЬ</div>
          <Toggle on={s.nnEnabled} onChange={(v) => set({ nnEnabled: v })} label="Использовать нейросеть" hint="смешивать оценку NNUE с альфа-бета (вкладка «Сеть»)" />
          {s.nnEnabled && (
            <SliderRow label="Вес нейросети" value={Math.round(s.nnBlend * 100)} min={0} max={80} step={5}
              fmt={(v) => `${v}%`} onChange={(v) => set({ nnBlend: v / 100 })} />
          )}
        </div>
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

interface PieceInfo { n: number; color: Side; king: boolean; id: number; fresh: boolean }

function BoardView({
  pos, legal, selected, lastMove, best, preview, flipped, showNums, winner, movableFroms, onSquare,
}: {
  pos: Pos; legal: Move[]; selected: number | null; lastMove: Move | null;
  best: Move | null; preview: Move | null;
  flipped: boolean; showNums: boolean;
  winner: Side | null; movableFroms: Set<number>; onSquare: (n: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(360);

  useEffect(() => {
    const el = wrapRef.current;
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

  const arrowMove = preview ?? best;
  const arrow = useMemo(() => {
    if (!arrowMove || px < 50) return null;
    const cell = px / 10;
    const center = (n: number): [number, number] => {
      const [r, c] = rc(n);
      const sr = flipped ? 9 - r : r;
      const sc = flipped ? 9 - c : c;
      return [(sc + 0.5) * cell, (sr + 0.5) * cell];
    };
    const squares = [arrowMove.from, ...(arrowMove.path.length > 0 ? arrowMove.path : [arrowMove.to])];
    const pts = squares.map(center);
    const clean: [number, number][] = [];
    for (const p of pts) {
      const last = clean[clean.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > 0.1 || Math.abs(last[1] - p[1]) > 0.1) clean.push(p);
    }
    if (clean.length < 2) return null;
    const sw = Math.max(2.5, px * 0.011);
    const a = clean[clean.length - 2]; const bpt = clean[clean.length - 1];
    const ang = Math.atan2(bpt[1] - a[1], bpt[0] - a[0]);
    const ah = sw * 3;
    const bx = bpt[0] - Math.cos(ang) * ah;
    const by = bpt[1] - Math.sin(ang) * ah;
    const line = [...clean.slice(0, -1), [bx, by] as [number, number]];
    const d = line.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const wx = Math.cos(ang + Math.PI / 2) * sw * 1.7;
    const wy = Math.sin(ang + Math.PI / 2) * sw * 1.7;
    const head = `M${bpt[0].toFixed(1)} ${bpt[1].toFixed(1)} L${(bx + wx).toFixed(1)} ${(by + wy).toFixed(1)} L${(bx - wx).toFixed(1)} ${(by - wy).toFixed(1)} Z`;
    return {
      d, head, sw,
      caps: arrowMove.captures.map(center),
      capR: cell * 0.28,
      isPreview: preview !== null,
    };
  }, [arrowMove, preview, flipped, px]);

  return (
    <div className="flex items-stretch gap-2 sm:gap-2.5">
      <EvalBar pos={pos} />
      <div ref={wrapRef} className="relative min-w-0 flex-1">
        <div className={`board-frame relative aspect-square w-full overflow-hidden rounded-lg ${winner !== null ? 'saturate-[.7]' : ''}`}>
          <div className="absolute inset-0 grid grid-cols-10 grid-rows-10">
            {Array.from({ length: 100 }, (_, i) => {
              const sr = (i / 10) | 0; const sc = i % 10;
              const r = flipped ? 9 - sr : sr;
              const c = flipped ? 9 - sc : sc;
              const n = sq(r, c);
              const dark = (r + c) % 2 === 1;
              if (!dark) return <div key={i} className="sq-light relative block h-full w-full" />;
              const isLastFrom = lastMove !== null && lastMove.from === n;
              const isLastTo = lastMove !== null && lastMove.to === n;
              const isSel = selected === n;
              return (
                <button key={i} type="button" onClick={() => onSquare(n)} className="sq-dark relative block h-full w-full">
                  {showNums && <span className="sq-num">{n}</span>}
                  {isLastFrom && <span className="pointer-events-none absolute inset-0 bg-acc/20" />}
                  {isLastTo && (
                    <span className="pointer-events-none absolute inset-0 bg-acc/35 shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--accent)_65%,transparent)]" />
                  )}
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

          {pieces.map((p) => {
            const [r, c] = rc(p.n);
            const sr = flipped ? 9 - r : r;
            const sc = flipped ? 9 - c : c;
            return (
              <div key={p.id} className="piece-layer" style={{ transform: `translate(${sc * 100}%, ${sr * 100}%)` }} onClick={() => onSquare(p.n)}>
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

          {arrow && (
            <svg viewBox={`0 0 ${px} ${px}`} className="pointer-events-none absolute inset-0 z-30 h-full w-full">
              <path
                d={arrow.d} fill="none"
                stroke={arrow.isPreview ? '#7fc4a4' : 'var(--accent)'}
                strokeOpacity={arrow.isPreview ? 0.85 : 0.95}
                strokeWidth={arrow.sw} strokeLinecap="round" strokeLinejoin="round"
                style={{ filter: `drop-shadow(0 0 ${Math.max(2, px * 0.006)}px ${arrow.isPreview ? 'rgba(127,196,164,.45)' : 'color-mix(in oklab, var(--accent) 45%, transparent)'})` }}
              />
              <path d={arrow.head} fill={arrow.isPreview ? '#7fc4a4' : 'var(--accent)'} fillOpacity={arrow.isPreview ? 0.9 : 0.95} />
              {arrow.caps.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={arrow.capR} fill="rgba(217,83,74,.16)" stroke="#d9534a" strokeWidth={Math.max(1.5, arrow.sw * 0.6)} />
              ))}
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
      </div>
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
  return (
    <div className="flex w-3.5 flex-col overflow-hidden rounded-md border border-white/10 bg-[#101d20] sm:w-4" title="Материальный баланс">
      <div className="eval-seg-top" style={{ height: `${50 + Math.max(-46, Math.min(46, mat * 9))}%` }} />
      <div className="eval-seg-bottom flex-1" />
    </div>
  );
}

function BoardGlow({ pos }: { pos: Pos }) {
  const mat = useMemo(() => {
    let m = 0;
    for (let n = 1; n <= 50; n++) {
      const v = pos.b[n];
      if (v === 1) m++; else if (v === -1) m--;
      else if (v === 2) m += 3; else if (v === -2) m -= 3;
    }
    return m;
  }, [pos]);
  const t = Math.max(-46, Math.min(46, mat * 9));
  const strength = Math.abs(t) / 46;
  const style = {
    background: `radial-gradient(60% 55% at ${50 + t * 0.9}% 50%, color-mix(in oklab, var(--accent) ${8 + strength * 24}%, transparent), transparent 70%)`,
  };
  return <div className="board-glow" style={style} aria-hidden="true" />;
}

/* ================= течение партии ================= */

function EvalChart({ start, pathNodes, ply, gotoPly }: {
  start: Pos; pathNodes: TreeNode[]; ply: number; gotoPly: (p: number) => void;
}) {
  const evals = useMemo(() => {
    const poss = pathPositions(start, pathNodes);
    return poss.map((p) => {
      let m = 0;
      for (let n = 1; n <= 50; n++) {
        const v = p.b[n];
        if (v === 1) m++; else if (v === -1) m--;
        else if (v === 2) m += 3; else if (v === -2) m -= 3;
      }
      return m;
    });
  }, [start, pathNodes]);

  const W = 560; const H = 64; const MID = H / 2; const AMP = H / 2 - 6;
  const n = evals.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => MID - (Math.max(-6, Math.min(6, v)) / 6) * AMP;
  const line = evals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)} ${H} L0 ${H} Z`;
  const cur = Math.max(0, Math.min(n - 1, ply));
  const cx = x(cur); const cy = y(evals[cur] ?? 0);

  const onClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const idx = Math.round((px / W) * (n - 1));
    gotoPly(Math.max(0, Math.min(n - 1, idx)));
  };

  return (
    <div className="mt-3 select-none" title="Течение партии: клик — перейти к ходу">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16 w-full cursor-pointer" onClick={onClick}>
        <line x1="0" y1={MID} x2={W} y2={MID} stroke="rgba(255,255,255,.12)" strokeDasharray="3 4" />
        <path d={area} fill="var(--accent)" fillOpacity=".10" />
        <path d={line} fill="none" stroke="var(--accent)" strokeOpacity=".85" strokeWidth="2" strokeLinejoin="round" />
        <line x1={cx} y1="0" x2={cx} y2={H} stroke="var(--accent-2)" strokeOpacity=".5" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r="4" fill="var(--accent-2)" stroke="#0b1416" strokeWidth="1.5" />
      </svg>
      <div className="mt-0.5 text-center text-[9px] text-dim">течение партии · клик — переход к полуходу</div>
    </div>
  );
}

/* ================= съеденные фигуры ================= */

function CapturedDots({ start, pos, color }: { start: Pos; pos: Pos; color: Side }) {
  const count = useMemo(() => {
    const cnt = (b: Int8Array, side: Side) => {
      let m = 0;
      for (let n = 1; n <= 50; n++) if (b[n] * side > 0) m++;
      return m;
    };
    return Math.max(0, cnt(start.b, color) - cnt(pos.b, color));
  }, [start, pos, color]);
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-[3px]">
      {Array.from({ length: Math.min(count, 10) }, (_, i) => (
        <span
          key={i}
          className={`captured-dot h-1.5 w-1.5 rounded-full ${color === WHITE
            ? 'bg-[#eadbb4] shadow-[inset_0_0_0_1px_rgba(120,90,40,.4)]'
            : 'bg-[#15181c] shadow-[0_0_0_1px_rgba(255,255,255,.25)]'}`}
        />
      ))}
      {count > 10 && <span className="font-mono text-[9px]">+{count - 10}</span>}
    </span>
  );
}

/* ================= панель анализа ================= */

function TbBlock({ tb, b }: { tb: NonNullable<GameApi['tb']>; b: Int8Array }) {
  const m = materialInfo(b);
  const label = tb.result === 1 ? 'Выигрыш белых' : tb.result === -1 ? 'Выигрыш чёрных' : 'Ничья';
  const conf = tb.confidence === 'theory' ? 'точная теория' : 'практически решено';
  const tone = tb.result === 0
    ? 'border-white/15 bg-white/[.05]'
    : tb.result === 1 ? 'border-[#5fb287]/45 bg-[#5fb287]/10' : 'border-[#d9534a]/45 bg-[#d9534a]/10';
  const toneText = tb.result === 0 ? 'text-body' : tb.result === 1 ? 'text-[#8ed0ae]' : 'text-[#e5938b]';
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2.5 ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="chip chip-amber shrink-0">ЭНДШПИЛЬ · БАЗА ФИГУР</span>
        <span className={`text-xs font-bold ${toneText}`}>{label}</span>
        <span className={`ml-auto text-[9px] uppercase tracking-[.14em] opacity-80 ${toneText}`}>{conf}</span>
      </div>
      <div className="mt-1 text-[10px] leading-snug text-mut">
        белые: {m.wM} ш. {m.wK} д. · чёрные: {m.bM} ш. {m.bK} д. — {tb.note}
      </div>
    </div>
  );
}

function AnalysisPanel({
  game, s, onPlay, onHover,
}: {
  game: GameApi; s: Settings;
  onPlay: (from: number, to: number) => void;
  onHover: (c: CandidateLite | null) => void;
}) {
  const { engine, boardKey, pos, tb, engineKind } = game;
  const stale = engine.forKey !== boardKey;
  const thinking = engine.thinking || stale;
  const whiteScore = engine.score !== null ? engine.score * pos.side : null;
  const t = tempi(pos.b);
  const isScan = engineKind === 'scan' && !thinking;

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

  return (
    <section className="panel p-3.5 sm:p-4" onMouseLeave={() => onHover(null)}>
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">АНАЛИЗ</h2>
        <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-[10px] text-mut">
          <Dot color={thinking ? 'var(--accent)' : '#5fb287'} pulse={thinking} />
          {isScan
            ? `Scan 3.1 · d${engine.depth}`
            : thinking ? `счёт · d${engine.depth || '…'}` : `α-β · d${engine.depth} · ${engine.ms} мс`}
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
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isScan
            ? <span className="chip chip-amber"><IBolt size={9} className="mr-1 inline" />Scan WASM</span>
            : <span className="chip">{engine.nodes ? `${(engine.nodes / 1000).toFixed(0)}k · ${(engine.nps / 1000).toFixed(0)}kN/s` : '—'}</span>}
          <span className="chip">темпы {t > 0 ? `+${t}` : t}</span>
          {materialChip && <span className="chip chip-amber">{materialChip}</span>}
          {engine.book && <span className="chip chip-amber">книга · {engine.book}</span>}
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
              {engine.best.from}{engine.candidates.find((c) => c.from === engine.best!.from && c.to === engine.best!.to)?.caps ? 'x' : '–'}{engine.best.to}
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

      {engine.candidates.length > 0 && !stale && (
        <div className="mt-3">
          <div className="sr-only">Кандидаты</div>
          <ul className="divide-y divide-white/[.06] overflow-hidden rounded-lg border border-white/10">
            {engine.candidates.map((c, i) => {
              const sc = (c.score * pos.side) / 100;
              return (
                <li key={`${c.from}-${c.to}-${i}`}>
                  <button
                    type="button"
                    onMouseEnter={() => onHover(c)} onFocus={() => onHover(c)}
                    onClick={() => onPlay(c.from, c.to)}
                    className="flex w-full items-center gap-2.5 bg-white/[.02] px-3 py-2.5 text-left transition-colors hover:bg-acc/10 active:bg-acc/20"
                  >
                    <span className="w-4 font-mono text-[11px] text-dim">{i + 1}</span>
                    <span className="font-mono text-base font-semibold text-ink">
                      {c.from}{c.caps ? 'x' : '–'}{c.to}
                    </span>
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
                <span className={i === 0 ? 'text-acc2' : ''}>{m.from}–{m.to}</span>{' '}
              </span>
            ))}
          </div>
        </div>
      )}

      {s.nnEnabled && game.nnMeta && !thinking && !isScan && (
        <div className="mt-2 text-right text-[9px] text-dim">оценка смешана с нейросетью (вес {Math.round(s.nnBlend * 100)}%)</div>
      )}
    </section>
  );
}

/* ================= дерево ходов (PDN 3.0) ================= */

function MoveChip({ node, active, onGoto }: { node: TreeNode; active: boolean; onGoto: (id: string) => void }) {
  const hasComment = node.comment.trim().length > 0;
  return (
    <button
      type="button"
      onClick={() => onGoto(node.id)}
      className={`relative rounded-md border px-1.5 py-1 font-mono text-[13px] leading-none transition-all duration-120 active:scale-[.93] sm:text-sm ${
        active
          ? 'border-acc/70 bg-acc/18 font-bold text-acc2 shadow-[0_0_10px_color-mix(in_oklab,var(--accent)_20%,transparent)]'
          : 'border-white/8 bg-white/[.04] text-body hover:border-white/20 hover:bg-white/[.08]'
      }`}
    >
      {nodeSan(node)}
      {hasComment && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#5fb287]" />}
    </button>
  );
}

function MovesLine({
  node, num, blackNext, curId, onGoto, depth,
}: {
  node: TreeNode; num: number; blackNext: boolean;
  curId: string; onGoto: (id: string) => void; depth: number;
}) {
  /* линия, начинающаяся с хода node; num/blackNext — контекст нотации */
  const elements: ReactNode[] = [];
  let cur: TreeNode | null = node;
  let n = num;
  let black = blackNext;
  let guard = 0;
  while (cur && guard++ < 500) {
    const label = black ? `${n}…` : `${n}.`;
    elements.push(
      <span key={cur.id} className="inline-flex items-center gap-1">
        <span className="font-mono text-[10px] text-dim">{label}</span>
        <MoveChip node={cur} active={cur.id === curId} onGoto={onGoto} />
      </span>,
    );
    /* варианты — альтернативы этому ходу */
    for (let i = 1; i < cur.children.length; i++) {
      elements.push(
        <span key={`v${cur.children[i].id}`} className={`var-wrap ${depth > 0 ? 'var-deep' : ''}`}>
          <span className="var-paren">(</span>
          <MovesLine node={cur.children[i]} num={n} blackNext={black} curId={curId} onGoto={onGoto} depth={depth + 1} />
          <span className="var-paren">)</span>
        </span>,
      );
    }
    const nextNode: TreeNode | null = cur.children[0] ?? null;
    if (nextNode) {
      if (black) n += 1;
      black = !black;
    }
    cur = nextNode;
  }
  return <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1.5">{elements}</span>;
}

function MovesTab({ game }: { game: GameApi }) {
  const { root, curNode, path, gotoNode, setComment, toggleNag, movesTotal } = game;
  const [copied, setCopied] = useState(false);
  const ply = path.length - 1;

  const download = () => {
    const pdn = game.exportPDN();
    const url = URL.createObjectURL(new Blob([pdn], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'partiya.pdn'; a.click();
    URL.revokeObjectURL(url);
  };
  const copyPdn = async () => {
    try {
      await navigator.clipboard.writeText(game.exportPDN());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };

  return (
    <section className="panel flex flex-col p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">ХОДЫ · PDN 3.0</h2>
        <div className="flex items-center gap-1.5">
          <TBtn title="Копировать PDN" onClick={() => void copyPdn()} className="h-8 px-2">
            {copied ? <ICheck size={13} /> : <ICopy size={13} />}
          </TBtn>
          <TBtn title="Скачать .pdn" onClick={download} className="h-8 px-2">
            <IDown size={13} /><span className="text-[11px]">.pdn</span>
          </TBtn>
        </div>
      </div>

      <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-white/10 p-2.5 scroll-slim sm:max-h-64">
        {root.children.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-dim">
            Ходов пока нет — играйте на доске. Любой другой ход с середины партии создаст вариант.
          </div>
        ) : (
          <MovesLine
            node={root.children[0]}
            num={1}
            blackNext={game.start.side !== WHITE}
            curId={curNode.id}
            onGoto={gotoNode}
            depth={0}
          />
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[10px] text-dim">
        <IBranch size={13} className="text-acc2" />
        <span>полуход {ply}/{movesTotal} · варианты — в скобках, клик по ходу — переход</span>
      </div>

      {/* редактор комментария и оценки текущего хода */}
      <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[.18em] text-dim">
            {curNode.move ? `Ход ${nodeSan(curNode).replace(/[!?]+$/, '')}` : 'Стартовая позиция'}
          </span>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5, 6].map((nag) => {
              const on = curNode.nags.includes(nag);
              return (
                <button
                  key={nag}
                  type="button"
                  disabled={!curNode.move}
                  onClick={() => toggleNag(nag)}
                  className={`h-8 min-w-8 rounded-md border px-1 font-mono text-xs font-bold transition-all duration-120 active:scale-[.9] disabled:opacity-25 ${
                    on
                      ? nag === 2 || nag === 4 || nag === 6
                        ? 'border-[#d9534a]/70 bg-[#d9534a]/15 text-[#e58a82]'
                        : 'border-[#5fb287]/70 bg-[#5fb287]/15 text-[#8ed0ae]'
                      : 'border-white/10 bg-white/[.04] text-mut hover:bg-white/[.09]'
                  }`}
                >
                  {NAG_SYMBOLS[nag]}
                </button>
              );
            })}
          </div>
        </div>
        <textarea
          value={curNode.comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={!curNode.move}
          rows={2}
          placeholder={curNode.move ? 'Комментарий к ходу…' : 'Комментарии прикрепляются к ходам'}
          className="mt-2 w-full resize-y rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-xs leading-relaxed text-ink outline-none transition-colors placeholder:text-dim focus:border-acc/60 disabled:opacity-40 scroll-slim"
        />
        <div className="mt-1 text-[9px] text-dim">
          {curNode.move
            ? 'Сыграйте другой ход на доске в этой позиции — создастся вариант (ветвление).'
            : 'Перейдите к любому ходу, чтобы комментировать его и ставить оценки ! ? !! ?? !? ?!'}
        </div>
      </div>
    </section>
  );
}

/* ================= база партий (IndexedDB) ================= */

function DbTab({ game }: { game: GameApi }) {
  const { dbGames, saveToDb, loadFromDb, deleteFromDb, loadPDNText } = game;
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pdnInput, setPdnInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const resultTone = (r: string) =>
    r === '1-0' ? 'text-ink' : r === '0-1' ? 'text-mut' : r === '1-1' ? 'text-[#8ed0ae]' : 'text-dim';

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
          <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">БАЗА ПАРТИЙ · INDEXEDDB</h2>
          <span className="chip">{dbGames.length}</span>
        </header>

        <div className="flex gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название партии…"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-xs text-ink outline-none transition-colors placeholder:text-dim focus:border-acc/60"
          />
          <TBtn accent title="Сохранить в базу" onClick={() => {
            void saveToDb(name).then((ok) => {
              setMsg(ok
                ? { kind: 'ok', text: 'Партия сохранена в базу (ветвления и комментарии — внутри)' }
                : { kind: 'err', text: 'Не удалось сохранить' });
              if (ok) setName('');
            });
          }} className="shrink-0">
            <ISave size={15} /><span className="text-xs font-semibold">Сохранить</span>
          </TBtn>
        </div>

        <div className="mt-2.5 flex max-h-64 flex-col gap-1.5 overflow-y-auto scroll-slim">
          {dbGames.length === 0 && (
            <div className="rounded-lg border border-dashed border-white/12 px-3 py-5 text-center text-xs text-dim">
              Пока пусто. Разберите партию и сохраните её — дерево ходов, варианты,
              комментарии и оценки лягут в базу целиком.
            </div>
          )}
          {dbGames.map((g) => (
            <div key={g.id} className="group flex items-center gap-2.5 rounded-lg border border-white/8 bg-white/[.03] px-3 py-2.5 transition-colors hover:border-white/20 hover:bg-white/[.06]">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => {
                const err = loadFromDb(g);
                setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: `Загружено: ${g.name}` });
              }}>
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-semibold text-body">{g.name}</span>
                  <span className={`font-mono text-[10px] font-bold ${resultTone(g.result)}`}>{g.result}</span>
                  {g.annotated && <span className="chip chip-amber">разбор</span>}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-dim">
                  {g.white} — {g.black} · {g.moves} п/х · {new Date(g.date).toLocaleDateString('ru-RU')}
                </div>
              </button>
              <TBtn title="Удалить из базы" onClick={() => void deleteFromDb(g.id)} className="h-8 w-8 px-0">
                <ITrash size={13} />
              </TBtn>
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-3.5 sm:p-4">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">ИМПОРТ PDN</h2>
          <span className="chip">варианты · комментарии · NAG</span>
        </header>
        <textarea
          value={pdnInput}
          onChange={(e) => setPdnInput(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={'Вставьте PDN (можно несколько партий подряд):\n1.32-28 {комментарий} 19-23 (1... 17-22) 2.28x19 ...'}
          className="w-full resize-y rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 font-mono text-xs leading-relaxed text-ink outline-none transition-colors placeholder:text-dim focus:border-acc/60 scroll-slim"
        />
        <input
          ref={fileRef} type="file" accept=".pdn,.txt,text/plain" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const rd = new FileReader();
            rd.onload = () => {
              const text = String(rd.result ?? '');
              setPdnInput(text);
              const err = loadPDNText(text);
              setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Партия импортирована' });
            };
            rd.readAsText(f);
          }}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <TBtn accent onClick={() => {
            const err = loadPDNText(pdnInput);
            setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Партия импортирована' });
          }}>
            <ILoad size={15} /><span className="text-xs font-semibold">Импортировать</span>
          </TBtn>
          <TBtn onClick={() => fileRef.current?.click()}>
            <IBook size={15} /><span className="text-xs">Файл .pdn</span>
          </TBtn>
          <TBtn onClick={() => {
            setPdnInput(SAMPLE_PDN);
            const err = loadPDNText(SAMPLE_PDN);
            setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Пример с вариантом и комментарием загружен' });
          }}>
            <span className="text-xs">Пример</span>
          </TBtn>
        </div>
      </section>
    </div>
  );
}

/* ================= расстановка позиции ================= */

function SetupTab({ game }: { game: GameApi }) {
  const [board, setBoard] = useState<Int8Array>(() => game.pos.b.slice());
  const [side, setSide] = useState<Side>(game.pos.side);
  const [fenInput, setFenInput] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const curFen = useMemo(() => {
    let W: string[] = []; let B: string[] = [];
    let wRun: number[] = []; let bRun: number[] = [];
    const flushW = () => { if (wRun.length) { W.push(`${wRun[0]}-${wRun[wRun.length - 1]}`); wRun = []; } };
    const flushB = () => { if (bRun.length) { B.push(`${bRun[0]}-${bRun[bRun.length - 1]}`); bRun = []; } };
    for (let n = 1; n <= 50; n++) {
      const v = board[n];
      if (v === 1) { flushW(); wRun.push(n); }
      else if (v === 2) { flushW(); W.push(`K${n}`); }
      else if (v === -1) { flushB(); bRun.push(n); }
      else if (v === -2) { flushB(); B.push(`K${n}`); }
    }
    flushW(); flushB();
    return `${side === WHITE ? 'W' : 'B'}:W${W.join(',')}:B${B.join(',')}`;
  }, [board, side]);

  const cycle = (n: number) => {
    setBoard((b) => {
      const nb = b.slice();
      nb[n] = nb[n] === 0 ? 1 : nb[n] === 1 ? 2 : nb[n] === 2 ? -1 : nb[n] === -1 ? -2 : 0;
      return nb;
    });
  };

  const fromCurrent = () => { setBoard(game.pos.b.slice()); setSide(game.pos.side); setMsg(null); };
  const clear = () => { setBoard(new Int8Array(51)); setMsg(null); };
  const initial = () => {
    const b = new Int8Array(51);
    for (let n = 1; n <= 20; n++) b[n] = -1;
    for (let n = 31; n <= 50; n++) b[n] = 1;
    setBoard(b); setSide(WHITE); setMsg(null);
  };
  const apply = () => {
    game.applySetup({ b: board.slice(), side });
    setMsg({ kind: 'ok', text: 'Расстановка применена — партия начата с этой позиции' });
  };
  const loadFenInto = () => {
    const parts = fenInput.trim().split(':');
    if (parts.length !== 3) { setMsg({ kind: 'err', text: 'FEN должен иметь вид W:W…:B…' }); return; }
    const b = new Int8Array(51);
    const fill = (part: string, sgn: 1 | -1): boolean => {
      const s = part.replace(/^[WB]/i, '');
      if (!s) return true;
      for (const tok of s.split(',')) {
        const t = tok.trim();
        if (!t) continue;
        const king = /^K/i.test(t);
        const nums = t.replace(/^K/i, '').split('-').map(Number);
        if (nums.some((x) => !Number.isInteger(x) || x < 1 || x > 50)) return false;
        const [a, z] = nums.length === 1 ? [nums[0], nums[0]] : nums;
        for (let n = a; n <= z; n++) b[n] = sgn * (king ? 2 : 1);
      }
      return true;
    };
    if (!fill(parts[1], 1) || !fill(parts[2], -1)) { setMsg({ kind: 'err', text: 'Не удалось разобрать FEN' }); return; }
    setBoard(b);
    setSide(parts[0].toUpperCase() === 'B' ? -1 as Side : WHITE);
    setMsg({ kind: 'ok', text: 'FEN загружен в расстановку — нажмите «Применить»' });
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
          <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">РАССТАНОВКА ПОЗИЦИИ</h2>
          <span className="chip">касание — цикл фигур</span>
        </header>

        <div className="mx-auto max-w-[340px]">
          <div className="grid grid-cols-10 overflow-hidden rounded-lg border border-white/12">
            {Array.from({ length: 100 }, (_, i) => {
              const sr = (i / 10) | 0; const sc = i % 10;
              const r = game.flipped ? 9 - sr : sr;
              const c = game.flipped ? 9 - sc : sc;
              const n = sq(r, c);
              const dark = (r + c) % 2 === 1;
              const v = dark ? board[n] : 0;
              return (
                <button
                  key={i} type="button"
                  onClick={() => dark && cycle(n)}
                  className={`relative flex aspect-square items-center justify-center ${dark ? 'sq-dark' : 'sq-light'}`}
                >
                  {dark && showMini(v)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
          <TBtn active={side === WHITE} onClick={() => setSide(WHITE)} className="h-9">
            <span className="h-2.5 w-2.5 rounded-full bg-ink" /><span className="text-[11px]">Ход белых</span>
          </TBtn>
          <TBtn active={side !== WHITE} onClick={() => setSide(-1 as Side)} className="h-9">
            <span className="h-2.5 w-2.5 rounded-full bg-[#15181c] shadow-[0_0_0_1px_rgba(255,255,255,.3)]" /><span className="text-[11px]">Ход чёрных</span>
          </TBtn>
        </div>

        <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
          <TBtn onClick={fromCurrent} className="h-9"><span className="text-[11px]">Из позиции</span></TBtn>
          <TBtn onClick={initial} className="h-9"><span className="text-[11px]">Начальная</span></TBtn>
          <TBtn onClick={clear} className="h-9"><span className="text-[11px]">Очистить</span></TBtn>
          <TBtn accent onClick={apply} className="h-9"><ICheck size={13} /><span className="text-[11px] font-semibold">Применить</span></TBtn>
        </div>
      </section>

      <section className="panel p-3.5 sm:p-4">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">FEN</h2>
          <span className="chip">Liens / PDN-FEN</span>
        </header>
        <div className="flex gap-1.5">
          <input value={curFen} readOnly spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 font-mono text-xs text-body outline-none" />
          <TBtn title="Копировать FEN" onClick={() => {
            void navigator.clipboard.writeText(curFen).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }).catch(() => undefined);
          }} className="shrink-0">
            {copied ? <ICheck size={15} /> : <ICopy size={15} />}
          </TBtn>
        </div>
        <div className="mt-2 flex gap-1.5">
          <input
            value={fenInput}
            onChange={(e) => setFenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadFenInto(); }}
            placeholder="W:W31-50:B1-20"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 font-mono text-xs text-ink outline-none transition-colors placeholder:text-dim focus:border-acc/60"
          />
          <TBtn accent onClick={loadFenInto} className="shrink-0" title="Загрузить FEN в расстановку">
            <ILoad size={15} />
          </TBtn>
          <TBtn title="Сразу применить FEN как позицию" onClick={() => {
            const err = game.loadFenText(fenInput);
            setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Позиция из FEN применена' });
          }} className="shrink-0">
            <ICheck size={15} />
          </TBtn>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-dim">
          <span className="font-mono text-mut">сторона:белые:чёрные</span> · дамки — <span className="font-mono text-mut">K</span> ·
          диапазоны через дефис. Генерация FEN — из расстановки или текущей позиции («Из позиции»).
        </p>
      </section>
    </div>
  );
}

function showMini(v: number): ReactNode {
  if (v === 0) return null;
  const king = Math.abs(v) === 2;
  return (
    <span className={`flex h-[74%] w-[74%] items-center justify-center rounded-full ${
      v > 0
        ? 'bg-[radial-gradient(circle_at_35%_30%,#fdf6e3,#eadbb4_52%,#c4ab7c)] shadow-[inset_0_0_0_2px_rgba(255,255,255,.6),0_2px_4px_rgba(0,0,0,.4)]'
        : 'bg-[radial-gradient(circle_at_35%_28%,#4d545c,#262b31_52%,#0c0e11)] shadow-[inset_0_0_0_2px_rgba(235,255,250,.3),0_2px_4px_rgba(0,0,0,.5)]'
    }`}>
      {king && (
        <svg viewBox="0 0 24 24" className="h-1/2 w-1/2">
          <path d="M4 17h16l1.5-8-4.5 3L12 5l-5 7-4.5-3z" fill="#e8b04b" />
        </svg>
      )}
    </span>
  );
}

/* ================= нейросеть ================= */

function NetTab({ game }: { game: GameApi }) {
  const { nnMeta, training, trainProg, trainOnPDN, clearNet, engineKind, scanAvail } = game;
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const run = async (text: string) => {
    setMsg(null);
    const res = await trainOnPDN(text);
    if (res.ok) {
      setMsg({ kind: 'ok', text: `Обучено: ${res.games} парт., ${res.positions} поз., val-loss ${res.loss?.toFixed(4)}. Сеть активна.` });
    } else {
      setMsg({ kind: 'err', text: res.error ?? 'Ошибка обучения' });
    }
  };

  return (
    <section className="panel flex flex-col p-3.5 sm:p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-[10px] font-bold tracking-[.22em] text-mut">НЕЙРОСЕТЬ · NNUE</h2>
        <span className="chip">{nnMeta ? 'обучена' : 'нет весов'}</span>
      </header>

      <p className="text-[11px] leading-relaxed text-mut">
        Обучите собственную сеть на ваших партиях — как Stockfish учится на позициях.
        Один файл PDN 3.0 может содержать сколько угодно партий; по каждой извлекаются
        позиции с исходом (1-0 / 0-1 / 1-1).
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <span className="chip">200 → 48 → 1 · ReLU/σ</span>
        <span className="chip">Adam · ранняя остановка</span>
        <span className="chip">аугментация rot180</span>
        <span className="chip">val-сплит 90/10</span>
      </div>

      {msg && (
        <div className={`mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
          msg.kind === 'ok' ? 'border-[#5fb287]/40 bg-[#5fb287]/10 text-[#8ed0ae]' : 'border-[#d9534a]/40 bg-[#d9534a]/10 text-[#e5938b]'}`}>
          {msg.kind === 'ok' ? <ICheck size={14} /> : <IWarn size={14} />}
          {msg.text}
        </div>
      )}

      <input
        ref={fileRef} type="file" accept=".pdn,.txt,text/plain" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => void run(String(rd.result ?? ''));
          rd.readAsText(f);
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={training}
        className="mt-3 flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-acc/40 bg-acc/[.06] px-4 py-5 text-center transition-all duration-150 hover:border-acc/80 hover:bg-acc/12 active:scale-[.98] disabled:opacity-40"
      >
        <ILoad size={22} className="text-acc2" />
        <span className="text-xs font-semibold text-acc2">Загрузить файл PDN с партиями</span>
        <span className="text-[10px] text-dim">мульти-партийный PDN 3.0 · .pdn / .txt</span>
      </button>

      {training && trainProg && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-mut">
            <span>эпоха {trainProg.epoch}{trainProg.stopped ? ' · ранняя остановка' : ''}</span>
            <span className="font-mono">train {trainProg.loss.toFixed(4)} · val {trainProg.valLoss.toFixed(4)}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
            <div className="shimmer h-full w-full rounded-full" />
          </div>
        </div>
      )}

      {nnMeta && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          <span className="chip">обучена: {nnMeta.games} парт. / {nnMeta.positions} поз.</span>
          <span className="chip">val-loss {nnMeta.loss.toFixed(3)}</span>
          <span className="chip">{nnMeta.date}</span>
        </div>
      )}

      {nnMeta && !training && (
        <button
          type="button" onClick={clearNet}
          className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-semibold text-mut transition-all duration-150 hover:border-[#d9534a]/50 hover:bg-[#d9534a]/10 hover:text-[#e5938b] active:scale-[.97]"
        >
          <ITrash size={14} />Удалить сеть
        </button>
      )}

      <div className="mt-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-[10px] leading-relaxed text-dim">
        <span className="font-semibold text-mut">Активный движок: </span>
        {engineKind === 'scan'
          ? 'Scan 3.1 (WASM) — сильнейший открытый движок 100-клеточных шашек.'
          : scanAvail
            ? 'встроенный α-β (Scan отключён в настройках).'
            : 'встроенный α-β + PVS/LMR. Scan WASM появится, если положить scan.js/scan.wasm в public/scan/.'}
        <span className="mt-1 block">
          Сеть смешивается с оценкой α-β на корне поиска (вес — в настройках) и хранится локально; работает офлайн.
        </span>
      </div>
    </section>
  );
}

/* ================= приложение ================= */

type Tab = 'analysis' | 'moves' | 'db' | 'setup' | 'net';

const TABS: { id: Tab; label: string; icon: (p: IP) => ReactNode }[] = [
  { id: 'analysis', label: 'Анализ', icon: (p) => <IChipIc {...p} /> },
  { id: 'moves', label: 'Ходы', icon: (p) => <IList {...p} /> },
  { id: 'db', label: 'База', icon: (p) => <IDb {...p} /> },
  { id: 'setup', label: 'Доска', icon: (p) => <IGrid {...p} /> },
  { id: 'net', label: 'Сеть', icon: (p) => <IBolt {...p} /> },
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
  const [s, setS] = useState<Settings>(() => loadSettings());
  const set = (p: Partial<Settings>) => setS((prev) => ({ ...prev, ...p }));
  useEffect(() => { saveSettings(s); }, [s]);

  const game = useGame(s);
  const g = game;

  const [tab, setTab] = useState<Tab>('analysis');
  const [preview, setPreview] = useState<Move | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gameRef = useRef(game);
  gameRef.current = game;

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
  const best = engineReady && s.showArrows ? g.engine.best : null;
  const bestFull = useMemo(
    () => (best ? g.legal.find((m) => m.from === best.from && m.to === best.to) ?? null : null),
    [best, g.legal],
  );

  const handleHover = (c: CandidateLite | null) => {
    if (!c || !s.showArrows) { setPreview(null); return; }
    setPreview(g.legal.find((m) => m.from === c.from && m.to === c.to) ?? null);
  };

  const engineLabel = g.engineKind === 'scan'
    ? 'Scan 3.1 · WASM'
    : g.scanAvail && !s.useScan
      ? 'α-β (Scan выкл.)'
      : 'α-β · PVS+LMR';

  const ply = g.path.length - 1;

  return (
    <div className="min-h-dvh pb-20 min-[880px]:pb-0">
      <header className="relative z-50 border-b border-white/[.07] bg-pan/80 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1120px] items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4">
          <Logo />
          <div className="min-w-0">
            <h1 className="font-display text-[13px] font-black leading-none tracking-[.12em] text-ink sm:text-base">
              СТО<span className="text-acc2">КЛЕТКА</span>
            </h1>
            <p className="mt-0.5 truncate text-[10px] leading-none text-dim">разбор партий · ФМЖД</p>
          </div>
          <div className="ml-auto hidden items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 md:flex">
            <Dot color={g.engine.thinking ? 'var(--accent)' : '#5fb287'} pulse={g.engine.thinking} />
            <span className="font-mono text-[11px] text-mut">
              {engineLabel}
              {g.engine.thinking ? ` · d${g.engine.depth || 1}…` : g.engine.depth ? ` · d${g.engine.depth}` : ''}
              {s.nnEnabled && g.nnMeta ? ' · NN' : ''}
            </span>
          </div>
          <div className="relative ml-auto md:ml-0">
            <TBtn title="Настройки" active={settingsOpen} onClick={() => setSettingsOpen((v) => !v)} className="h-10 w-10 px-0">
              <IGear size={17} />
            </TBtn>
            {settingsOpen && <SettingsPanel s={s} set={set} game={g} onClose={() => setSettingsOpen(false)} />}
          </div>
          <ThemePicker />
        </div>
      </header>

      <main className="mx-auto grid max-w-[1120px] gap-5 px-3 py-4 min-[880px]:grid-cols-[minmax(0,1fr)_400px] min-[880px]:gap-6">
        <div className="min-w-0">
          <div className="relative mx-auto max-w-[560px]">
            <BoardGlow pos={g.pos} />
            <BoardView
              pos={g.pos} legal={g.legal} selected={g.selected} lastMove={g.lastMove}
              best={bestFull} preview={preview} flipped={g.flipped} showNums={g.showNums}
              winner={g.winner} movableFroms={g.movableFroms} onSquare={g.clickSquare}
            />
          </div>

          {ply > 0 && (
            <div className="mx-auto max-w-[560px]">
              <EvalChart start={g.start} pathNodes={g.path} ply={ply} gotoPly={g.gotoPly} />
            </div>
          )}

          <div className="mx-auto mt-4 max-w-[560px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all duration-300 ${
                !g.winner && g.pos.side === WHITE ? 'border-acc/60 bg-acc/12 text-acc2' : 'border-white/10 bg-white/[.03] text-dim'}`}>
                <span className="h-2 w-2 rounded-full bg-ink" />Белые
                <CapturedDots start={g.start} pos={g.pos} color={-1 as Side} />
              </span>
              <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all duration-300 ${
                !g.winner && g.pos.side !== WHITE ? 'border-acc/60 bg-acc/12 text-acc2' : 'border-white/10 bg-white/[.03] text-dim'}`}>
                <span className="h-2 w-2 rounded-full bg-[#15181c] shadow-[0_0_0_1px_rgba(255,255,255,.3)]" />Чёрные
                <CapturedDots start={g.start} pos={g.pos} color={WHITE} />
              </span>
              <span className="ml-auto font-mono text-[10px] text-dim">
                {g.winner !== null ? 'партия окончена' : `ход ${g.pos.side === WHITE ? 'белых' : 'чёрных'}`}
              </span>
            </div>

            {g.mustCapture && g.winner === null && (
              <div className="dest-pulse mt-2 flex items-center gap-1.5 rounded-lg border border-[#d9534a]/50 bg-[#d9534a]/12 px-3 py-1.5 text-[11px] font-bold tracking-wide text-[#e58a82]">
                <IWarn size={13} />ВЗЯТИЕ ОБЯЗАТЕЛЬНО{s.autoCapture ? ' · АВТО' : ''}
              </div>
            )}

            <div className="mt-2.5 flex items-center gap-1.5">
              <TBtn title="В начало" onClick={g.toStart} disabled={ply === 0} className="h-12 flex-1"><IFirst /></TBtn>
              <TBtn title="Назад" onClick={g.prev} disabled={ply === 0} className="h-12 flex-1"><IPrev /></TBtn>
              <TBtn title={g.auto ? 'Пауза' : 'Автопроигрывание'} accent active={g.auto}
                onClick={() => g.setAuto(!g.auto)} disabled={g.curNode.children.length === 0} className="h-12 flex-1">
                {g.auto ? <IPause /> : <IPlay />}
              </TBtn>
              <TBtn title="Вперёд" onClick={g.next} disabled={g.curNode.children.length === 0} className="h-12 flex-1"><INext /></TBtn>
              <TBtn title="В конец" onClick={g.toEnd} disabled={g.curNode.children.length === 0} className="h-12 flex-1"><ILast /></TBtn>
              <span className="mx-0.5 hidden h-7 w-px bg-white/10 sm:block" />
              <TBtn title="Перевернуть доску" onClick={g.toggleFlip} active={g.flipped} className="h-12 w-11 px-0"><IFlip /></TBtn>
              <TBtn title="Номера полей 1–50 на доске" onClick={g.toggleNums} active={g.showNums} className="h-12 w-12 px-0">
                <span className="font-mono text-[11px] font-bold">1–50</span>
              </TBtn>
              <TBtn title="Новая партия" onClick={g.newGame} className="h-12 w-11 px-0"><IPlus /></TBtn>
            </div>
          </div>
        </div>

        {/* правая колонка (desktop) / под доской (mobile) */}
        <div className="flex min-w-0 flex-col gap-3.5">
          <nav className="hidden grid-cols-5 rounded-xl border border-white/10 bg-white/[.03] p-1 min-[880px]:grid">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={`rounded-lg px-1 py-2.5 text-[11px] font-semibold transition-all duration-150 active:scale-[.97] ${
                  tab === t.id
                    ? 'bg-acc/15 text-acc2 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_35%,transparent)]'
                    : 'text-mut hover:bg-white/[.05] hover:text-body'}`}>
                {t.label}
              </button>
            ))}
          </nav>

          <div key={tab} className="reveal flex min-w-0 flex-col gap-3.5">
            {tab === 'analysis' && (
              <AnalysisPanel game={g} s={s} onPlay={(f, t) => g.playFromTo(f, t)} onHover={handleHover} />
            )}
            {tab === 'moves' && <MovesTab game={g} />}
            {tab === 'db' && <DbTab game={g} />}
            {tab === 'setup' && <SetupTab game={g} />}
            {tab === 'net' && <NetTab game={g} />}
          </div>
        </div>
      </main>

      {/* нижняя навигация (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-pan/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md min-[880px]:hidden">
        <div className="mx-auto grid max-w-[560px] grid-cols-5">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`flex flex-col items-center gap-0.5 py-2 transition-colors duration-150 ${
                tab === t.id ? 'text-acc2' : 'text-dim active:text-mut'}`}>
              {t.icon({ size: 19 })}
              <span className="text-[9px] font-semibold tracking-wide">{t.label}</span>
              <span className={`h-0.5 w-6 rounded-full transition-all duration-200 ${tab === t.id ? 'bg-acc' : 'bg-transparent'}`} />
            </button>
          ))}
        </div>
      </nav>

      {g.hint && (
        <div className="toast-in pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex items-center gap-2 rounded-lg border border-acc/50 bg-pan/95 px-4 py-2.5 text-xs font-semibold text-acc2 shadow-[0_10px_30px_rgba(0,0,0,.5)] backdrop-blur-sm min-[880px]:bottom-6">
          <IWarn size={14} />{g.hint}
        </div>
      )}
    </div>
  );
}
