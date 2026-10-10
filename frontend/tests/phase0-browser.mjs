import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'urbanaccess-phase0-'));
let server; let browser; let current;
const errors = []; let checks = 0;
const ok = (message) => { checks++; console.log(`PASS ${checks}: ${message}`); };
async function build(id) {
  execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root,
    env: { ...process.env, URBANACCESS_BASE: '/frontend/', URBANACCESS_TEST_BUILD: '1', URBANACCESS_BUILD_ID: id }, stdio: 'pipe' });
  const destination = path.join(temp, id); await cp(path.join(root, 'dist/frontend'), destination, { recursive: true }); return destination;
}
try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  const versionA = await build('qa-A'); const versionB = await build('qa-B'); current = versionA;
  server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/empty.html') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Seed</title>'); return; }
    const file = url.pathname.replace(/^\/frontend\//, '') || 'index.html';
    if (!url.pathname.startsWith('/frontend/') || file.includes('..')) { response.writeHead(404); response.end(); return; }
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/octet-stream';
    try { const body = await readFile(path.join(current, file)); response.setHeader('content-type', type); response.setHeader('cache-control', 'no-store'); response.end(body); }
    catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await context.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  const a = await context.newPage(); await a.goto(`${base}/frontend/tests/phase0.html`);
  await a.waitForFunction(() => window.qa && document.querySelector('[data-save-state="saved"]'));
  await a.waitForFunction(() => navigator.serviceWorker.controller);
  const b = await context.newPage(); await b.goto(`${base}/frontend/tests/phase0.html`);
  await b.waitForFunction(() => window.qa && document.querySelector('[data-save-state="saved"]'));
  await Promise.all([a, b].map((page, i) => page.evaluate((title) => { qa.controller.enqueue({ title }); return qa.controller.flush(); }, `Tab ${i}`)));
  await a.waitForTimeout(100);
  const states = await Promise.all([a, b].map((page) => page.evaluate(() => qa.controller.getSnapshot().saveState.kind)));
  assert.deepEqual(states.sort(), ['conflict', 'saved']);
  const conflict = (await a.evaluate(() => qa.controller.getSnapshot().saveState.kind)) === 'conflict' ? a : b;
  const winner = conflict === a ? b : a;
  assert.equal(await conflict.getByRole('dialog').count(), 1);
  await conflict.getByRole('button', { name: 'Сравнить версии' }).click();
  assert.match(await conflict.getByRole('dialog').textContent(), /Ваши правки/);
  await conflict.getByRole('button', { name: 'Сохранить самостоятельную копию' }).click();
  await conflict.waitForFunction(() => window.qa.copyId && qa.controller.getSnapshot().saveState.kind === 'saved');
  const copy = await conflict.evaluate(async () => ({ value: await qa.store.load(qa.copyId), original: qa.controller.getSnapshot().base }));
  assert.notEqual(copy.value.id, copy.original.id); assert.equal(copy.value.revision, 1);
  ok('AC-15: React shows conflict, retains local edits, compares versions and saves a separate copy');

  // Real waiting worker discovers a new build while text is still saving.
  current = versionB;
  await winner.evaluate(() => { qa.delay(); qa.controller.enqueue({ title: 'Save before update' }); void qa.controller.flush(); });
  await winner.waitForFunction(() => qa.controller.getSnapshot().saveState.kind === 'saving');
  await winner.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
  await winner.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
  assert.equal(await winner.locator('[data-build]').getAttribute('data-build'), 'qa-A');
  await winner.getByRole('button', { name: 'Сохранить данные и обновить приложение' }).waitFor();
  ok('AC-20: new worker waits; discovering an update does not restart or discard in-flight edits');
  await conflict.close();
  await winner.getByRole('button', { name: 'Сохранить данные и обновить приложение' }).click();
  await winner.waitForFunction(() => document.querySelector('[data-pwa-status="blocked"]'), { timeout: 15000 });
  assert.equal(await winner.locator('[data-build]').getAttribute('data-build'), 'qa-A');
  await winner.evaluate(() => qa.release());
  await winner.waitForFunction(() => qa.controller.getSnapshot().saveState.kind === 'saved');
  ok('AC-20: update times out safely when flush is unfinished and leaves the current version running');

  // A window with no coordination handler must prevent activation.
  const silent = await context.newPage(); await silent.goto(`${base}/frontend/legacy.html`);
  await silent.locator('#open-demo').waitFor();
  await winner.getByRole('button', { name: 'Сохранить данные и обновить приложение' }).click();
  await winner.waitForFunction(() => document.querySelector('[data-pwa-status="blocked"]'), { timeout: 15000 });
  assert.equal(await winner.locator('[data-build]').getAttribute('data-build'), 'qa-A'); await silent.close();
  ok('an unresponsive open window blocks an update');

  await winner.getByRole('button', { name: 'Сохранить данные и обновить приложение' }).click();
  await winner.waitForFunction(() => document.querySelector('[data-build="qa-B"]'), { timeout: 15000 });
  await winner.waitForFunction(() => window.qa && qa.controller.getSnapshot().value.title === 'Save before update');
  ok('explicit update flushes successfully, activates, reloads and retains the saved IndexedDB value');
  await context.setOffline(true);
  await winner.reload(); await winner.waitForFunction(() => window.qa && qa.controller.getSnapshot().value.title === 'Save before update');
  const offline = await context.newPage(); await offline.goto(`${base}/frontend/#/routes`);
  await offline.frameLocator('iframe').locator('#open-demo').waitFor();
  const files = await winner.evaluate(async () => { const keys = await caches.keys(); const entries = await Promise.all(keys.map(async (key) => (await (await caches.open(key)).keys()).map((r) => r.url))); return entries.flat(); });
  assert.ok(files.some((url) => url.endsWith('.woff2'))); assert.ok(files.some((url) => new URL(url).pathname.endsWith('/legacy.html')));
  await offline.frameLocator('iframe').locator('#open-demo').click();
  await offline.frameLocator('iframe').locator('#open-results').waitFor();
  await offline.frameLocator('iframe').getByText('Копия всех данных', { exact: true }).click();
  const offlineDownload = offline.waitForEvent('download', { timeout: 5000 }).catch((error) => ({ error }));
  await offline.frameLocator('iframe').locator('#export-backup').click();
  const gotOfflineDownload = await offlineDownload;
  if (gotOfflineDownload.error) throw new Error(JSON.stringify(await offline.frameLocator('iframe').locator('body').innerText()));
  const offlineBackup = JSON.parse(await readFile(await gotOfflineDownload.path(), 'utf8'));
  assert.equal(offlineBackup.observations.length, 4); assert.equal(offlineBackup.observations[0].photos.length, 1);
  ok('offline cold launch loads React shell, legacy forms, chunks and local fonts; export works without network');
  await context.setOffline(false); await context.close();

  current = versionA;
  const legacyContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  legacyContext.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await legacyContext.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  const legacy = await legacyContext.newPage(); await legacy.goto(`${base}/empty.html`);
  await legacy.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('urban-accessibility-field-v1', 2);
      request.onupgradeneeded = () => { const db = request.result;
        db.createObjectStore('observations', { keyPath: 'id' }); db.createObjectStore('photos', { keyPath: 'id' }).createIndex('observationId', 'observationId'); db.createObjectStore('projects', { keyPath: 'id' }); };
      request.onerror = reject;
      request.onsuccess = () => { const db = request.result; const tx = db.transaction(['observations', 'photos'], 'readwrite');
        tx.objectStore('observations').put({ id: 'legacy-record', locationDescription: 'Старая запись', observedAt: '2026-09-16T12:46:32Z', status: 'DRAFT' });
        tx.objectStore('photos').put({ id: 'legacy-photo', observationId: 'legacy-record', blob: new Blob(['photo']), name: 'old.jpg' });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = reject; };
    });
  });
  await legacy.goto(`${base}/frontend/#/routes`); const frame = legacy.frameLocator('iframe'); await frame.locator('#open-demo').waitFor();
  assert.match(await frame.locator('#legacy-panel').textContent(), /Старая запись/);
  await frame.getByText('Копия всех данных', { exact: true }).click();
  const download = legacy.waitForEvent('download'); await frame.locator('#export-backup').click();
  const backup = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.equal(backup.observations.length, 1); assert.equal(backup.observations[0].photos.length, 1);
  ok('AC-19: legacy host reads migrated v2 observations and exports original photo content through shared v3 opener');
  await legacy.evaluate(() => { location.hash = '#/missing'; }); await legacy.locator('iframe').waitFor({ state: 'detached' });
  await legacy.evaluate(() => { location.hash = '#/routes'; }); await frame.locator('#open-demo').waitFor();
  assert.equal(legacy.frames().length, 2); await frame.locator('#open-demo').click(); await frame.locator('#open-results').waitFor();
  ok('legacy remount has a single browsing context and working handlers after disposal');
  current = versionB;
  await frame.locator('#new-project').click(); await frame.locator('#project-name').fill('Keep this unsaved form');
  await legacy.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await legacy.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
  await legacy.getByRole('button', { name: 'Сохранить данные и обновить приложение' }).click();
  await legacy.waitForFunction(() => document.querySelector('[data-pwa-status="blocked"]'));
  assert.equal(await frame.locator('#project-name').inputValue(), 'Keep this unsaved form');
  assert.equal(await legacy.locator('[data-build]').getAttribute('data-build'), 'qa-A');
  const iframe = legacy.frames().find((f) => f.url().endsWith('/legacy.html'));
  await iframe.evaluate(() => document.getElementById('project-form').reset());
  await legacy.getByRole('button', { name: 'Сохранить данные и обновить приложение' }).click();
  await legacy.waitForFunction(() => document.querySelector('[data-build="qa-B"]'));
  await legacy.frameLocator('iframe').locator('#new-project').waitFor();
  ok('unsaved legacy form blocks updates; explicit form reset releases the blocker');
  const overflow = await legacy.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
  await legacyContext.close();
  assert.deepEqual(errors, []); console.log(`PASS ${checks} browser groups; no browser errors.`);
} finally {
  await browser?.close(); if (server) await new Promise((resolve) => server.close(resolve)); await rm(temp, { recursive: true, force: true });
}
