/* ============================================================
 * Темы оформления: значения CSS-переменных задаются инлайном
 * на <html data-theme=...>, переключение без перезагрузки.
 * ============================================================ */

export type ThemeId = 'tournament' | 'walnut' | 'malachite' | 'polar';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  desc: string;
  vars: Record<string, string>;
  preview: { dark: string; light: string };
}

export const THEMES: ThemeDef[] = [
  {
    id: 'tournament',
    name: 'Турнир',
    desc: 'нефрит · янтарь',
    preview: { dark: '#1b3e46', light: '#dde4dd' },
    vars: {
      '--accent': '#e6a53c', '--accent-2': '#f2c069',
      '--ink': '#e9efe9', '--body': '#c8d6d2', '--mut': '#8fa3a0', '--dim': '#6d8380',
      '--bg': '#0b1416',
      '--panel-a': 'rgba(20, 34, 38, 0.94)', '--panel-b': 'rgba(13, 24, 27, 0.94)',
      '--panel-border': 'rgba(255, 255, 255, 0.08)',
      '--glow': 'rgba(230, 165, 60, 0.08)', '--glow2': 'rgba(44, 90, 94, 0.3)',
      '--sq-dark-a': '#275259', '--sq-dark-b': '#1b3e46',
      '--sq-light-a': '#e0e7e0', '--sq-light-b': '#cdd7cf',
      '--frame': '#0e1a1d', '--rim-black': 'rgba(235, 255, 250, 0.34)',
    },
  },
  {
    id: 'walnut',
    name: 'Орех',
    desc: 'дерево · медь',
    preview: { dark: '#654123', light: '#ead9b8' },
    vars: {
      '--accent': '#d08348', '--accent-2': '#eda96f',
      '--ink': '#ece5d8', '--body': '#cfc3b2', '--mut': '#a3927e', '--dim': '#7d6f5e',
      '--bg': '#14100c',
      '--panel-a': 'rgba(38, 29, 22, 0.94)', '--panel-b': 'rgba(24, 18, 13, 0.94)',
      '--panel-border': 'rgba(255, 240, 220, 0.08)',
      '--glow': 'rgba(208, 131, 72, 0.09)', '--glow2': 'rgba(94, 64, 40, 0.35)',
      '--sq-dark-a': '#7a5230', '--sq-dark-b': '#654123',
      '--sq-light-a': '#ead9b8', '--sq-light-b': '#dcc79f',
      '--frame': '#1c1410', '--rim-black': 'rgba(255, 240, 220, 0.38)',
    },
  },
  {
    id: 'malachite',
    name: 'Малахит',
    desc: 'зелень · нефрит',
    preview: { dark: '#22573d', light: '#ece4c6' },
    vars: {
      '--accent': '#4fae83', '--accent-2': '#8ed0ae',
      '--ink': '#e7efe8', '--body': '#c6d5ca', '--mut': '#8aa396', '--dim': '#648070',
      '--bg': '#0b1512',
      '--panel-a': 'rgba(18, 34, 28, 0.94)', '--panel-b': 'rgba(11, 22, 18, 0.94)',
      '--panel-border': 'rgba(220, 255, 235, 0.08)',
      '--glow': 'rgba(79, 174, 131, 0.09)', '--glow2': 'rgba(28, 78, 58, 0.38)',
      '--sq-dark-a': '#2f6e50', '--sq-dark-b': '#22573d',
      '--sq-light-a': '#ece4c6', '--sq-light-b': '#ded2ad',
      '--frame': '#0c1b15', '--rim-black': 'rgba(230, 255, 240, 0.36)',
    },
  },
  {
    id: 'polar',
    name: 'Полярная ночь',
    desc: 'сланец · лёд',
    preview: { dark: '#303e4c', light: '#dde3e8' },
    vars: {
      '--accent': '#6fb3cc', '--accent-2': '#a9d4e4',
      '--ink': '#e8edf1', '--body': '#c6d0d9', '--mut': '#8b9aa8', '--dim': '#657482',
      '--bg': '#0d1218',
      '--panel-a': 'rgba(20, 29, 40, 0.94)', '--panel-b': 'rgba(12, 19, 27, 0.94)',
      '--panel-border': 'rgba(220, 240, 255, 0.08)',
      '--glow': 'rgba(111, 179, 204, 0.09)', '--glow2': 'rgba(48, 78, 108, 0.35)',
      '--sq-dark-a': '#41505f', '--sq-dark-b': '#303e4c',
      '--sq-light-a': '#dde3e8', '--sq-light-b': '#c9d2d9',
      '--frame': '#111923', '--rim-black': 'rgba(215, 235, 255, 0.4)',
    },
  },
];

export const THEME_KEY = 'sk100.theme';

export function applyTheme(id: ThemeId): void {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const el = document.documentElement;
  el.setAttribute('data-theme', t.id);
  for (const [k, v] of Object.entries(t.vars)) el.style.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.vars['--bg']);
  try { localStorage.setItem(THEME_KEY, t.id); } catch { /* приватный режим */ }
}

export function initialTheme(): ThemeId {
  try {
    const t = localStorage.getItem(THEME_KEY) as ThemeId | null;
    if (t && THEMES.some((x) => x.id === t)) return t;
  } catch { /* noop */ }
  return 'tournament';
}
