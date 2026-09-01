/* ============================================================
 * Дебютная книга: мгновенный ответ по теории из стартовой
 * позиции. Ходы — коды from*100+to. Ответ применяется только
 * после проверки легальности (см. impl.ts).
 * ============================================================ */

export interface BookHit { name: string; from: number; to: number }

interface Entry { name: string; seq: number[]; next: number }

const decode = (code: number) => ({ from: Math.floor(code / 100), to: code % 100 });

const ENTRIES: Entry[] = [
  { name: 'Классическое начало', seq: [3228, 1923, 2819, 1423], next: 3732 },
  { name: 'Старая партия', seq: [3228, 1823, 2819, 1423], next: 3732 },
  { name: 'Городская партия', seq: [3228, 2025, 3832, 1520], next: 3127 },
  { name: 'Отказанный косяк', seq: [3329, 1722, 3933, 1117], next: 4439 },
  { name: 'Ленинградская защита', seq: [3430, 2025, 4034, 1420], next: 3329 },
  { name: 'Обратный косяк', seq: [3430, 1823, 4034, 1218], next: 4440 },
];

const MAP = new Map<string, { name: string; next: number }>();
for (const e of ENTRIES) MAP.set(e.seq.join(','), { name: e.name, next: e.next });

/** history — коды ходов партии от начальной позиции. */
export function bookLookup(history: number[]): BookHit | null {
  const hit = MAP.get(history.join(','));
  return hit ? { name: hit.name, ...decode(hit.next) } : null;
}
