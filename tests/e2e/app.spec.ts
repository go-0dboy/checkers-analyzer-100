import { test, expect } from '@playwright/test';
test('Scan WASM really boots and returns legal capture routes', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('sk100.settings.v2', JSON.stringify({ useScan: false })),
  );
  await page.goto('/');
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite runtime module
    const { getScan } = await import('/src/engine/scan.ts');
    const scan = await getScan();
    if (!scan) return null;
    const capture = await scan.analyze('W:WK17:B9,20,21,28,30', 200);
    const start = await scan.analyze('W:W31-50:B1-20', 200);
    return { name: scan.name, capture, start };
  });
  expect(result).not.toBeNull();
  expect(result!.name).toContain('PATTERN');
  expect(result!.capture.move.captures).toHaveLength(5);
  expect(result!.capture.move.to).toBe(26);
  expect(result!.start.move.from).toBeGreaterThanOrEqual(31);
  expect(result!.start.depth).toBeGreaterThan(0);
  expect(result!.start.scoreWhite).not.toBeNull();
  expect(result!.start.pv.length).toBeGreaterThan(0);
});
test('first move, navigation, reload and mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('sk100.settings.v2', JSON.stringify({ useScan: false, engineTime: 100 })),
  );
  await page.reload();
  await page.getByRole('button', { name: 'сыграть →' }).click();
  await expect(page.getByText('ход чёрных', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'В начало', exact: true }).click();
  await expect(page.getByText('ход белых', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'В конец', exact: true }).click();
  await page.reload();
  await expect(page.getByText('ход чёрных', { exact: false })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
test('Scan abort settles and a subsequent analysis still works', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('sk100.settings.v2', JSON.stringify({ useScan: false })),
  );
  await page.goto('/');
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite runtime module
    const { getScan } = await import('/src/engine/scan.ts');
    const scan = await getScan();
    if (!scan) return null;
    const controller = new AbortController(),
      pending = scan.analyze('W:W31-50:B1-20', 10000, controller.signal);
    setTimeout(() => controller.abort(), 30);
    const cancelled = await pending;
    const next = await scan.analyze('W:WK23:BK28', 100);
    return { cancelled, next };
  });
  expect(result).not.toBeNull();
  expect(result!.cancelled).toBeNull();
  expect(result!.next.move.captures).toEqual([28]);
});
