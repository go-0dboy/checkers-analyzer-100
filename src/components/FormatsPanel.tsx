/* ============================================================
 * FormatsPanel — FEN и PDN: просмотр, копирование, загрузка,
 * скачивание файла партии, пример для быстрой пробы.
 * ============================================================ */

import { useState } from 'react';
import { type Move } from '../engine/core';
import { toPDN, SAMPLE_PDN } from '../engine/pdn';
import { IconBook, IconCopy, IconCheck, IconDown, IconFile, IconLoad, IconWarn, ToolButton } from './ui';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

export default function FormatsPanel({
  fen, moves, headers, onLoadFen, onLoadPDN,
}: {
  fen: string;
  moves: Move[];
  headers: Record<string, string>;
  onLoadFen: (text: string) => string | null;
  onLoadPDN: (text: string) => string | null;
}) {
  const [fenInput, setFenInput] = useState('');
  const [pdnInput, setPdnInput] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const pdnText = toPDN(headers, moves, '*');

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
      setMsg({ kind: 'ok', text: `${what} скопирован в буфер обмена` });
    } catch {
      setMsg({ kind: 'err', text: 'Буфер обмена недоступен — выделите текст вручную' });
    }
  };

  const download = () => {
    const blob = new Blob([pdnText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'partiya.pdn';
    a.click();
    URL.revokeObjectURL(url);
    setMsg({ kind: 'ok', text: 'Файл partiya.pdn сохранён' });
  };

  const doLoadFen = () => {
    const err = onLoadFen(fenInput);
    setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Позиция из FEN загружена' });
  };

  const doLoadPdn = () => {
    const err = onLoadPDN(pdnInput);
    setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Партия из PDN загружена' });
  };

  const loadSample = () => {
    setPdnInput(SAMPLE_PDN);
    const err = onLoadPDN(SAMPLE_PDN);
    setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Пример партии загружен — листайте ходы' });
  };

  return (
    <div className="flex flex-col gap-4">
      {msg && (
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
            msg.kind === 'ok'
              ? 'border-[#5fb287]/40 bg-[#5fb287]/10 text-[#8ed0ae]'
              : 'border-[#d9534a]/40 bg-[#d9534a]/10 text-[#e5938b]'
          }`}
        >
          {msg.kind === 'ok' ? <IconCheck size={14} /> : <IconWarn size={14} />}
          {msg.text}
        </div>
      )}

      {/* FEN */}
      <section className="panel p-4">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-[11px] font-bold tracking-[.22em] text-mut">FEN ПОЗИЦИИ</h2>
          <span className="chip">Liens / PDN-FEN</span>
        </header>
        <div className="flex gap-1.5">
          <input
            value={fen}
            readOnly
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/25 px-3 py-2 font-mono text-xs text-body outline-none"
          />
          <ToolButton title="Копировать FEN" onClick={() => copy(fen, 'FEN')} className="shrink-0">
            {copied === 'FEN' ? <IconCheck size={15} /> : <IconCopy size={15} />}
          </ToolButton>
        </div>
        <div className="mt-3 flex gap-1.5">
          <input
            value={fenInput}
            onChange={(e) => setFenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doLoadFen(); }}
            placeholder="W:W31-50:B1-20  или  B:WK48,44:BK25"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/25 px-3 py-2 font-mono text-xs text-ink placeholder:text-dim outline-none transition-colors focus:border-acc/60"
          />
          <ToolButton title="Загрузить позицию" accent onClick={doLoadFen} className="shrink-0">
            <IconLoad size={15} />
            <span className="hidden text-xs font-semibold sm:inline">Загрузить</span>
          </ToolButton>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          Формат: <span className="font-mono text-mut">сторона:белые:чёрные</span>, дамки с префиксом{' '}
          <span className="font-mono text-mut">K</span>, диапазоны полей через дефис.
        </p>
      </section>

      {/* PDN */}
      <section className="panel p-4">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-[11px] font-bold tracking-[.22em] text-mut">ПАРТИЯ · PDN</h2>
          <span className="chip">{moves.length} полуходов</span>
        </header>
        <textarea
          value={pdnInput}
          onChange={(e) => setPdnInput(e.target.value)}
          rows={7}
          spellCheck={false}
          placeholder={'Вставьте партию в PDN:\n[Event "..."]\n1.32-28 19-23 2.28x19 14x23 ...'}
          className="w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-2 font-mono text-xs leading-relaxed text-ink placeholder-dim outline-none transition-colors focus:border-acc/60 scroll-slim"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <ToolButton accent title="Разобрать PDN из поля" onClick={doLoadPdn}>
            <IconLoad size={15} /><span className="text-xs font-semibold">Загрузить</span>
          </ToolButton>
          <ToolButton title="Пример партии" onClick={loadSample}>
            <IconBook size={15} /><span className="text-xs">Пример</span>
          </ToolButton>
          <span className="mx-0.5 h-6 w-px self-center bg-white/10" />
          <ToolButton title="Текущая партия в буфер" onClick={() => copy(pdnText, 'PDN')}>
            {copied === 'PDN' ? <IconCheck size={15} /> : <IconCopy size={15} />}
            <span className="text-xs">Копировать</span>
          </ToolButton>
          <ToolButton title="Скачать partiya.pdn" onClick={download}>
            <IconDown size={15} /><span className="text-xs">.pdn</span>
          </ToolButton>
        </div>
        <details className="group mt-3 rounded-md border border-white/8 bg-black/20 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-semibold text-mut transition-colors hover:text-body">
            <IconFile size={13} />
            Текущая партия в PDN
            <span className="ml-auto text-dim transition-transform group-open:rotate-180">▾</span>
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-mut">{pdnText}</pre>
        </details>
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          Поддерживаются заголовки <span className="font-mono text-mut">[Tag "…"]</span>, ходы{' '}
          <span className="font-mono text-mut">32-28 / 28x19</span>, результат 1-0 · 0-1 · 1-1 · *.
          Устаревший TREC перед загрузкой конвертируйте в PDN (например, в Dam2).
        </p>
      </section>
    </div>
  );
}
