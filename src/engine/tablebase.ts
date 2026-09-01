/* ============================================================
 * База фигур — офлайн-вердикты по составу материала для
 * малофигурных окончаний (точная теория международных шашек).
 * ============================================================ */

export interface TbVerdict {
  /** 1 — выигрыш белых, 0 — ничья, -1 — выигрыш чёрных */
  result: 1 | 0 | -1;
  confidence: 'theory' | 'practice';
  note: string;
}

export interface Material { wM: number; wK: number; bM: number; bK: number; total: number }

export function materialInfo(b: Int8Array): Material {
  let wM = 0; let wK = 0; let bM = 0; let bK = 0;
  for (let n = 1; n <= 50; n++) {
    const v = b[n];
    if (v === 1) wM++;
    else if (v === 2) wK++;
    else if (v === -1) bM++;
    else if (v === -2) bK++;
  }
  return { wM, wK, bM, bK, total: wM + wK + bM + bK };
}

const men = (n: number) => `${n} ${n === 1 ? 'шашка' : n < 5 ? 'шашки' : 'шашек'}`;

export function materialVerdict(m: Material): TbVerdict | null {
  const { wM, wK, bM, bK, total } = m;
  if (total === 0 || total > 9) return null;

  if (wM === 0 && bM === 0) {
    if (wK >= 3 && bK === 1) return { result: 1, confidence: 'theory', note: '3+ дамки против одной — выигрыш' };
    if (bK >= 3 && wK === 1) return { result: -1, confidence: 'theory', note: '3+ дамки против одной — выигрыш' };
    if (wK <= 2 && bK <= 2) return { result: 0, confidence: 'theory', note: 'дамки не ловятся — теоретическая ничья' };
    if (wK === bK) return { result: 0, confidence: 'theory', note: 'поровну дамок — теоретическая ничья' };
    return null;
  }

  if (bM === 0 && wM > 0) {
    if (wM >= 2 && bK <= 1) return { result: 1, confidence: 'theory', note: `${men(wM)} против одинокой дамки — выигрыш` };
    if (wM === 1 && bK >= 1) return { result: 0, confidence: 'theory', note: 'одна шашка дамку не обыгрывает — ничья' };
  }
  if (wM === 0 && bM > 0) {
    if (bM >= 2 && wK <= 1) return { result: -1, confidence: 'theory', note: `${men(bM)} против одинокой дамки — выигрыш` };
    if (bM === 1 && wK >= 1) return { result: 0, confidence: 'theory', note: 'одна шашка дамку не обыгрывает — ничья' };
  }

  const d = wM - bM;
  if (Math.abs(d) >= 2) {
    return {
      result: d > 0 ? 1 : -1,
      confidence: 'practice',
      note: `материальный перевес ${Math.abs(d)} ${Math.abs(d) === 1 ? 'шашка' : 'шашки'} — практически решено`,
    };
  }
  return null;
}
