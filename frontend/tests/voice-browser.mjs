import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url)); let server, browser; const errors = []; let count = 0;
const pass = (message) => console.log(`PASS ${++count}: ${message}`);
function installFakeSpeech() {
  class FakeRecognition {
    static instances = [];
    constructor() { FakeRecognition.instances.push(this); this.stopped = false; this.results = []; }
    start() {}
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    started() { this.onstart?.(); }
    final(text, index = 0) { this.results[index] = { isFinal: true, 0: { transcript: text } }; this.onresult?.({ resultIndex: index, results: this.results.slice() }); }
    interim(text) { const index = this.results.findIndex((result) => !result.isFinal); const target = index < 0 ? this.results.length : index; this.results[target] = { isFinal: false, 0: { transcript: text } }; this.onresult?.({ resultIndex: target, results: this.results.slice() }); }
    ended() { this.onend?.(); }
    error(error) { this.onerror?.({ error }); }
  }
  window.SpeechRecognition = FakeRecognition; window.fakeSpeech = FakeRecognition;
}
try {
  execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, env: { ...process.env, URBANACCESS_BASE: '/frontend/', URBANACCESS_VOICE_TEST_BUILD: '1' }, stdio: 'pipe' });
  server = createServer(async (request, response) => { const file = new URL(request.url, 'http://localhost').pathname.replace(/^\/frontend\//, '') || 'index.html'; if (file.includes('..')) { response.writeHead(404); response.end(); return; }
    try { response.setHeader('content-type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream'); response.end(await readFile(path.join(root, 'dist/frontend', file))); } catch { response.writeHead(404); response.end(); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}/frontend/`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'); browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 320, height: 900 } }); await context.addInitScript(installFakeSpeech);
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  const page = await context.newPage(); await page.goto(`${base}tests/voice.html`); await page.waitForFunction(() => window.voiceQA);
  const atomic = await page.evaluate(async () => {
    const qa = window.voiceQA; const actor = { id: crypto.randomUUID(), name: 'Инспектор' }; const at = new Date().toISOString();
    const audit = qa.createZ2Audit({ object: { name: 'Транзакции диктовки', address: 'Москва' }, inspectedOn: '2026-10-10', author: actor, purpose: 'Обследование' }, { auditId: crypto.randomUUID(), objectId: crypto.randomUUID(), zoneId: crypto.randomUUID(), elementIds: qa.Z2_TEMPLATE.elements.map(() => crypto.randomUUID()) }, at);
    await qa.audits.commit({ auditId: audit.id, expectedRevision: 0, actor, transactionId: crypto.randomUUID(), commands: [{ type: 'createAudit', audit }] });
    const element = Object.values(audit.elements)[0]; const editor = qa.createEditor(audit); const voice = new qa.VoiceController();
    voice.start({ auditId: audit.id, elementId: element.id, zoneId: element.zoneId, baseRevision: 1, mode: 'comment' }); const native = window.fakeSpeech.instances.at(-1); native.started(); native.final('Порог 20 миллиметров'); native.final('Порог 20 миллиметров'); native.ended(); await voice.flush();
    const before = await qa.audits.load(audit.id); const draft = voice.getSnapshot().draft;
    editor.enqueue({ type: 'updateElement', elementId: element.id, patch: { comment: 'Ручной текст' } }); await editor.flush();
    // Failure specifically at draft consumption must roll back the Audit write as well.
    const realPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { if (this.name === 'auditVoiceDrafts' && args[0].appliedAt) throw new DOMException('Injected quota', 'QuotaExceededError'); return realPut.apply(this, args); };
    const failed = await voice.apply(editor); IDBObjectStore.prototype.put = realPut;
    const rolledBack = await qa.audits.load(audit.id); const pending = (await qa.voiceDrafts.list(audit.id))[0];
    const applied = await voice.apply(editor); const result = await qa.audits.load(audit.id); const after = (await qa.voiceDrafts.list(audit.id))[0];
    const duplicate = await qa.audits.commit({ auditId: audit.id, expectedRevision: result.revision, actor, transactionId: crypto.randomUUID(), commands: [{ type: 'applyVoiceDraft', draftId: draft.id, draftVersion: draft.version, elementId: element.id, mode: 'comment', text: draft.reviewText, recommendationId: crypto.randomUUID() }] });
    const stable = await qa.audits.load(audit.id);
    // A stale audit revision cannot consume another draft.
    const id = crypto.randomUUID(); const second = { ...pending, id, sessionId: id, context: { ...pending.context, sessionId: id }, version: 1, reviewText: 'Второй текст', state: 'review' }; await qa.voiceDrafts.save(second);
    const conflict = await qa.audits.commit({ auditId: audit.id, expectedRevision: 1, actor, transactionId: crypto.randomUUID(), commands: [{ type: 'applyVoiceDraft', draftId: id, draftVersion: 1, elementId: element.id, mode: 'comment', text: second.reviewText, recommendationId: crypto.randomUUID() }] });
    const untouched = (await qa.voiceDrafts.list(audit.id)).find((d) => d.id === id);
    await voice.dispose();
    return { before: before.elements[element.id].comment, segments: draft.finalSegments.length, failed, rollbackText: rolledBack.elements[element.id].comment, rollbackRevision: rolledBack.revision, consumedOnFailure: !!pending.appliedAt, applied, text: result.elements[element.id].comment, appliedAt: !!after.appliedAt, measurements: result.measurements, duplicate: duplicate.kind, stable: stable.revision === result.revision, conflict: conflict.kind, untouched: !untouched.appliedAt };
  });
  assert.equal(atomic.before, ''); assert.equal(atomic.segments, 1); assert.equal(atomic.failed, false); assert.equal(atomic.rollbackText, 'Ручной текст'); assert.equal(atomic.rollbackRevision, 2); assert.equal(atomic.consumedOnFailure, false); assert.equal(atomic.applied, true); assert.equal(atomic.text, 'Ручной текст\nПорог 20 миллиметров'); assert.equal(atomic.appliedAt, true); assert.deepEqual(atomic.measurements, {});
  pass('AC-07/10: native IndexedDB persists a deduplicated draft; explicit apply appends to latest manual comment without numeric extraction');
  assert.equal(atomic.duplicate, 'failed'); assert.ok(atomic.stable); pass('atomic application marker prevents repeat application, including from another controller/tab');
  assert.equal(atomic.conflict, 'conflict'); assert.ok(atomic.untouched); pass('revision conflict leaves the voice draft unconsumed; quota failure rolls back both Audit and consumption marker and retry adds text once');
  const ui = await context.newPage(); await ui.goto(base); await ui.getByRole('button', { name: 'Новое обследование', exact: true }).click(); await ui.getByLabel('Название объекта', { exact: true }).fill('Интерфейс диктовки'); await ui.getByLabel('Адрес', { exact: true }).fill('Москва'); await ui.getByLabel('Исполнитель', { exact: true }).fill('Инспектор'); await ui.getByLabel('Проверяем только входную группу Z2').check(); await ui.getByRole('button', { name: 'Создать обследование', exact: true }).click(); await ui.locator('[data-save-state=saved]').waitFor();
  await ui.getByRole('button',{name:'Открыть элемент: Входная дверь',exact:true}).click();
  const back=async()=>{await ui.getByRole('button',{name:'Вернуться к элементам',exact:true}).click();await ui.locator('.element-navigation-list').waitFor();};
  const open=async name=>{await ui.getByRole('button',{name:`Открыть элемент: ${name}`,exact:true}).click();await ui.locator('.element-detail-page').waitFor();};
  const first = ui.locator('.element-detail-page'); await first.locator('.note-row > summary').filter({hasText:'Дополнительный комментарий'}).click(); const comment = first.getByLabel('Дополнительный комментарий'); await comment.fill('Ручное описание');
  const mic = first.getByRole('button', { name: 'Диктовать комментарий', exact: true }); await mic.click(); let dialog = ui.getByRole('dialog'); await dialog.getByText('Запрос доступа к микрофону', { exact: true }).waitFor();
  await ui.evaluate(() => { const recognition = window.fakeSpeech.instances.at(-1); recognition.started(); for (const text of ['нужно','нужно','нужно проверить','нужно проверить как']) recognition.interim(text); });
  assert.equal(await dialog.locator('[aria-live=off].dictation-transcript').innerText(), 'нужно проверить как');
  await ui.evaluate(() => { const recognition = window.fakeSpeech.instances.at(-1); recognition.final('Порог 20 миллиметров'); recognition.final('Порог 20 миллиметров'); });
  await ui.evaluate(() => { const recognition = window.fakeSpeech.instances.at(-1); recognition.interim('проверка продолжения'); recognition.final('вторая фраза', 1); recognition.final('вторая фраза', 1); });
  assert.equal(await dialog.locator('[aria-live=off].dictation-transcript').innerText(), 'Порог 20 миллиметров вторая фраза');
  assert.equal(await dialog.getByLabel('Текст для проверки').inputValue(), 'Порог 20 миллиметров вторая фраза');
  await dialog.getByRole('button', { name: 'Остановить запись', exact: true }).click(); await ui.evaluate(() => window.fakeSpeech.instances.at(-1).ended()); await dialog.getByLabel('Текст для проверки').fill('Проверенный текст'); await dialog.getByRole('button', { name: 'Добавить к комментарию', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); assert.equal(await comment.inputValue(), 'Ручное описание\nПроверенный текст'); assert.ok(await mic.evaluate((el) => el === document.activeElement)); pass('AC-07 UI: persistent review/edit panel, explicit addition, manual text retained and focus returned');
  await mic.click(); await ui.evaluate(() => window.fakeSpeech.instances.at(-1).error('not-allowed')); dialog = ui.getByRole('dialog'); await dialog.getByRole('alert').filter({ hasText: /Доступ к микрофону/ }).waitFor(); await dialog.getByRole('button', { name: 'Закрыть панель' }).click(); await comment.fill('Продолжаю вручную после отказа'); await comment.blur(); await ui.locator('[data-save-state=saved]').waitFor(); pass('AC-08 UI: denied microphone is a single inline error; manual completion and save remain available');
  await mic.click(); await ui.evaluate(() => window.fakeSpeech.instances.at(-1).started()); await ui.getByRole('dialog').getByRole('button', { name: 'Закрыть панель' }).click(); await ui.getByRole('button',{name:'Вернуться к элементам',exact:true}).click();
  await ui.evaluate(() => {const native=window.fakeSpeech.instances.at(-1); if(!native.stopped) throw Error('Microphone did not stop before leaving'); native.final('Поздний результат первой двери');native.ended();});
  await ui.locator('.element-navigation-list').waitFor(); await ui.getByRole('button', { name: 'Входная дверь 2', exact: true }).click();
  const second = ui.locator('.element-detail-page'); await second.locator('.note-row > summary').filter({hasText:'Дополнительный комментарий'}).click(); await second.getByLabel('Дополнительный комментарий').fill('Вторая дверь'); await ui.evaluate(() => { const native = window.fakeSpeech.instances.at(-1); if (!native.stopped) throw new Error('microphone did not stop on card transition'); native.final('Поздний результат первой двери'); native.ended(); });
  await ui.getByRole('button',{name:/^(Сводка и документ|Перейти к сводке)/}).click(); await ui.getByRole('button',{name:/Входная дверь: Проверить голосовой черновик/}).first().click(); dialog = ui.getByRole('dialog'); await dialog.getByLabel('Текст для проверки').fill('Текст для первой двери'); await dialog.getByRole('button', { name: 'Добавить к комментарию', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); assert.equal(await comment.inputValue(), 'Продолжаю вручную после отказа\nТекст для первой двери'); await back(); await open('Входная дверь 2'); await second.locator('.note-row > summary').filter({hasText:'Дополнительный комментарий'}).click(); assert.equal(await second.getByLabel('Дополнительный комментарий').inputValue(), 'Вторая дверь'); pass('AC-09 UI: closed panel/card change stops microphone; delayed final is restored and applied only to original door');
  await second.getByRole('button', { name: 'Диктовать рекомендацию', exact: true }).click(); await ui.evaluate(() => { const native = window.fakeSpeech.instances.at(-1); native.started(); native.final('Исправить доводчик'); native.ended(); }); dialog = ui.getByRole('dialog'); await dialog.getByRole('button', { name: 'Добавить к рекомендации', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); assert.equal(await second.getByLabel('Рекомендация', { exact: true }).inputValue(), 'Исправить доводчик'); pass('recommendation mode targets its own field, separately from comment'); await back(); await open('Входная дверь'); if (!(await comment.isVisible())) await first.locator('.note-row > summary').filter({hasText:'Дополнительный комментарий'}).click();
  await mic.click(); await ui.evaluate(() => { const native = window.fakeSpeech.instances.at(-1); native.started(); native.final('Черновик после перезагрузки'); }); dialog = ui.getByRole('dialog'); await dialog.getByRole('button', { name: 'Остановить запись', exact: true }).click(); await ui.evaluate(() => window.fakeSpeech.instances.at(-1).ended()); await dialog.getByRole('button', { name: 'Закрыть панель' }).click(); await ui.reload(); await ui.getByRole('button',{name:/^(Сводка и документ|Перейти к сводке)/}).click(); await ui.getByRole('button',{name:/Входная дверь: Проверить голосовой черновик/}).first().click(); dialog = ui.getByRole('dialog'); await dialog.getByLabel('Текст для проверки').waitFor(); assert.equal(await dialog.getByLabel('Текст для проверки').inputValue(), 'Черновик после перезагрузки'); assert.equal(await ui.evaluate(() => window.fakeSpeech.instances.length), 0);
  assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.ok(await ui.evaluate(() => document.activeElement.closest('[role=dialog]'))); await ui.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); const geometry = await mic.boundingBox(); assert.ok(geometry.width >= 52 && geometry.height >= 52);
  pass('draft recovery after reload never starts the microphone; accessible modal/focus/Escape, 52px microphone, no horizontal scroll at 320px'); await back(); await open('Входная дверь');
  if (!(await comment.isVisible())) await first.locator('.note-row > summary').filter({hasText:'Дополнительный комментарий'}).click();
  await mic.click(); await ui.evaluate(() => {
    const native = window.fakeSpeech.instances.at(-1); native.started();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState;
    if (!native.stopped) throw new Error('Background did not stop recognition'); native.final('Результат при уходе в фон'); native.ended();
  }); dialog = ui.getByRole('dialog'); assert.equal(await dialog.getByLabel('Текст для проверки').inputValue(), 'Результат при уходе в фон'); await dialog.getByRole('button', { name: 'Закрыть панель' }).click();
  pass('background lifecycle softly stops recognition and retains final text in the original draft');
  const pixelTrace = JSON.parse(await readFile(path.join(root,'frontend/tests/fixtures/pixel9-speech-results.json'),'utf8'));
  await mic.click();
  await ui.evaluate(trace => {
    const native=window.fakeSpeech.instances.at(-1); native.started();
    for (const event of trace) native.onresult?.({resultIndex:event.resultIndex,results:event.results.map(result=>({isFinal:result.isFinal,0:{transcript:result.text}}))});
  },pixelTrace);
  dialog=ui.getByRole('dialog');
  assert.equal(await dialog.getByLabel('Текст для проверки').inputValue(),'');
  assert.equal(await dialog.locator('[aria-live=off].dictation-transcript').innerText(),'ширина дверного проёма 85 см');
  await dialog.getByRole('button',{name:'Остановить запись',exact:true}).click();
  await ui.evaluate(()=>window.fakeSpeech.instances.at(-1).ended());
  assert.equal(await dialog.getByLabel('Текст для проверки').inputValue(),'ширина дверного проёма 85 см');
  assert.equal(await dialog.getByRole('button',{name:'Принять замер: Ширина дверного проёма в свету, 85 cm',exact:true}).count(),1);
  const beforePixelComment=await comment.inputValue();
  await dialog.getByRole('button',{name:'Добавить к комментарию',exact:true}).click(); await dialog.waitFor({state:'hidden'});
  assert.equal(await comment.inputValue(),`${beforePixelComment}\nширина дверного проёма 85 см`);
  pass('actual USB Pixel 9 trace: all-final cumulative hypotheses produce one reviewed phrase, one proposal and one comment append');
  await mic.click();
  await ui.evaluate(()=>{
    const native=window.fakeSpeech.instances.at(-1);native.started();
    native.final('',0);native.final('',1);native.final('1 2 3',2);native.final('1 2 3 4 5',3);
    native.final('Раз два три четыре пять',4);native.final('Раз два три четыре пять проверка',5);
  });
  dialog=ui.getByRole('dialog');
  assert.equal(await dialog.getByLabel('Текст для проверки').inputValue(),'');
  assert.equal(await dialog.locator('[aria-live=off].dictation-transcript').innerText(),'Раз два три четыре пять проверка');
  await dialog.getByRole('button',{name:'Остановить запись',exact:true}).click();
  await ui.evaluate(()=>window.fakeSpeech.instances.at(-1).ended());
  assert.equal(await dialog.getByLabel('Текст для проверки').inputValue(),'Раз два три четыре пять проверка');
  const beforeRevisionComment=await comment.inputValue();
  await dialog.getByRole('button',{name:'Добавить к комментарию',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(await comment.inputValue(),`${beforeRevisionComment}\nРаз два три четыре пять проверка`);
  await ui.reload();await ui.locator('[data-save-state=saved]').waitFor(); if (!(await comment.isVisible())) await first.locator('.note-row > summary').filter({hasText:'Дополнительный комментарий'}).click();
  assert.equal(await comment.inputValue(),`${beforeRevisionComment}\nРаз два три четыре пять проверка`);
  pass('cumulative hypothesis changes digits to words: one reviewed final version, one explicit append, exact reload recovery');
  const mobilePhrase = 'ширина дверного проёма в свету 85 см есть замечание по доводчику требуется проверка закрывания двери';
  const previousComment = await comment.inputValue();
  await mic.click();
  await ui.evaluate(phrase => {
    const native = window.fakeSpeech.instances.at(-1); native.started(); const words = phrase.split(' ');
    for (let index = 1; index <= 15; index++) native.interim(words.slice(0, index).join(' '));
  }, mobilePhrase);
  dialog = ui.getByRole('dialog');
  assert.equal(await dialog.getByLabel('Текст для проверки').inputValue(),'');
  assert.equal(await dialog.locator('[aria-live=off].dictation-transcript').innerText(),mobilePhrase.split(' ').slice(0,15).join(' '));
  await dialog.getByRole('button',{name:'Остановить запись',exact:true}).click();
  await ui.evaluate(phrase => { const native = window.fakeSpeech.instances.at(-1); native.final(phrase); native.final(phrase); native.ended(); },mobilePhrase);
  assert.equal(await dialog.getByLabel('Текст для проверки').inputValue(),mobilePhrase);
  assert.equal(await dialog.getByRole('button',{name:'Принять замер: Ширина дверного проёма в свету, 85 cm',exact:true}).count(),1);
  await dialog.getByRole('button',{name:'Добавить к комментарию',exact:true}).click(); await dialog.waitFor({state:'hidden'});
  assert.equal(await comment.inputValue(),`${previousComment}\n${mobilePhrase}`);
  await ui.reload(); await ui.locator('[data-save-state=saved]').waitFor();
  assert.equal(await comment.inputValue(),`${previousComment}\n${mobilePhrase}`);
  pass('15 growing mobile interim events: one final draft, one measurement proposal, one append and exact IndexedDB recovery');
  await mic.click(); await ui.evaluate(() => { const native=window.fakeSpeech.instances.at(-1); native.started(); native.final('ширина восемьдесят пять сантиметров; порог 2 см'); native.ended(); });
  dialog = ui.getByRole('dialog'); await dialog.getByRole('heading',{name:'Найдены замеры'}).waitFor();
  assert.equal(await first.getByLabel('Ширина дверного проёма в свету',{exact:true}).inputValue(),'');
  const auditId = new URL(ui.url()).hash.split('/')[2].split('?')[0];
  const loadUiAudit = async () => page.evaluate(id=>window.voiceQA.audits.load(id),auditId);
  let stored = await loadUiAudit(); const originalRevision = stored.revision; const firstId=Object.values(stored.elements).find(e=>e.type==='door').id;
  assert.equal(Object.values(stored.measurements).length,0);
  await dialog.getByRole('button',{name:'Принять замер: Ширина дверного проёма в свету, 85 cm',exact:true}).click();
  await dialog.getByText(/Замер сохранён|Предварительный профиль/).first().waitFor();
  stored = await loadUiAudit(); assert.equal(stored.revision,originalRevision+1); assert.equal(stored.elements[firstId].measurementInputs.doorWidth.text,'85'); assert.equal(Object.values(stored.measurements).find(m=>m.elementId===firstId&&m.primary).normalized.value,85);
  await dialog.getByRole('button',{name:'Отклонить замер: Высота порога, 2',exact:true}).click(); assert.equal(Object.values(await loadUiAudit().then(a=>a.measurements)).some(m=>m.parameter==='thresholdHeight'),false);
  await dialog.getByRole('button',{name:'Закрыть панель'}).click();
  await first.getByLabel('Ширина дверного проёма в свету',{exact:true}).fill('90'); await first.getByLabel('Ширина дверного проёма в свету',{exact:true}).blur(); await ui.locator('[data-save-state=saved]').waitFor();
  await ui.waitForFunction(()=>navigator.serviceWorker.controller); await context.setOffline(true);
  await mic.click(); await ui.evaluate(()=>{const native=window.fakeSpeech.instances.at(-1);native.started();native.final('дверь 80; порог 1,4 см');native.ended();}); dialog=ui.getByRole('dialog');
  await dialog.getByRole('button',{name:'Принять замер: Ширина дверного проёма в свету, 80 cm',exact:true}).waitFor();
  ui.once('dialog',prompt=>prompt.dismiss()); await dialog.getByRole('button',{name:'Принять замер: Ширина дверного проёма в свету, 80 cm',exact:true}).click();
  assert.equal(await first.getByLabel('Ширина дверного проёма в свету',{exact:true}).inputValue(),'90');
  ui.once('dialog',prompt=>prompt.accept()); await dialog.getByRole('button',{name:'Принять замер: Ширина дверного проёма в свету, 80 cm',exact:true}).click();
  await ui.waitForFunction(()=>document.querySelector('input[data-audit-field=doorWidth]').value==='80'); await ui.locator('[data-save-state=saved]').waitFor();
  await dialog.getByRole('button',{name:'Принять замер: Высота порога, 1.4 cm',exact:true}).click(); await ui.locator('[data-save-state=saved]').waitFor();
  stored = await loadUiAudit(); assert.equal(Object.values(stored.measurements).some(m=>m.elementId !== firstId && m.primary),false);
  assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await ui.screenshot({path:path.join(root,'artifacts/m2-proposals-320.png')});
  for (const width of [375,390]) { await ui.setViewportSize({width,height:844}); assert.equal(await ui.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false); await ui.screenshot({path:path.join(root,`artifacts/grouped-voice-${width}.png`)}); }
  await ui.setViewportSize({width:320,height:900});
  await dialog.getByRole('button',{name:'Закрыть панель'}).click(); await context.setOffline(false); await ui.reload();
  await ui.locator('[data-save-state=saved]').waitFor(); assert.equal(await first.getByLabel('Ширина дверного проёма в свету',{exact:true}).inputValue(),'80');
  pass('M2: explicit atomic proposal acceptance, rejection, confirmed overwrite, original-element isolation, norm feedback and offline persistence');
  const noapi = await context.newPage(); await noapi.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; }); await noapi.goto(ui.url()); await noapi.getByText(/Этот браузер не поддерживает диктовку/).first().waitFor(); assert.ok(await noapi.getByRole('button', { name: 'Диктовать комментарий' }).first().isDisabled()); if (!(await noapi.getByLabel('Дополнительный комментарий').first().isVisible())) await noapi.locator('.note-row > summary').filter({hasText:'Дополнительный комментарий'}).first().click(); await noapi.getByLabel('Дополнительный комментарий').first().fill('Вручную без API'); await noapi.getByLabel('Дополнительный комментарий').first().blur(); await noapi.locator('[data-save-state=saved]').waitFor(); pass('unsupported browser disables only voice; manual inputs and storage continue');
  await mkdir(path.join(root, 'artifacts'), { recursive: true }); await mic.click(); await ui.evaluate(() => { const native = window.fakeSpeech.instances.at(-1); native.started(); native.final('Входная дверь открывается с усилием. Рекомендуется проверить доводчик.'); native.ended(); }); await ui.getByRole('dialog').getByLabel('Текст для проверки').waitFor(); await ui.screenshot({ path: path.join(root, 'artifacts/m1-voice-320.png') });
  assert.deepEqual(errors, []); console.log(`${count} voice browser groups passed.`);
} finally { await browser?.close(); if (server) await new Promise((resolve) => server.close(resolve)); }
