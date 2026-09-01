/* ============================================================
 * ThemePicker — выбор темы оформления (доска + акценты приложения).
 * Выбор сохраняется в localStorage и применяется до первой отрисовки
 * инлайн-скриптом в index.html.
 * ============================================================ */

import { useEffect, useRef, useState } from 'react';
import { THEMES, THEME_KEY, DEFAULT_THEME, type ThemeDef } from '../themes';
import { IconCheck } from './ui';

function MiniBoard({ t }: { t: ThemeDef }) {
  return (
    <div className="grid h-11 w-11 shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-[5px] border border-white/15 shadow-[0_2px_6px_rgba(0,0,0,.35)]">
      <div className="relative" style={{ background: t.swatch.dark }}>
        {/* чёрная шашка с кантом — демонстрация контраста */}
        <span
          className="absolute inset-0 m-auto h-4 w-4 rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #4d545c, #0c0e11 75%)',
            boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,.4), 0 1px 2px rgba(0,0,0,.5)',
          }}
        />
      </div>
      <div className="relative" style={{ background: t.swatch.light }}>
        <span
          className="absolute inset-0 m-auto h-4 w-4 rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 30%, #fdf6e3, #c4ab7c 80%)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.35)',
          }}
        />
      </div>
      <div style={{ background: t.swatch.light }} />
      <div style={{ background: t.swatch.dark }} />
    </div>
  );
}

export default function ThemePicker() {
  const [theme, setTheme] = useState<string>(() => {
    try { return localStorage.getItem(THEME_KEY) || DEFAULT_THEME; } catch { return DEFAULT_THEME; }
  });
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* применяем тему к <html> и сохраняем */
  useEffect(() => {
    const el = document.documentElement;
    if (theme === DEFAULT_THEME) el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* приватный режим */ }
  }, [theme]);

  /* закрытие по клику вне и по Escape */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cur = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Тема оформления"
        aria-expanded={open}
        className={`flex h-10 items-center gap-2.5 rounded-md border px-2.5 transition-all duration-150 active:scale-[.96] ${
          open
            ? 'border-acc/70 bg-acc/15 text-acc2'
            : 'border-white/10 bg-white/[.04] text-body hover:border-white/20 hover:bg-white/[.09]'
        }`}
      >
        <span className="relative block h-5 w-5 overflow-hidden rounded-[4px] border border-white/20">
          <span className="absolute left-0 top-0 h-2.5 w-2.5" style={{ background: cur.swatch.dark }} />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5" style={{ background: cur.swatch.dark }} />
          <span className="absolute right-0 top-0 h-2.5 w-2.5" style={{ background: cur.swatch.light }} />
          <span className="absolute bottom-0 left-0 h-2.5 w-2.5" style={{ background: cur.swatch.light }} />
        </span>
        <span className="hidden text-xs font-semibold sm:inline">{cur.name}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="pop-in absolute right-0 top-[calc(100%+8px)] z-50 w-[290px] rounded-lg border border-white/12 bg-pan/95 p-3 shadow-[0_18px_50px_rgba(0,0,0,.55)] backdrop-blur-md sm:w-[320px]">
          <div className="mb-2.5 flex items-baseline justify-between">
            <h3 className="font-display text-[11px] font-bold tracking-[.22em] text-mut">ТЕМА ОФОРМЛЕНИЯ</h3>
            <span className="font-mono text-[10px] text-dim">{THEMES.length} темы</span>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {THEMES.map((t) => {
              const active = t.id === theme;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setTheme(t.id); setOpen(false); }}
                  className={`theme-card group flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-all duration-150 active:scale-[.98] ${
                    active
                      ? 'border-acc/60 bg-acc/12 shadow-[0_0_16px_color-mix(in_oklab,var(--accent)_15%,transparent)]'
                      : 'border-white/10 bg-white/[.03] hover:border-white/22 hover:bg-white/[.07]'
                  }`}
                >
                  <MiniBoard t={t} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-bold ${active ? 'text-acc2' : 'text-ink'}`}>{t.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-mut">{t.desc}</span>
                  </span>
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/25"
                    style={{ background: t.swatch.accent, boxShadow: `0 0 8px ${t.swatch.accent}66` }}
                  />
                  {active && <IconCheck size={15} className="shrink-0 text-acc2" />}
                </button>
              );
            })}
          </div>

          <p className="mt-2.5 text-[10px] leading-relaxed text-dim">
            Чёрные шашки обведены светлым кантом — различимы на тёмной клетке в любой теме.
          </p>
        </div>
      )}
    </div>
  );
}
