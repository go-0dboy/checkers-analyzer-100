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
  nnEnabled: false,
  nnBlend: 0.35,
  useScan: true,
};

const KEY = 'sk100.settings.v2';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Settings>;
      const out = { ...DEFAULT_SETTINGS };
      for (const key of [
        'showArrows',
        'autoCapture',
        'autoSingle',
        'humanStyle',
        'nnEnabled',
        'useScan',
      ] as const)
        if (typeof d[key] === 'boolean') out[key] = d[key]!;
      for (const [key, min, max] of [
        ['captureDelay', 100, 5000],
        ['engineDepth', 1, 40],
        ['engineTime', 100, 60000],
        ['nnBlend', 0, 0.8],
      ] as const)
        if (Number.isFinite(d[key])) out[key] = Math.min(max, Math.max(min, d[key]!));
      out.engineDepth = Math.floor(out.engineDepth);
      return out;
    }
  } catch {
    /* приватный режим */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}
