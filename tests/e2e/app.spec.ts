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

test('release omits neural UI and Scan validates history and honours depth', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sk100.settings.v2', JSON.stringify({ useScan: false, nnEnabled: true }));
    localStorage.setItem('sk100.net.v3', '{corrupt obsolete weights');
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Сеть', exact: true })).toHaveCount(0);
  await expect(page.getByText('Использовать нейросеть', { exact: true })).toHaveCount(0);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite runtime module
    const { getScan } = await import('/src/engine/scan.ts');
    const scan = await getScan();
    if (!scan) return null;
    const invalid = await scan.analyze('W:WK23:BK28', 100, undefined, [], 'W:W31-50:B1-20');
    const limited = await scan.analyze('W:W31-50:B1-20', 1000, undefined, [], 'W:W31-50:B1-20', 2);
    return { invalid, limited };
  });
  expect(result).not.toBeNull();
  expect(result!.invalid).toBeNull();
  expect(result!.limited.depth).toBeGreaterThan(0);
  expect(result!.limited.depth).toBeLessThanOrEqual(2);
});

const useBuiltIn = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() =>
    localStorage.setItem('sk100.settings.v2', JSON.stringify({ useScan: false, engineTime: 500 })),
  );
  await page.goto('/');
};
const openTab = async (page: import('@playwright/test').Page, name: string) => {
  await page
    .locator('.nav-side:visible, .nav-mobile:visible')
    .getByRole('button', { name, exact: true })
    .click();
};
const clickSquare = async (page: import('@playwright/test').Page, square: number) => {
  const box = await page
    .locator('.board-frame .sq-dark')
    .nth(square - 1)
    .boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
};

test('setup FEN uses colour labels and rejects invalid input', async ({ page }) => {
  await useBuiltIn(page);
  await openTab(page, 'Доска');
  const input = page.getByPlaceholder('W:W31-50:B1-20', { exact: true });
  await input.fill('W:B1:W50');
  await page.getByRole('button', { name: 'Загрузить FEN в расстановку', exact: true }).click();
  await expect(page.locator('input[readonly]')).toHaveValue('W:W50:B1');
  for (const fen of ['X:W31:B20', 'W:W31:B31', 'W:W31-20:B1']) {
    await input.fill(fen);
    await page.getByRole('button', { name: 'Загрузить FEN в расстановку', exact: true }).click();
    await expect(page.getByText(/Не удалось разобрать FEN/)).toBeVisible();
    await expect(page.locator('input[readonly]')).toHaveValue('W:W50:B1');
  }
});

test('first-move and black variants are visible, numbered correctly and navigable', async ({
  page,
}) => {
  await useBuiltIn(page);
  await openTab(page, 'База');
  await page.getByRole('button', { name: 'Пример', exact: true }).click();
  await openTab(page, 'Ходы');
  await expect(page.getByRole('button', { name: '33-29', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '33-29', exact: true }).click();
  await expect(page.getByPlaceholder('Комментарий к ходу…')).toHaveValue('Альтернативное начало');
  await openTab(page, 'База');
  await page.getByPlaceholder(/Вставьте PDN/).fill('1.32-28 19-23 (1...17-22) *');
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await openTab(page, 'Ходы');
  const variant = page.getByRole('button', { name: '17-22', exact: true });
  await expect(variant.locator('..')).toContainText('1…');
  await variant.click();
  await expect(page.getByText('Ход 17-22', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Результат партии' }).selectOption('1-1');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать .pdn', exact: true }).click();
  const file = await download;
  const { readFile } = await import('node:fs/promises');
  const pdn = await readFile((await file.path())!, 'utf8');
  expect(pdn).toContain('[Result "1-1"]');
  expect(pdn).toContain('( 1... 17-22 )');
});

test('ambiguous capture picker is available outside the analysis tab', async ({ page }) => {
  await useBuiltIn(page);
  await openTab(page, 'Доска');
  await page
    .getByPlaceholder('W:W31-50:B1-20', { exact: true })
    .fill('W:WK18:B14,27,35,37-38,40-41,49');
  await page.getByRole('button', { name: 'Сразу применить FEN как позицию', exact: true }).click();
  await openTab(page, 'Ходы');
  await clickSquare(page, 18);
  await clickSquare(page, 45);
  await expect(page.getByText('Выберите маршрут взятия:', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /18 × 36 × 47 × 29 × 45/ }).click();
  await expect(page.getByText('Выберите маршрут взятия:', { exact: true })).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sk100.game.v4')!));
  const move = JSON.parse(saved.treeJson).children[0].move;
  expect(move.captures).toEqual([27, 41, 38, 40]);
  await page.reload();
  await expect(page.getByText('ход чёрных', { exact: false })).toBeVisible();
});

test('multi-game file offers a choice without merging headers or moves', async ({ page }) => {
  await useBuiltIn(page);
  await openTab(page, 'База');
  await page.locator('input[type=file]').setInputFiles({
    name: 'games.pdn',
    mimeType: 'text/plain',
    buffer: Buffer.from('[Event "A"] 1.32-28 1-0\n[Event "B"] 1.33-29 17-22 0-1'),
  });
  await expect(page.getByText(/Найдено партий: 2/)).toBeVisible();
  const choices = page.getByLabel('Партии из PDN');
  await choices.getByRole('button', { name: /2\..*B/ }).click();
  await openTab(page, 'Ходы');
  await expect(page.getByRole('button', { name: '33-29', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '32-28', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Результат партии' })).toHaveValue('0-1');
});

test('disabled Scan does not boot and comments do not restart analysis', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sk100.settings.v2', JSON.stringify({ useScan: false, engineTime: 500 }));
    const log: string[] = [];
    (window as unknown as { workerLog: string[] }).workerLog = log;
    const RealWorker = window.Worker;
    window.Worker = class extends RealWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        log.push(String(url));
      }
      postMessage(message: unknown) {
        log.push((message as { t: string }).t);
        super.postMessage(message);
      }
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'сыграть →' }).click();
  await page.getByRole('button', { name: 'сыграть →' }).waitFor();
  await openTab(page, 'Ходы');
  const log = () => page.evaluate(() => (window as unknown as { workerLog: string[] }).workerLog);
  const before = await log();
  expect(before.some((s) => s.includes('scan.worker'))).toBe(false);
  await page.getByPlaceholder('Комментарий к ходу…').pressSequentially('abc', { delay: 40 });
  await page.getByRole('button', { name: '!', exact: true }).click();
  expect(await log()).toEqual(before);
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: /Scan 3.1 \(WASM\)/ }).click();
  await expect(page.getByRole('button', { name: /Человеческий стиль/ })).toBeDisabled();
  await expect.poll(async () => (await log()).some((s) => s.includes('scan.worker'))).toBe(true);
});

test('worker failure shows an error and retry runs the direct fallback', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sk100.settings.v2', JSON.stringify({ useScan: false }));
    const RealWorker = window.Worker;
    window.Worker = class extends RealWorker {
      postMessage() {
        queueMicrotask(() => this.dispatchEvent(new Event('error')));
      }
    };
  });
  await page.goto('/');
  await expect(page.getByText(/Анализ не завершён/).first()).toBeVisible();
  await expect(page.locator('.spinner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить анализ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'сыграть →' })).toBeVisible();
});

test('unreadable autosave can be downloaded and is preserved until reset', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sk100.settings.v2', JSON.stringify({ useScan: false }));
    localStorage.setItem('sk100.game.v4', '{saved but unreadable');
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('защищены от перезаписи');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать исходное сохранение', exact: true }).click();
  const file = await download;
  const { readFile } = await import('node:fs/promises');
  expect(await readFile((await file.path())!, 'utf8')).toBe('{saved but unreadable');
  expect(await page.evaluate(() => localStorage.getItem('sk100.game.v4'))).toBe(
    '{saved but unreadable',
  );
  await page.getByRole('button', { name: 'Начать новую партию', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('sk100.game.v4')!).path),
  ).toEqual([]);
});

test('maximum length line survives reload and is displayed completely', async ({ page }) => {
  await useBuiltIn(page);
  await openTab(page, 'База');
  const pdn =
    '[FEN "W:WK46:BK1"]\n' +
    Array.from({ length: 500 }, (_, i) => ['46-41', '1-6', '41-46', '6-1'][i % 4]).join(' ') +
    ' *';
  await page.getByPlaceholder(/Вставьте PDN/).fill(pdn);
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await expect(page.getByText('Партия импортирована', { exact: true })).toBeVisible();
  await page.reload();
  await openTab(page, 'Ходы');
  await expect(page.getByText(/полуход 500\/500/)).toBeVisible();
  await expect(
    page.locator('section.panel button').filter({ hasText: /^(46-41|1-6|41-46|6-1)$/ }),
  ).toHaveCount(500);
});
