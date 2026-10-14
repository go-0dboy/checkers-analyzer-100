// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest';
import { loadSettings, saveSettings } from '../src/state/settings';
afterEach(() => localStorage.clear());
it('keeps ordinary preferences but excludes legacy neural settings', () => {
  localStorage.setItem(
    'sk100.settings.v2',
    JSON.stringify({
      nnEnabled: true,
      nnBlend: 0.8,
      engineDepth: 7,
      useScan: false,
      showArrows: false,
    }),
  );
  const settings = loadSettings();
  expect(settings).toMatchObject({ engineDepth: 7, useScan: false, showArrows: false });
  expect(settings).not.toHaveProperty('nnEnabled');
  expect(settings).not.toHaveProperty('nnBlend');
  saveSettings(settings);
  expect(localStorage.getItem('sk100.settings.v2')).not.toContain('nn');
});
