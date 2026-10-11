import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url)); let server; let browser; const errors = []; let count = 0;
const pass = (message) => console.log(`PASS ${++count}: ${message}`);
try {
  execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, env: { ...process.env, URBANACCESS_BASE: '/frontend/', URBANACCESS_MEDIA_TEST_BUILD: '1' }, stdio: 'pipe' });
  server = createServer(async (request, response) => { const file = new URL(request.url, 'http://localhost').pathname.replace(/^\/frontend\//, '') || 'index.html';
    if (file.includes('..')) { response.writeHead(404); response.end(); return; }
    try { response.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream'); response.end(await readFile(path.join(root, 'dist/frontend', file))); } catch { response.writeHead(404); response.end(); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}/frontend/`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'); browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 320, height: 800 } }); context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const page = await context.newPage(); await page.goto(`${base}tests/media.html`); await page.waitForFunction(() => window.mediaQA);
  const results = await page.evaluate(async () => {
    const nativeClose = ImageBitmap.prototype.close; let closed = 0; ImageBitmap.prototype.close = function() { closed++; return nativeClose.call(this); };
    const qa = window.mediaQA; const context = { auditId: crypto.randomUUID(), elementId: crypto.randomUUID() };
    const make = async (width, height, type = 'image/jpeg') => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#00aa00'; ctx.fillRect(0, 0, width, height); const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, .96)); canvas.width = 0; canvas.height = 0; return new File([blob], 'image.' + (type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp'), { type }); };
    const small = (await qa.processPhoto(await make(80, 40), context)).photo;
    const large = (await qa.processPhoto(await make(3000, 1500), context)).photo;
    const png = (await qa.processPhoto(await make(20, 30, 'image/png'), context)).photo;
    const webp = (await qa.processPhoto(await make(20, 30, 'image/webp'), context)).photo;
    const source = new Uint8Array(await (await make(80, 40)).arrayBuffer());
    // APP1: Exif\0\0, little endian TIFF, one orientation SHORT (6 = 90 degrees clockwise).
    const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const rotated = (await qa.processPhoto(new File([source.slice(0, 2), exif, source.slice(2)], 'rotated.jpg', { type: 'image/jpeg' }), context)).photo;
    const nativeBitmap = window.createImageBitmap; window.createImageBitmap = undefined;
    const nativeCreate = URL.createObjectURL, nativeRevoke = URL.revokeObjectURL; let created = 0, revoked = 0;
    URL.createObjectURL = (...args) => { created++; return nativeCreate(...args); }; URL.revokeObjectURL = (...args) => { revoked++; return nativeRevoke(...args); };
    let fallback; try { fallback = (await qa.processPhoto(new File([source.slice(0, 2), exif, source.slice(2)], 'fallback.jpg', { type: 'image/jpeg' }), context)).photo; }
    finally { window.createImageBitmap = nativeBitmap; URL.createObjectURL = nativeCreate; URL.revokeObjectURL = nativeRevoke; }
    let heicError = ''; try { await qa.processPhoto(new File(['0000ftypheic00000000'], 'a.heic', { type: 'image/heic' }), context); } catch (error) { heicError = error.message; }
    ImageBitmap.prototype.close = nativeClose;
    return { closed, small: [small.width, small.height], large: [large.width, large.height], png: png.mime, webp: webp.mime, rotated: [rotated.width, rotated.height], fallback: [fallback.width, fallback.height], created, revoked, heicError, hash: small.sha256 === await qa.sha256(small.blob), size: large.bytes, bytesMatch: small.bytes === small.blob.size };
  });
  assert.deepEqual(results.small, [80, 40]); assert.deepEqual(results.large, [2560, 1280]); assert.equal(results.png, 'image/jpeg'); assert.equal(results.webp, 'image/jpeg');
  assert.ok(results.hash && results.bytesMatch); assert.ok(results.size < 3 * 1024 * 1024); pass('native JPEG/PNG/WebP decode, no upscale, 2560 px resize, compression, hash and exact byte metadata');
  assert.deepEqual(results.rotated, [40, 80]); assert.deepEqual(results.fallback, [40, 80]); assert.equal(results.created, results.revoked); assert.ok(results.closed >= 5); assert.match(results.heicError, /HEIC.*JPEG/);
  pass('EXIF orientation applied once in bitmap and image fallback; temporary URLs released; unsupported HEIC explains JPEG fallback');
  const quota = await page.evaluate(async () => {
    const qa = window.mediaQA; const actor = { id: crypto.randomUUID(), name: 'Инспектор' }; const id = crypto.randomUUID();
    const initial = qa.createZ2Audit({ object: { name: 'Квота', address: 'Москва' }, inspectedOn: '2026-10-10', author: actor, purpose: 'Вход' }, { auditId: id, objectId: crypto.randomUUID(), zoneId: crypto.randomUUID(), elementIds: qa.Z2_TEMPLATE.elements.map(() => crypto.randomUUID()) }, new Date().toISOString());
    await qa.audits.commit({ auditId: id, expectedRevision: 0, actor, transactionId: crypto.randomUUID(), commands: [{ type: 'createAudit', audit: initial }] });
    const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20; const file = new File([await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))], 'a.png', { type: 'image/png' });
    const element = Object.values(initial.elements)[0]; const photo = (await qa.processPhoto(file, { auditId: id, elementId: element.id })).photo; const controller = qa.createEditor(initial);
    controller.enqueue({ type: 'updateElement', elementId: element.id, patch: { comment: 'Текст до добавления фото' } }); controller.enqueue({ type: 'attachPhoto', photo });
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(...args) { if (this.name === 'auditPhotos') throw new DOMException('Injected quota failure', 'QuotaExceededError'); return original.apply(this, args); };
    let failure; try { failure = await controller.flush(); } finally { IDBObjectStore.prototype.add = original; }
    const afterFailure = await qa.audits.load(id); const missing = await qa.loadPhoto(photo.id); const local = controller.getSnapshot();
    controller.discardPending((command) => command.type === 'attachPhoto'); const recovery = await controller.flush(); const recovered = await qa.audits.load(id);
    const final = await qa.audits.commit({ auditId: id, expectedRevision: recovered.revision, actor, transactionId: crypto.randomUUID(), commands: [{ type: 'attachPhoto', photo }] });
    const immutable = await qa.loadPhoto(photo.id); const detached = await qa.audits.commit({ auditId: id, expectedRevision: final.value.revision, actor, transactionId: crypto.randomUUID(), commands: [{ type: 'detachPhoto', photoId: photo.id, elementId: element.id }] });
    const retained = await qa.loadPhoto(photo.id);
    return { failure: failure.kind, state: local.saveState.kind, message: local.saveState.message, localText: local.value.elements[element.id].comment, failedRevision: afterFailure.revision,
      failedIds: afterFailure.photoIds, missing: !missing, recovery: recovery.kind, text: recovered.elements[element.id].comment, committed: final.kind, blob: immutable.blob instanceof Blob, hash: immutable.sha256 === await qa.sha256(immutable.blob), detached: detached.value.photoIds, retained: Boolean(retained) };
  });
  assert.equal(quota.failure, 'blocked'); assert.equal(quota.state, 'error'); assert.match(quota.message, /Недостаточно места/); assert.equal(quota.failedRevision, 1); assert.deepEqual(quota.failedIds, []); assert.ok(quota.missing);
  assert.equal(quota.localText, 'Текст до добавления фото'); assert.equal(quota.recovery, 'saved'); assert.equal(quota.text, quota.localText);
  assert.equal(quota.committed, 'committed'); assert.ok(quota.blob && quota.hash); assert.deepEqual(quota.detached, []); assert.ok(quota.retained);
  pass('AC-14: native transaction rollback on injected quota leaves revision/links/Blob untouched, keeps local text, and recovers by removing only pending photo');
  pass('detach preserves the immutable image for history; photo persists as Blob with verified hash');

  // Production UI: two independent door galleries, metadata links, accessible viewer and delete/undo.
  const ui = await context.newPage(); await ui.goto(base); await ui.getByRole('button', { name: 'Новое обследование', exact: true }).click();
  await ui.getByLabel('Название объекта', { exact: true }).fill('Две двери'); await ui.getByLabel('Адрес', { exact: true }).fill('Москва'); await ui.getByLabel('Исполнитель', { exact: true }).fill('Инспектор'); await ui.getByLabel('Проверяем только входную группу Z2').check(); await ui.getByRole('button', { name: 'Создать обследование', exact: true }).click(); await ui.locator('[data-save-state=saved]').waitFor();
  const buffer = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 100; c.height = 50; c.getContext('2d').fillRect(0, 0, 100, 50); return [...new Uint8Array(await (await new Promise((resolve) => c.toBlob(resolve, 'image/png'))).arrayBuffer())]; });
  const upload = async (card, caption) => { await card.locator('input[type=file]').last().setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(buffer) }); const dialog = ui.getByRole('dialog'); await dialog.getByLabel('Подпись фотографии').fill(caption); await dialog.getByRole('button', { name: 'Добавить фото к элементу' }).click(); await card.getByRole('button', { name: `Открыть фото: ${caption}` }).waitFor(); await ui.locator('[data-save-state=saved]').waitFor(); };
  await ui.getByRole('button',{name:'Открыть элемент: Входная дверь',exact:true}).click();
  const back = async () => { await ui.getByRole('button',{name:'Вернуться к элементам',exact:true}).click(); await ui.locator('.element-navigation-list').waitFor(); };
  const first = ui.locator('.element-detail-page'); await first.getByLabel('Ширина дверного проёма в свету', { exact: true }).fill('90'); await first.getByLabel('Ширина дверного проёма в свету', {exact:true}).blur(); await first.locator('.note-row summary').filter({hasText:'Замечания и дефекты'}).click(); await first.getByLabel('Замечание', { exact: true }).fill('Дверь узкая'); await first.getByLabel('Ширина дверного проёма в свету', {exact:true}).blur(); await ui.locator('[data-save-state=saved]').waitFor();
  await upload(first, 'Первая дверь'); await first.getByRole('button', { name: 'Открыть фото: Первая дверь' }).click(); let dialog = ui.getByRole('dialog'); await dialog.locator('summary').filter({hasText:'Подпись и связи'}).click(); await dialog.getByRole('checkbox').nth(0).check(); await dialog.getByRole('checkbox').nth(1).check(); await dialog.getByRole('button', { name: 'Готово', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await back(); await ui.getByRole('button', { name: 'Входная дверь 2', exact: true }).click(); const second = ui.locator('.element-detail-page'); await upload(second, 'Вторая дверь');
  await ui.reload(); await ui.locator('[data-save-state=saved]').waitFor(); await second.getByRole('button', { name: 'Открыть фото: Вторая дверь' }).waitFor();
  assert.equal(await second.getByRole('button',{name:'Открыть фото: Первая дверь'}).count(),0); await back(); await ui.getByRole('button',{name:'Открыть элемент: Входная дверь',exact:true}).click();
  assert.equal(await first.getByRole('button', { name: 'Открыть фото: Вторая дверь' }).count(), 0); await first.getByRole('button', {name:'Открыть фото: Первая дверь'}).click(); await ui.getByRole('dialog').locator('summary').filter({hasText:'Подпись и связи'}).click(); await ui.getByRole('dialog').getByText(/Замер:.*версия/).waitFor(); await ui.getByRole('dialog').getByText('Замечание: Дверь узкая').waitFor(); await ui.keyboard.press('Escape'); pass('AC-02: independent photos for two doors survive reload, with measurement and finding links');
  await ui.waitForFunction(() => navigator.serviceWorker.controller); await context.setOffline(true); await ui.reload(); await ui.locator('[data-save-state=saved]').waitFor();
  await first.getByRole('button', { name: 'Открыть фото: Первая дверь' }).waitFor(); await context.setOffline(false); pass('offline reload restores locally stored photos without a network request');
  assert.equal(await first.locator('.photo-strip > :last-child .photo-strip-add').count(),2); assert.equal(await first.locator('.photo-strip-thumbnail').count(),1);
  const trigger = first.getByRole('button', { name: 'Открыть фото: Первая дверь' }); await trigger.click(); dialog = ui.getByRole('dialog'); await dialog.getByRole('button', { name: 'Переключить масштаб фотографии' }).click(); assert.match(await dialog.getByRole('status').innerText(), /2.0x/);
  assert.match(await dialog.locator('.photo-viewport img').evaluate(img => img.style.transform), /scale\(2\)/);
  await dialog.getByRole('button', { name: 'Переключить масштаб фотографии' }).click(); assert.match(await dialog.getByRole('status').innerText(), /1.0x/);
  assert.equal(await dialog.evaluate(el => Math.round(el.getBoundingClientRect().height)), 800);
  await ui.screenshot({path:path.join(root,'artifacts/photo-fullscreen-320.png')});
  const inside = await ui.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]'))); assert.ok(inside); await ui.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await ui.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Открыть фото: Первая дверь'); assert.ok(await trigger.evaluate((element) => element === document.activeElement));
  const chooserPromise = ui.waitForEvent('filechooser'); await first.getByRole('button',{name:'Выбрать из медиатеки',exact:true}).click(); const chooser = await chooserPromise; assert.equal(await chooser.element().getAttribute('capture'),null); assert.equal(await chooser.element().getAttribute('accept'),'image/*'); await chooser.setFiles([]);
  assert.equal(await ui.getByRole('dialog').count(),0);
  const cameraPromise = ui.waitForEvent('filechooser'); await first.getByRole('button',{name:'Снять фото',exact:true}).click(); const cameraChooser = await cameraPromise; assert.equal(await cameraChooser.element().getAttribute('capture'),'environment'); await cameraChooser.setFiles([]); assert.equal(await ui.getByRole('dialog').count(),0);
  const geometry = await first.getByRole('button', { name: 'Снять фото' }).boundingBox(); assert.ok(geometry.width >= 52 && geometry.height >= 52); assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  pass('NFR-01: direct native camera/library inputs, no source dialog, media control >=52×52 px; labelled modal, zoom, focus containment/Escape/return focus; no page overflow at 320 px');
  await first.locator('input[type=file]').last().setInputFiles({ name: 'quota.png', mimeType: 'image/png', buffer: Buffer.from(buffer) });
  await ui.getByRole('dialog').getByLabel('Подпись фотографии').fill('Фото без места');
  await ui.evaluate(() => { window.realPhotoAdd = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function(...args) { if (this.name === 'auditPhotos') throw new DOMException('Injected quota', 'QuotaExceededError'); return window.realPhotoAdd.apply(this, args); }; });
  await ui.getByRole('dialog').getByRole('button', { name: 'Добавить фото к элементу' }).click();
  await ui.locator('[data-save-state=error]').waitFor(); assert.match(await ui.locator('[data-save-state=error]').innerText(), /Недостаточно места/);
  await ui.evaluate(() => { IDBObjectStore.prototype.add = window.realPhotoAdd; delete window.realPhotoAdd; });
  await first.getByRole('button', { name: 'Убрать несохранённое фото и сохранить текст' }).click(); await ui.locator('[data-save-state=saved]').waitFor();
  assert.equal(await ui.getByRole('button', { name: 'Открыть фото: Фото без места' }).count(), 0); await trigger.waitFor();
  pass('AC-14 UI: quota is an error rather than saved; inspector can remove only the failed upload and retain earlier photos');
  await trigger.click(); await ui.getByRole('dialog').getByRole('button', {name:'Удалить фото',exact:true}).click(); await ui.getByRole('button', { name: 'Подтвердить отвязку' }).click(); await trigger.waitFor({ state: 'hidden' }); await first.getByRole('button', { name: 'Вернуть фото' }).click(); await trigger.waitFor(); pass('separate deletion control requires confirmation; detach and undo restore intact links');
  assert.deepEqual(errors, []); console.log(`${count} media browser groups passed.`);
} finally { await browser?.close(); if (server) await new Promise((resolve) => server.close(resolve)); }
