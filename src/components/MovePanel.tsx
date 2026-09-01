/* ============================================================
 * MovePanel — навигация по партии (в начало/назад/вперёд/в конец,
 * автопроигрывание), переключатели доски и лента ходов.
 * ============================================================ */

import { useEffect, useRef } from 'react';
import { type Move, moveNotation } from '../engine/core';
import {
  IconFirst, IconPrev, IconNext, IconLast, IconPlay, IconPause,
  IconFlip, IconHash, IconPlus, ToolButton,
} from './ui';

export default function MovePanel({
  moves, ply, goto, auto, setAuto, flipped, showNums,
  onFlip, onNums, onNew,
}: {
  moves: Move[];
  ply: number;
  goto: (ply: number) => void;
  auto: boolean;
  setAuto: (v: boolean) => void;
  flipped: boolean;
  showNums: boolean;
  onFlip: () => void;
  onNums: () => void;
  onNew: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [ply]);

  const rows: { no: number; w?: Move; wPly: number; b?: Move; bPly: number }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      no: i / 2 + 1,
      w: moves[i], wPly: i + 1,
      b: moves[i + 1], bPly: i + 2,
    });
  }

  return (
    <section className="panel flex min-h-0 flex-col p-4">
      {/* управление */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ToolButton title="В начало" onClick={() => goto(0)} disabled={ply === 0}><IconFirst /></ToolButton>
        <ToolButton title="Назад" onClick={() => goto(ply - 1)} disabled={ply === 0}><IconPrev /></ToolButton>
        <ToolButton
          title={auto ? 'Пауза' : 'Автопроигрывание'}
          onClick={() => setAuto(!auto)}
          disabled={moves.length === 0}
          active={auto}
          accent
        >
          {auto ? <IconPause /> : <IconPlay />}
        </ToolButton>
        <ToolButton title="Вперёд" onClick={() => goto(ply + 1)} disabled={ply >= moves.length}><IconNext /></ToolButton>
        <ToolButton title="В конец" onClick={() => goto(moves.length)} disabled={ply >= moves.length}><IconLast /></ToolButton>

        <span className="mx-1 h-6 w-px bg-white/10" />

        <ToolButton title="Перевернуть доску" onClick={onFlip} active={flipped}><IconFlip /></ToolButton>
        <ToolButton title="Нумерация полей 1–50" onClick={onNums} active={showNums}><IconHash /></ToolButton>
        <ToolButton title="Новая партия" onClick={onNew}><IconPlus /></ToolButton>
      </div>

      {/* лента ходов */}
      <div className="mt-3 flex items-baseline justify-between">
        <h2 className="font-display text-[11px] font-bold tracking-[.22em] text-mut">ПАРТИЯ</h2>
        <span className="font-mono text-[11px] text-dim">
          ход {ply} / {moves.length}
        </span>
      </div>

      <div ref={listRef} className="mt-2 min-h-0 max-h-56 flex-1 overflow-y-auto rounded-md border border-white/10 scroll-slim lg:max-h-[320px]">
        <button
          type="button"
          ref={ply === 0 ? activeRef : undefined}
          onClick={() => goto(0)}
          className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[.06] ${ply === 0 ? 'bg-acc/12' : ''}`}
        >
          <span className="w-8 font-mono text-[11px] text-dim">—</span>
          <span className="text-xs text-mut">начальная позиция{ply === 0 ? ' · сейчас' : ''}</span>
        </button>
        {rows.map((row) => (
          <div key={row.no} className="flex items-stretch border-t border-white/[.05]">
            <span className="flex w-9 shrink-0 items-center justify-center font-mono text-[11px] text-dim">
              {row.no}.
            </span>
            <button
              type="button"
              ref={ply === row.wPly ? activeRef : undefined}
              onClick={() => goto(row.wPly)}
              className={`flex-1 px-2 py-1.5 text-left font-mono text-sm transition-colors hover:bg-white/[.07] ${
                ply === row.wPly ? 'bg-acc/15 font-bold text-acc2' : 'text-body'
              }`}
            >
              {row.w ? moveNotation(row.w) : ''}
            </button>
            <button
              type="button"
              ref={ply === row.bPly ? activeRef : undefined}
              onClick={() => row.b && goto(row.bPly)}
              className={`flex-1 px-2 py-1.5 text-left font-mono text-sm transition-colors hover:bg-white/[.07] ${
                ply === row.bPly ? 'bg-acc/15 font-bold text-acc2' : 'text-body'
              } ${row.b ? '' : 'cursor-default opacity-30'}`}
            >
              {row.b ? moveNotation(row.b) : '…'}
            </button>
          </div>
        ))}
        {moves.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-dim">
            Ходов пока нет — делайте ходы на доске или загрузите партию во вкладке «Форматы».
          </div>
        )}
      </div>

      <div className="mt-2 text-[11px] leading-relaxed text-dim">
        Ход с середины партии создаёт новый вариант — хвост отбрасывается.
      </div>
    </section>
  );
}
