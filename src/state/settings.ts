/* Настройки приложения: стрелки, авто-взятие, авто-ход, движок, нейросеть. */

export interface Settings {
  showArrows: boolean;
  autoCapture: boolean;
  /** задержка перед авто-взятием и темп серии, мс */
  captureDelay: number;
  autoSingle: boolean;
  engineDepth: number;
  /** лимит времени на ход, мс */
  engineTime: number;
  /** «человеческий» стиль: среди равных ходов выбирать типичный */
  humanStyle: boolean;
  /** использовать обученную нейросеть в оценке */
  nnEnabled: boolean;
  /** вес нейросети в смешанной оценке, 0..1 */
  nnBlend: number;
  /** приоритет Scan 3.1 WASM, если бинарник подключён */
  useScan: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  showArrows: true,
  autoCapture: false,
  captureDelay: 700,
  autoSingle: false,
  engineDepth: 9,
  engineTime: 1300,
  humanStyle: false,
  nnEnabled: true,
  nnBlend: 0.35,
  useScan: true,
};

const KEY = 'sk100.settings.v2';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* приватный режим */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* noop */ }
}
