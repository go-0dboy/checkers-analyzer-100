/* Реестр тем оформления. Сами переменные живут в index.css
 * (блоки [data-theme=...]); здесь — метаданные для переключателя. */

export const THEME_KEY = 'sk100.theme';
export const DEFAULT_THEME = 'tournament';

export interface ThemeDef {
  id: string;
  name: string;
  desc: string;
  swatch: { dark: string; light: string; accent: string };
}

export const THEMES: ThemeDef[] = [
  {
    id: 'tournament',
    name: 'Турнир',
    desc: 'Нефритовая доска, янтарный акцент',
    swatch: { dark: '#1f464e', light: '#dde5de', accent: '#e6a53c' },
  },
  {
    id: 'walnut',
    name: 'Орех',
    desc: 'Классическое дерево, медный акцент',
    swatch: { dark: '#6d4826', light: '#e7d5b2', accent: '#d08348' },
  },
  {
    id: 'malachite',
    name: 'Малахит',
    desc: 'Глубокая зелень, нефритовый акцент',
    swatch: { dark: '#296247', light: '#e9e0c1', accent: '#4fae83' },
  },
  {
    id: 'polar',
    name: 'Полярная ночь',
    desc: 'Холодный сланец, ледяной акцент',
    swatch: { dark: '#384655', light: '#d9dfe5', accent: '#6fb3cc' },
  },
];
