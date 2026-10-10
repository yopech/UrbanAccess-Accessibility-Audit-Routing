import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8765/frontend/';
const out = process.env.ARTIFACT_DIR || '/tmp/urbanaccess-dictation-qa';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
async function prepare(mock = true) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('https://tile.openstreetmap.org/**', r => r.abort());
  await context.addInitScript(({ mock }) => {
    window.__sessions = [];
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = mock ? class {
      constructor() { window.__sessions.push(this); }
      start() { this.started = true; }
      stop() { this.stopped = true; }
      abort() { this.aborted = true; }
      emit(text, isFinal = true) { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] }); }
    } : undefined;
  }, { mock });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.locator('#open-demo').click(); await page.locator('#open-results').click(); await page.locator('#add-demo-example').click();
  return { context, page };
}
try {
  const { page } = await prepare();
  await page.locator('#comment').fill('Ручная запись.');
  await page.locator('#dictate-comment').click();
  await page.evaluate(() => window.__sessions.at(-1).emit('Порог четыре', false));
  assert.equal(await page.locator('#comment').inputValue(), 'Ручная запись.');
  assert.match(await page.locator('#dictation-preview').textContent(), /Порог четыре/);
  await page.locator('#save-ready').click();
  assert.equal(await page.locator('#collector-view').isVisible(), true);
  assert.match(await page.locator('#toast').textContent(), /Завершите диктовку/);
  await page.locator('#comment').fill('Ручная запись. Уточнение вручную.');
  await page.evaluate(() => { const s = window.__sessions.at(-1); s.emit('Порог у двери четыре сантиметра.'); s.emit('Порог у двери четыре сантиметра.'); });
  const expected = 'Ручная запись. Уточнение вручную. Порог у двери четыре сантиметра.';
  assert.equal(await page.locator('#comment').inputValue(), expected);
  await page.locator('#dictate-comment').click(); await page.evaluate(() => window.__sessions.at(-1).onend());
  assert.match(await page.locator('#dictation-status').textContent(), /Проверьте слова и числа/);
  await page.locator('#save-ready').click(); await page.locator('#records-view').waitFor({ state: 'visible' });
  let snapshot = await page.evaluate(async () => (await import('./src/db.js')).getSnapshot());
  assert.ok(snapshot.observations.some(r => r.comment === expected));
  await page.reload(); await page.locator('#open-results').click();
  assert.match(await page.locator('#results-content').textContent(), /Порог у двери четыре сантиметра/);
  await page.locator('#open-report').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-report').click()]);
  assert.ok((await readFile(await download.path(), 'utf8')).includes(expected));
  console.log('PASS: final text appended once, manual edits preserved, interim text not saved; save requires review; text survives reload and printed report');

  await page.locator('[data-view="records-view"]').click(); await page.locator('#add-demo-example').click();
  await page.locator('#comment').fill('До сброса'); await page.locator('#dictate-comment').click();
  await page.evaluate(() => { window.__oldSession = window.__sessions.at(-1); });
  page.once('dialog', d => d.accept()); await page.locator('#reset-form').click();
  await page.evaluate(() => window.__oldSession.emit('Поздний результат'));
  assert.equal(await page.locator('#comment').inputValue(), '');
  await page.locator('#dictate-comment').click(); await page.locator('[data-view="records-view"]').click();
  assert.equal(await page.evaluate(() => window.__sessions.at(-1).aborted), true);
  console.log('PASS: reset and navigation cancel microphone session; late results cannot enter another observation');

  await page.locator('#add-demo-example').click(); await page.locator('#comment').fill('Сохраняем заметку'); await page.locator('#dictate-comment').click();
  await page.evaluate(() => window.__sessions.at(-1).onerror({ error: 'not-allowed' }));
  assert.equal(await page.locator('#comment').inputValue(), 'Сохраняем заметку');
  assert.match(await page.locator('#dictation-status').textContent(), /не разрешён/);
  await page.locator('#dictate-comment').click(); await page.evaluate(() => window.__sessions.at(-1).onerror({ error: 'network' }));
  assert.match(await page.locator('#dictation-status').textContent(), /интернет/);
  console.log('PASS: denied microphone and network failures retain typed text and explain fallback');

  await page.locator('#comment').fill('а'.repeat(998)); await page.locator('#dictate-comment').click();
  await page.evaluate(() => { const s = window.__sessions.at(-1); s.emit('Длинная фраза'); s.onend(); });
  assert.equal((await page.locator('#comment').inputValue()).length, 1000);
  assert.match(await page.locator('#dictation-status').textContent(), /предел 1000/);
  console.log('PASS: maximum length retained, truncation shown to inspector');

  const { page: unsupported } = await prepare(false);
  assert.equal(await unsupported.locator('#dictate-comment').isDisabled(), true);
  assert.match(await unsupported.locator('#dictation-status').textContent(), /недоступна/);
  await unsupported.locator('#comment').fill('Можно писать вручную');
  await unsupported.locator('#save-ready').click(); await unsupported.locator('#records-view').waitFor({ state: 'visible' });
  console.log('PASS: unsupported browser keeps manual form operational');
  await page.locator('[data-view="collector-view"]').click();
  await page.locator('#comment').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/dictation-mobile.png` });
  assert.deepEqual(errors, []);
  console.log('Recognition is simulated in these checks; real microphone accuracy needs a device test.');
} finally { await browser.close(); }
