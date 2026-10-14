import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.MOTION_TEST_URL || 'http://127.0.0.1:5175/frontend/';
  await page.goto(`${base}#/audits`);
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: 'Новое обследование', exact: true }).click();
    await page.waitForURL('**/#/audits/new');
    await page.getByLabel('Название объекта', { exact: true }).fill(`Создание ${i}`);
    await page.getByLabel('Адрес', { exact: true }).fill('Тестовый адрес');
    await page.getByLabel('Исполнитель', { exact: true }).fill('Тест UI');
    await page.getByLabel('Проверяем только входную группу Z2').check();
    await page.getByRole('button', { name: 'Создать обследование', exact: true }).click();
    await page.locator('.audit-editor[data-page-ready=true]').waitFor();
    await page.getByRole('button', { name: 'Все обследования', exact: true }).click();
    await page.locator('.audit-list-card').first().waitFor();
  }
  await page.evaluate(() => scrollTo(0, 500));
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => scrollY);
  assert.ok(before > 100);
  await page.getByRole('button', { name: 'Новое обследование', exact: true }).click();
  await page.locator('.audit-create-page').waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await page.getByRole('heading', { name: 'Новое обследование', exact: true }).count(), 1);
  assert.equal(await page.locator('.shell-header').isVisible(), false);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 700 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const button = await page.getByRole('button', { name: 'Создать обследование', exact: true }).boundingBox();
    assert.ok(button.x >= 0 && button.x + button.width <= width);
  }
  await page.setViewportSize({ width: 390, height: 700 });
  await page.getByLabel('Название объекта', { exact: true }).fill('Несохранённое');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Все обследования', exact: true }).click();
  assert.ok(page.url().endsWith('#/audits/new'));
  assert.equal(await page.getByLabel('Название объекта', { exact: true }).inputValue(), 'Несохранённое');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Все обследования', exact: true }).click();
  await page.locator('.audit-list-card').first().waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.audit-list-card').count(), 6);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) < 2);
  await page.getByRole('button', { name: 'Новое обследование', exact: true }).click();
  await page.locator('.audit-create-page').waitFor();
  await page.goBack();
  await page.locator('.audit-list-card').first().waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: separate creation route, six persisted audits, guarded cancellation, scroll restoration, browser Back, compact header and dock at 320–430px.');
} finally { await browser.close(); }
