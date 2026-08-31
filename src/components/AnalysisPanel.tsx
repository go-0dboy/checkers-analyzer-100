/* ============================================================
 * AnalysisPanel — показания движка: оценка, глубина, лучший ход,
 * список вариантов-кандидатов с превью стрелки и главной линией.
 * ============================================================ */

import { type EngineState } from '../state/useGame';
import { type Move, type Side, moveNotation, WHITE, tempi } from '../engine/core';
import { Dot } from './ui';

export default function AnalysisPanel({
  engine, boardKey, side, b, onPlay, onHover,
}: {
  engine: EngineState;
  boardKey: string;
  side: Side;
  b: Int8Array;
  onPlay: (m: Move) => void;
  onHover: (m: Move | null) => void;
}) {
  const stale = engine.forKey !== boardKey;
  const thinking = engine.thinking || stale;

  // переводим оценку в «белые очки»
  const whiteScore = engine.score !== null ? engine.score * side : null;
  const t = tempi(b);

  const scoreText = (() => {
    if (whiteScore === null) return '—';
    if (engine.mate) return whiteScore > 0 ? 'мат · белые' : 'мат · чёрные';
    const v = whiteScore / 100;
    return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
  })();

  const verdict = (() => {
    if (whiteScore === null) return 'расчёт позиции…';
    if (engine.mate) return 'форсированный выигрыш найден';
    const a = Math.abs(whiteScore);
    if (a < 15) return 'равная позиция';
    if (a < 60) return 'небольшой перевес';
    if (a < 160) return 'заметный перевес';
    return 'решающий перевес';
  })();

  const materialChip = whiteScore !== null && !engine.mate && Math.abs(whiteScore) >= 100
    ? `${whiteScore > 0 ? '+' : '−'}${Math.floor(Math.abs(whiteScore) / 100)} шаш.`
    : null;

  return (
    <section className="panel p-4" onMouseLeave={() => onHover(null)}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-[11px] font-bold tracking-[.22em] text-[#8fa3a0]">АНАЛИЗ ДВИЖКА</h2>
        <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-[11px] text-[#a9bdb8]">
          <Dot color={thinking ? '#e6a53c' : '#5fb287'} pulse={thinking} />
          {thinking ? `расчёт · глубина ${engine.depth || '…'}` : `готово · глубина ${engine.depth}`}
        </span>
      </header>

      <div className="flex items-end justify-between gap-3">
        <div>
          <div
            className={`font-mono text-4xl font-bold leading-none tabular-nums sm:text-[2.6rem] ${
              whiteScore === null ? 'text-[#6d8380]' : whiteScore > 10 ? 'text-[#e9efe9]' : whiteScore < -10 ? 'text-[#9fb3ae]' : 'text-[#c8d6d2]'
            } ${thinking ? 'score-thinking' : ''}`}
          >
            {scoreText}
          </div>
          <div className="mt-1.5 text-xs text-[#8fa3a0]">
            {verdict}{whiteScore !== null && !engine.mate ? ` · ${whiteScore >= 0 ? 'за белых' : 'за чёрных'}` : ''}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="chip">{engine.nodes ? `${(engine.nodes / 1000).toFixed(0)}k узлов` : '— узлов'}</span>
          <span className="chip">темпы {t > 0 ? `+${t}` : t} · белые</span>
          {materialChip && <span className="chip chip-amber">{materialChip}</span>}
        </div>
      </div>

      {/* лучший ход */}
      {engine.best && !stale ? (
        <button
          type="button"
          onClick={() => onPlay(engine.best!)}
          className="group mt-4 flex w-full items-center justify-between rounded-md border border-[#e6a53c]/40 bg-[#e6a53c]/10 px-4 py-3 text-left transition-all duration-150 hover:border-[#e6a53c]/80 hover:bg-[#e6a53c]/18 active:scale-[.98]"
        >
          <span>
            <span className="block text-[10px] font-semibold uppercase tracking-[.18em] text-[#c9963f]">Лучший ход</span>
            <span className="font-mono text-2xl font-bold text-[#f2c069]">{moveNotation(engine.best)}</span>
          </span>
          <span className="rounded border border-[#e6a53c]/50 px-2.5 py-1.5 text-xs font-semibold text-[#f0bc62] transition-colors group-hover:bg-[#e6a53c]/20">
            сыграть →
          </span>
        </button>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-md border border-white/8 bg-white/[.03] px-4 py-3">
          <span className="spinner" />
          <span className="text-xs text-[#8fa3a0]">{stale ? 'позиция изменилась — пересчёт…' : 'движок считает лучший ход…'}</span>
        </div>
      )}

      {/* кандидаты */}
      {engine.candidates.length > 0 && !stale && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.18em] text-[#6d8380]">
            Кандидаты — наведение показывает стрелку
          </div>
          <ul className="divide-y divide-white/[.06] overflow-hidden rounded-md border border-white/10">
            {engine.candidates.map((c, i) => {
              const s = (c.score * side) / 100;
              return (
                <li key={`${c.move.from}-${c.move.to}-${i}`}>
                  <button
                    type="button"
                    onMouseEnter={() => onHover(c.move)}
                    onFocus={() => onHover(c.move)}
                    onClick={() => onPlay(c.move)}
                    className="flex w-full items-center gap-3 bg-white/[.02] px-3 py-2 text-left transition-colors hover:bg-[#e6a53c]/10"
                  >
                    <span className="w-4 font-mono text-[11px] text-[#6d8380]">{i + 1}</span>
                    <span className="font-mono text-base font-semibold text-[#e9efe9]">{moveNotation(c.move)}</span>
                    {c.move.captures.length > 0 && (
                      <span className="rounded bg-[#d9534a]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#e58a82]">
                        ×{c.move.captures.length}
                      </span>
                    )}
                    <span className={`ml-auto font-mono text-xs tabular-nums ${s >= 0 ? 'text-[#a9c4b4]' : 'text-[#c9a0a0]'}`}>
                      {s > 0 ? '+' : ''}{s.toFixed(2)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* главная линия */}
      {engine.pv.length > 1 && !stale && (
        <div className="mt-3 rounded-md border border-white/8 bg-black/20 px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.18em] text-[#6d8380]">Главная линия</div>
          <div className="font-mono text-xs leading-relaxed text-[#a9bdb8]">
            {engine.pv.map((m, i) => (
              <span key={i}>
                <span className="text-[#6d8380]">{Math.floor(i / 2) + 1}{i % 2 === 0 ? '.' : '…'}</span>{' '}
                <span className={i === 0 ? 'text-[#f2c069]' : ''}>{moveNotation(m)}</span>{' '}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
