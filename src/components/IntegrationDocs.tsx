/* ============================================================
 * IntegrationDocs — справочник: какие open-source движки есть для
 * 100-клеточных шашек и как интегрировать их в мобильное приложение.
 * ============================================================ */

import { IconChip } from './ui';

const ENGINES = [
  {
    name: 'Scan',
    author: 'Фабьен Летурне (Fabien Letouzey)',
    license: 'GPL-3.0',
    lang: 'C++',
    strength: 'топ среди открытых',
    note: 'Основа клиентского анализа на Lidraughts; есть проверенная сборка в WASM. Поддерживает 100-клеточную игру, эндшпильные базы Liens. Лучший выбор для «сильного» анализа.',
    pick: true,
  },
  {
    name: 'KingsRow 10×10',
    author: 'Эд Гилберт (Ed Gilbert)',
    license: 'бесплатен, код закрыт',
    lang: 'C',
    strength: 'элитный уровень',
    note: 'Один из сильнейших движков мира для 100 клеток; работает под GUI CheckerBoard, поддерживающим протокол DXP. Для открытого продукта не подходит по лицензии, но удобен как внешний эталон силы.',
    pick: false,
  },
  {
    name: 'Maximus',
    author: 'Ян-Яапп ван Хорссен',
    license: 'открытый',
    lang: 'Pascal / C',
    strength: 'чемпион олимпиад 2012–13',
    note: 'Исторически сильнейшая открытая программа; код можно изучать как учебник по оценке и поиску в стоклеточных шашках.',
    pick: false,
  },
  {
    name: 'Liens (базы)',
    author: 'открытый проект эндшпильных баз',
    license: 'бесплатно, web-API',
    lang: 'эндшпильные базы 2–7',
    strength: 'точное знание эндшпиля',
    note: 'Таблицы Лиенса дают безошибочную игру в окончаниях до 7 шашек. Lidraughts отдаёт их по HTTP API — идеально для облачной части анализа.',
    pick: false,
  },
];

const STEPS = [
  {
    title: '1 · Офлайн-ядро (уже в этом MVP)',
    text: 'Встроенный TypeScript-движок: строгая генерация ходов по ФМЖД + альфа-бета с итеративным углублением и хеш-таблицей. Работает без сети, даёт оценку, лучший ход и варианты. Достаточно для MVP и разбора любительских партий.',
  },
  {
    title: '2 · Scan в Web Worker (WASM)',
    text: 'Собрать Scan через Emscripten (готовый рецепт — репозиторий lidraughts/scan.js), запускать в Web Worker, гонять позиции через postMessage({ fen, depth }). Веб-версия получает мастерский уровень анализа, интерфейс не блокируется.',
  },
  {
    title: '3 · Нативные iOS / Android',
    text: 'React Native / Capacitor оборачивают этот же интерфейс. Движок подключается нативным модулем: на Android — JNI или процесс со stdin/stdout-пайпом (как в шахматных обёртках Stockfish), на iOS — бинарь в бандле + NSPipe. Протокол обмена — тот же текстовый интерфейс Scan.',
  },
  {
    title: '4 · Облако и эндшпильные базы',
    text: 'Серверный Scan с многопоточностью и Liens API (lidraughts.org/tablebase) для глубокого мульти-вариантного анализа и точных окончаний; кэш разборов на сервере экономит батарею телефона.',
  },
  {
    title: '5 · Форматы и протоколы',
    text: 'Хранение — PDN (+ FEN внутри заголовка для нестандартных позиций). Для спарринга программ — протокол DXP (его понимают KingsRow и CheckerBoard). TREC — легаси турнирных записей, на входе конвертируется в PDN.',
  },
];

export default function IntegrationDocs() {
  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-4">
        <header className="mb-3 flex items-center gap-2">
          <IconChip size={16} className="text-[#e6a53c]" />
          <h2 className="font-display text-[11px] font-bold tracking-[.22em] text-[#8fa3a0]">
            OPEN-SOURCE ДВИЖКИ ДЛЯ 100 КЛЕТОК
          </h2>
        </header>
        <div className="flex flex-col gap-2.5">
          {ENGINES.map((e) => (
            <article
              key={e.name}
              className={`rounded-md border p-3 transition-colors ${
                e.pick
                  ? 'border-[#e6a53c]/45 bg-[#e6a53c]/[.07] hover:bg-[#e6a53c]/[.11]'
                  : 'border-white/10 bg-white/[.025] hover:bg-white/[.05]'
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-display text-sm font-bold text-[#e9efe9]">{e.name}</h3>
                {e.pick && (
                  <span className="rounded bg-[#e6a53c]/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[#f0bc62]">
                    РЕКОМЕНДОВАН
                  </span>
                )}
                <span className="ml-auto font-mono text-[10px] text-[#6d8380]">{e.lang}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#8fa3a0]">
                <span>{e.author}</span>
                <span className="text-[#6d8380]">·</span>
                <span className="text-[#a9c4b4]">{e.license}</span>
                <span className="text-[#6d8380]">·</span>
                <span>{e.strength}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[#a9bdb8]">{e.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="mb-3 font-display text-[11px] font-bold tracking-[.22em] text-[#8fa3a0]">
          СХЕМА ИНТЕГРАЦИИ В МОБИЛЬНОЕ ПРИЛОЖЕНИЕ
        </h2>
        {/* мини-диаграмма */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-black/25 p-3">
          {['UI · React (этот MVP)', 'Worker / нативный мост', 'Scan WASM / бинарь', 'Liens 2–7 · API'].map((box, i, arr) => (
            <div key={box} className="flex items-center gap-2">
              <div className={`rounded border px-2.5 py-1.5 font-mono text-[10px] sm:text-[11px] ${
                i === 0 ? 'border-[#e6a53c]/50 bg-[#e6a53c]/10 text-[#f0bc62]' :
                i === arr.length - 1 ? 'border-[#5fb287]/40 bg-[#5fb287]/10 text-[#8ed0ae]' :
                'border-white/15 bg-white/[.05] text-[#c8d6d2]'
              }`}>
                {box}
              </div>
              {i < arr.length - 1 && (
                <svg width="18" height="10" viewBox="0 0 18 10" className="text-[#6d8380]">
                  <path d="M0 5h14m0 0l-4-4m4 4l-4 4" stroke="currentColor" strokeWidth="1.4" fill="none" />
                </svg>
              )}
            </div>
          ))}
        </div>

        <ol className="mt-3 flex flex-col gap-2.5">
          {STEPS.map((s) => (
            <li key={s.title} className="rounded-md border border-white/8 bg-white/[.025] p-3 transition-colors hover:bg-white/[.05]">
              <h3 className="text-xs font-bold text-[#e9efe9]">{s.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-[#a9bdb8]">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel p-4">
        <h2 className="mb-2 font-display text-[11px] font-bold tracking-[.22em] text-[#8fa3a0]">
          ПАМЯТКА ПО ПРАВИЛАМ ФМЖД В ЯДРЕ
        </h2>
        <ul className="grid gap-1.5 text-xs leading-relaxed text-[#a9bdb8] sm:grid-cols-2">
          <li className="rounded border border-white/8 bg-black/20 px-3 py-2">Взятие обязательно — вперёд и назад, простой бьёт и дамкой пренебрегать нельзя.</li>
          <li className="rounded border border-white/8 bg-black/20 px-3 py-2">Правило большинства: обязателен вариант с максимальным числом побитых шашек.</li>
          <li className="rounded border border-white/8 bg-black/20 px-3 py-2">Летающая дамка ходит и бьёт на любое расстояние по диагонали.</li>
          <li className="rounded border border-white/8 bg-black/20 px-3 py-2">Превращение в дамку — только если ход завершается на последней горизонтали (проходом — нет).</li>
          <li className="rounded border border-white/8 bg-black/20 px-3 py-2">Побитые шашки остаются на доске до конца серии взятий и блокируют траектории.</li>
          <li className="rounded border border-white/8 bg-black/20 px-3 py-2">Нет ходов — поражение; контроль времени и «25 ходов дамок» — на стороне турнирного слоя.</li>
        </ul>
      </section>
    </div>
  );
}
