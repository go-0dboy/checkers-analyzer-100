/* Настройки приложения: стрелки, авто-взятие, авто-ход, движок. */

export interface Settings {
  showArrows: boolean;
  autoCapture: boolean;
  /** задержка перед авто-взятием и темп серии, мс */
  captureDelay: number;
  autoSingle: boolean;
  engineDepth: number;
  /** лимит времени на ход, мс */
  engineTime: number;
}

export const DEFAULT_SETTINGS: Settings = {
  showArrows: true,
  autoCapture: false,
  captureDelay: 700,
  autoSingle: false,
  engineDepth: 11,
  engineTime: 1500,
};

const KEY = 'sk100.settings.v1';

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
