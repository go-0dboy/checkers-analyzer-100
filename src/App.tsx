/* ============================================================
 * СтоКлетка — анализатор международных шашек (100 клеток, ФМЖД).
 * Веб-MVP мобильного приложения: доска, строгие правила, движок,
 * навигация по партии, FEN/PDN, темы оформления, справка по интеграции.
 * ============================================================ */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useGame, type GameApi } from './state/useGame';
import { type Move, WHITE } from './engine/core';
import BoardView from './components/BoardView';
import AnalysisPanel from './components/AnalysisPanel';
import MovePanel from './components/MovePanel';
import FormatsPanel from './components/FormatsPanel';
import IntegrationDocs from './components/IntegrationDocs';
import ThemePicker from './components/ThemePicker';
import { Dot, IconBook, IconChip, IconFile, IconWarn } from './components/ui';

type Tab = 'analysis' | 'formats' | 'engine';

const TABS: { id: Tab; label: string; icon: (active: boolean) => ReactNode }[] = [
  { id: 'analysis', label: 'Анализ', icon: (a) => <IconChip size={15} className={a ? 'text-acc2' : ''} /> },
  { id: 'formats', label: 'Форматы', icon: (a) => <IconFile size={15} className={a ? 'text-acc2' : ''} /> },
  { id: 'engine', label: 'Движок и интеграция', icon: (a) => <IconBook size={15} className={a ? 'text-acc2' : ''} /> },
];

function LogoMark() {
  return (
    <svg viewBox="0 0 36 36" className="h-9 w-9 shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,.5)]">
      <rect x="1" y="1" width="34" height="34" rx="7" fill="#132a2e" stroke="#2c5a5e" strokeWidth="1.4" />
      <path d="M1 8a7 7 0 017-7h9v17H1z" fill="#d8e0d8" opacity=".9" />
      <path d="M18 18h17v10a7 7 0 01-7 7H18z" fill="#d8e0d8" opacity=".9" />
      <circle cx="18" cy="18" r="8.2" fill="url(#lg)" stroke="#8a5f1d" strokeWidth="1" />
      <path d="M13.6 19.4h8.8l.8-4.4-2.5 1.8L18 13.4l-2.7 3.4-2.5-1.8z" fill="#f6d489" stroke="#8a5f1d" strokeWidth=".7" />
      <defs>
        <radialGradient id="lg" cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#3d434b" />
          <stop offset="60%" stopColor="#20242a" />
          <stop offset="100%" stopColor="#0d0f12" />
        </radialGradient>
      </defs>
    </svg>
  );
}

function StatusRow({ game }: { game: GameApi }) {
  const { pos, mustCapture, winner, ply, moves } = game;
  const activeChip = 'border-acc/60 bg-acc/12 text-acc2 shadow-[0_0_14px_color-mix(in_oklab,var(--accent)_15%,transparent)]';
  const idleChip = 'border-white/10 bg-white/[.03] text-dim';
  return (
    <div className="mt-7 flex flex-wrap items-center gap-2 sm:mt-8">
      <span
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-300 ${
          !winner && pos.side === WHITE ? activeChip : idleChip
        }`}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-ink shadow-[inset_0_-1px_2px_rgba(0,0,0,.35)]" />
        Белые
      </span>
      <span
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-300 ${
          !winner && pos.side !== WHITE ? activeChip : idleChip
        }`}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-[#15181c] shadow-[inset_0_1px_2px_rgba(255,255,255,.25),0_0_0_1px_rgba(255,255,255,.15)]" />
        Чёрные
      </span>
      <span className="font-mono text-[11px] text-dim">
        {winner !== null ? 'партия окончена' : `ход ${pos.side === WHITE ? 'белых' : 'чёрных'}`}
        {' · '}полуход {ply}/{moves.length}
      </span>
      {mustCapture && winner === null && (
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-[#d9534a]/50 bg-[#d9534a]/12 px-3 py-1.5 text-[11px] font-bold tracking-wide text-[#e58a82] dest-pulse">
          <IconWarn size={13} />
          ВЗЯТИЕ ОБЯЗАТЕЛЬНО
        </span>
      )}
    </div>
  );
}

export default function App() {
  const game = useGame();
  const [tab, setTab] = useState<Tab>('analysis');
  const [preview, setPreview] = useState<Move | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;

  /* клавиатурная навигация по партии */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const g = gameRef.current;
      if (e.key === 'ArrowLeft') { e.preventDefault(); g.prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); g.next(); }
      else if (e.key === 'Home') { e.preventDefault(); g.toStart(); }
      else if (e.key === 'End') { e.preventDefault(); g.toEnd(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const engineReady = game.engine.forKey === game.boardKey;
  const best = engineReady ? game.engine.best : null;

  return (
    <div className="min-h-dvh">
      {/* ======= шапка ======= */}
      <header className="border-b border-white/[.07] bg-pan/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1220px] items-center gap-3 px-4 py-3 sm:gap-4">
          <LogoMark />
          <div className="min-w-0">
            <h1 className="font-display text-base font-black leading-none tracking-[.14em] text-ink sm:text-lg">
              СТО<span className="text-acc2">КЛЕТКА</span>
            </h1>
            <p className="mt-1 truncate text-[11px] leading-none text-dim">
              международные шашки · 100 клеток · правила ФМЖД
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 md:flex">
              <Dot color={game.engine.thinking ? 'var(--accent)' : '#5fb287'} pulse={game.engine.thinking} />
              <span className="font-mono text-[11px] text-mut">
                СтоКлетка Engine 0.1 · α-β
                {game.engine.thinking ? ` · d${game.engine.depth || 1}…` : game.engine.depth ? ` · d${game.engine.depth}` : ''}
              </span>
            </div>
            <ThemePicker />
          </div>
        </div>
      </header>

      {/* ======= основная область ======= */}
      <main className="mx-auto grid max-w-[1220px] gap-6 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:py-7 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <div className="mx-auto max-w-[620px] pl-5 pr-0 sm:pl-6">
            <BoardView
              pos={game.pos}
              legal={game.legal}
              selected={game.selected}
              lastMove={game.lastMove}
              best={best}
              preview={preview}
              flipped={game.flipped}
              showNums={game.showNums}
              winner={game.winner}
              movableFroms={game.movableFroms}
              onSquare={game.clickSquare}
            />
          </div>
          <div className="mx-auto max-w-[620px] pl-5 sm:pl-6">
            <StatusRow game={game} />
            <p className="mt-3 text-[11px] leading-relaxed text-dim">
              Клик по своей шашке — выбор, по подсвеченному полю — ход. Красные метки «×» — поля, которые будут побиты
              в выбранном взятии. Стрелка на доске — лучший ход по версии движка.
            </p>
          </div>
        </div>

        {/* правая колонка */}
        <div className="flex min-w-0 flex-col gap-4">
          <nav className="flex rounded-lg border border-white/10 bg-white/[.03] p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition-all duration-150 ${
                  tab === t.id
                    ? 'bg-acc/15 text-acc2 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_35%,transparent),0_2px_10px_rgba(0,0,0,.3)]'
                    : 'text-mut hover:bg-white/[.05] hover:text-body'
                }`}
              >
                {t.icon(tab === t.id)}
                <span className="hidden min-[420px]:inline">{t.label}</span>
              </button>
            ))}
          </nav>

          {tab === 'analysis' && (
            <>
              <AnalysisPanel
                engine={game.engine}
                boardKey={game.boardKey}
                side={game.pos.side}
                b={game.pos.b}
                onPlay={(m) => game.playFromTo(m.from, m.to)}
                onHover={setPreview}
              />
              <MovePanel
                moves={game.moves}
                ply={game.ply}
                goto={game.goto}
                auto={game.auto}
                setAuto={game.setAuto}
                flipped={game.flipped}
                showNums={game.showNums}
                onFlip={game.toggleFlip}
                onNums={game.toggleNums}
                onNew={game.newGame}
              />
            </>
          )}
          {tab === 'formats' && (
            <FormatsPanel
              fen={game.fen}
              moves={game.moves}
              headers={game.headers}
              onLoadFen={game.loadFenText}
              onLoadPDN={game.loadPDNText}
            />
          )}
          {tab === 'engine' && <IntegrationDocs />}
        </div>
      </main>

      {/* ======= футер ======= */}
      <footer className="border-t border-white/[.06] py-4">
        <div className="mx-auto flex max-w-[1220px] flex-wrap items-center gap-x-4 gap-y-1 px-4 text-[11px] text-dim">
          <span className="font-display font-bold tracking-[.14em]">СТОКЛЕТКА · MVP</span>
          <span>летающие дамки</span>
          <span>обязательное взятие большинства</span>
          <span>дамка только при остановке на последней горизонтали</span>
          <span className="ml-auto font-mono">FEN · PDN · встроенный α-β движок, офлайн</span>
        </div>
      </footer>

      {/* тост-подсказка */}
      {game.hint && (
        <div className="toast-in pointer-events-none fixed bottom-6 left-1/2 z-50 flex items-center gap-2 rounded-md border border-acc/50 bg-pan/95 px-4 py-2.5 text-xs font-semibold text-acc2 shadow-[0_10px_30px_rgba(0,0,0,.5)] backdrop-blur-sm">
          <IconWarn size={14} />
          {game.hint}
        </div>
      )}
    </div>
  );
}
