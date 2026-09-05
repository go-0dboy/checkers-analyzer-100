/* ============================================================
 * Темы оформления. Каждая тема — набор CSS-переменных, которые
 * вешаются инлайном на <html>. «Турнир» = дефолт из :root.
 * ============================================================ */

export type ThemeId = 'tournament' | 'walnut' | 'malachite' | 'polar';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  desc: string;
  preview: { light: string; dark: string; accent: string };
  vars: Record<string, string>;
}

const WALNUT: Record<string, string> = {
  '--accent': '#d08348', '--accent-2': '#eda96f',
  '--ink': '#ece5d8', '--body': '#cfc3b2', '--mut': '#a3927e', '--dim': '#7d6f5e',
  '--bg': '#14100c',
  '--panel-a': 'rgba(38,29,22,0.94)', '--panel-b': 'rgba(24,18,13,0.94)',
  '--panel-border': 'rgba(255,240,220,0.08)',
  '--glow': 'rgba(208,131,72,0.09)', '--glow2': 'rgba(94,64,40,0.35)',
  '--sq-dark-a': '#7a5230', '--sq-dark-b': '#654123',
  '--sq-light-a': '#ead9b8', '--sq-light-b': '#dcc79f',
  '--frame': '#1c1410', '--rim-black': 'rgba(255,240,220,0.38)',
};

const MALACHITE: Record<string, string> = {
  '--accent': '#4fae83', '--accent-2': '#8ed0ae',
  '--ink': '#e7efe8', '--body': '#c6d5ca', '--mut': '#8aa396', '--dim': '#648070',
  '--bg': '#0b1512',
  '--panel-a': 'rgba(18,34,28,0.94)', '--panel-b': 'rgba(11,22,18,0.94)',
  '--panel-border': 'rgba(220,255,235,0.08)',
  '--glow': 'rgba(79,174,131,0.09)', '--glow2': 'rgba(28,78,58,0.38)',
  '--sq-dark-a': '#2f6e50', '--sq-dark-b': '#22573d',
  '--sq-light-a': '#ece4c6', '--sq-light-b': '#ded2ad',
  '--frame': '#0c1b15', '--rim-black': 'rgba(230,255,240,0.36)',
};

const POLAR: Record<string, string> = {
  '--accent': '#6fb3cc', '--accent-2': '#a9d4e4',
  '--ink': '#e8edf1', '--body': '#c6d0d9', '--mut': '#8b9aa8', '--dim': '#657482',
  '--bg': '#0d1218',
  '--panel-a': 'rgba(20,29,40,0.94)', '--panel-b': 'rgba(12,19,27,0.94)',
  '--panel-border': 'rgba(220,240,255,0.08)',
  '--glow': 'rgba(111,179,204,0.09)', '--glow2': 'rgba(48,78,108,0.35)',
  '--sq-dark-a': '#41505f', '--sq-dark-b': '#303e4c',
  '--sq-light-a': '#dde3e8', '--sq-light-b': '#c9d2d9',
  '--frame': '#111923', '--rim-black': 'rgba(215,235,255,0.4)',
};

export const THEMES: ThemeDef[] = [
  {
    id: 'tournament', name: 'Турнир', desc: 'нефрит и янтарь',
    preview: { light: '#e0e7e0', dark: '#275259', accent: '#e6a53c' },
    vars: {},
  },
  {
    id: 'walnut', name: 'Орех', desc: 'классическое дерево',
    preview: { light: '#ead9b8', dark: '#7a5230', accent: '#d08348' },
    vars: WALNUT,
  },
  {
    id: 'malachite', name: 'Малахит', desc: 'глубокая зелень',
    preview: { light: '#ece4c6', dark: '#2f6e50', accent: '#4fae83' },
    vars: MALACHITE,
  },
  {
    id: 'polar', name: 'Полярная ночь', desc: 'холодный сланец',
    preview: { light: '#dde3e8', dark: '#41505f', accent: '#6fb3cc' },
    vars: POLAR,
  },
];

const ALL_VARS = Object.keys({ ...WALNUT, ...MALACHITE, ...POLAR });
export const THEME_KEY = 'sk100.theme';

export function applyTheme(id: ThemeId): void {
  const el = document.documentElement;
  const def = THEMES.find((t) => t.id === id) ?? THEMES[0];
  for (const v of ALL_VARS) el.style.removeProperty(v);
  for (const [v, val] of Object.entries(def.vars)) el.style.setProperty(v, val);
  try { localStorage.setItem(THEME_KEY, id); } catch { /* noop */ }
}

export function initialTheme(): ThemeId {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t && THEMES.some((x) => x.id === t)) return t as ThemeId;
  } catch { /* noop */ }
  return 'tournament';
}
