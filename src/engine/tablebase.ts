/* ============================================================
 * Приблизительная материальная подсказка; не база окончаний.
 * ============================================================ */

export interface TbVerdict {
  /** 1 — выигрыш белых, 0 — ничья, -1 — выигрыш чёрных */
  result: 1 | 0 | -1;
  confidence: 'practice';
  note: string;
}

export interface Material {
  wM: number;
  wK: number;
  bM: number;
  bK: number;
  total: number;
}

export function materialInfo(b: Int8Array): Material {
  let wM = 0;
  let wK = 0;
  let bM = 0;
  let bK = 0;
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 1) wM++;
    else if (v === 2) wK++;
    else if (v === -1) bM++;
    else if (v === -2) bK++;
  }
  return { wM, wK, bM, bK, total: wM + wK + bM + bK };
}

export function materialVerdict(m: Material): TbVerdict | null {
  if (m.total === 0 || m.total > 9) return null;
  const diff = m.wM + 3.1 * m.wK - m.bM - 3.1 * m.bK;
  if (Math.abs(diff) < 1) return null;
  return {
    result: diff > 0 ? 1 : -1,
    confidence: 'practice',
    note: 'Материальный перевес. Исход зависит от расположения фигур и очереди хода; база окончаний не подключена.',
  };
}
