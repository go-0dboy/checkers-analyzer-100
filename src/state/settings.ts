/* ============================================================
 * Настройки приложения: стрелки, авто-взятие, авто-ход,
 * параметры движка. Хранятся в localStorage.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';

export interface Settings {
  /** показывать стрелку лучшего хода на доске */
  showArrows: boolean;
  /** автоматически выполнять обязательные взятия */
  autoCapture: boolean;
  /** задержка перед авто-взятием, мс (она же темп анимации) */
  captureDelay: number;
  /** клик по шашке с единственным ходом — сразу ходить */
  autoSingle: boolean;
  /** максимальная глубина расчёта движка */
  engineDepth: number;
  /** лимит времени на ход движка, мс */
  engineTime: number;
}

export const DEFAULTS: Settings = {
  showArrows: true,
  autoCapture: false,
  captureDelay: 800,
  autoSingle: true,
  engineDepth: 9,
  engineTime: 1300,
};

const KEY = 'sk100.settings.v1';

export function useSettings() {
  const [s, setS] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    } catch { /* приватный режим */ }
    return DEFAULTS;
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* noop */ }
  }, [s]);

  const set = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS((p) => ({ ...p, [k]: v }));
  }, []);

  return { s, set };
}
