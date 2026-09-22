import assert from "node:assert/strict";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:8765/frontend/";
const out = process.env.ARTIFACT_DIR || "/tmp/urbanaccess-pilot-qa";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], contexts = [];
let checks = 0;
const ok = (label) => { checks++; console.log(`PASS ${checks}: ${label}`); };
async function context(options = {}) { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options }); contexts.push(c); c.on("page", (page) => page.on("pageerror", (e) => errors.push(e.message))); await c.route("https://tile.openstreetmap.org/**", (route) => route.abort()); return c; }
async function snapshot(page) { return page.evaluate(async () => (await import("./src/db.js")).getSnapshot()); }
async function upload(page, data, filename = "results.json") {
  await page.locator('[data-view="project-view"]').click();
  await page.locator("#import-backup").setInputFiles({ name: filename, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
  await page.locator("#confirm-import").waitFor();
  await page.locator("#confirm-import").click();
  await page.locator("#import-preview").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#global-error").isVisible(), false, await page.locator("#global-error").textContent());
}
async function downloadJSON(page, selector) { const [download] = await Promise.all([page.waitForEvent("download"), page.locator(selector).click()]); return JSON.parse(await readFile(await download.path(), "utf8")); }
try {
  const coordinator = await context(), page = await coordinator.newPage();
  await page.goto(base); await page.locator("#open-demo").waitFor();
  await page.screenshot({ path: path.join(out, "welcome-mobile.png"), fullPage: true });
  await page.locator("#open-demo").click(); await page.locator("#open-results").waitFor();
  let data = await snapshot(page); assert.equal(data.projects.length, 1); assert.equal(data.observations.length, 4); assert.equal(data.photos.length, 4); ok("demo creates separate synthetic project, 4 observations and photos");
  await page.locator("#open-results").click();
  assert.match(await page.locator(".conclusion-card").textContent(), /Данных недостаточно/);
  await page.screenshot({ path: path.join(out, "results-mobile.png"), fullPage: true });
  await page.locator("#add-demo-example").click();
  await page.locator("#save-ready").click(); await page.locator("#records-view").waitFor({ state: "visible" });
  data = await snapshot(page); assert.equal(data.observations.length, 5); assert.equal(data.photos.length, 5); ok("collector saves a complete new observation and photo");
  const newRecord = data.observations.find((r) => r.locationDescription === "Учебная запись: вход в центр");
  let card = page.locator(`[id="record-${newRecord.id}"]`);
  await card.locator(".review-panel > summary").click();
  await card.locator('[name="status"]').selectOption("ACCEPTED");
  await card.locator('[name="comment"]').fill("Проверены учебное фото и ориентир");
  await card.locator(".review-form button").click();
  await page.waitForFunction(async (rid) => (await (await import("./src/db.js")).getObservation(rid)).reviewStatus === "ACCEPTED", newRecord.id);
  data = await snapshot(page); assert.equal(data.observations.find((r) => r.id === newRecord.id).reviewHistory.length, 1); ok("coordinator acceptance records reason and history");
  card = page.locator(`[id="record-${newRecord.id}"]`);
  await card.locator('[data-action="recheck"]').click();
  assert.equal(await page.locator("#photo-list img").count(), 0); assert.equal(await page.locator("#finding-absent").isDisabled(), false);
  await page.locator("#save-ready").click(); await page.locator("#form-errors").waitFor({ state: "visible" });
  assert.match(await page.locator("#form-errors").textContent(), /фотограф/); ok("recheck does not reuse old photo and requires new evidence");
  await page.locator("#reporter-alias").fill("Повторный участник"); await page.locator("#experience-source").selectOption("DIRECT_OBSERVATION");
  await page.locator("#finding-absent + span").click();
  await page.locator("#photo-input").setInputFiles({ name: "new-check.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") });
  await page.locator("#save-ready").click(); await page.locator("#records-view").waitFor({ state: "visible" });
  data = await snapshot(page); const recheck = data.observations.find((r) => r.previousObservationId === newRecord.id);
  assert.ok(recheck); assert.equal(data.observations.find((r) => r.id === newRecord.id).supersededById, undefined);
  const recheckCard = page.locator(`[id="record-${recheck.id}"]`); await recheckCard.locator(".review-panel > summary").click(); await recheckCard.locator('[name="status"]').selectOption("ACCEPTED"); await recheckCard.locator('[name="comment"]').fill("Учебное обновление подтверждено новым фото"); await recheckCard.locator('[name="replace"]').check(); await recheckCard.locator(".review-form button").click();
  await page.waitForFunction(async (rid) => Boolean((await (await import("./src/db.js")).getObservation(rid)).supersededById), newRecord.id);
  data = await snapshot(page); assert.equal(data.observations.length, 6); assert.equal(data.photos.length, 6); assert.equal(data.observations.find((r) => r.id === newRecord.id).supersededById, recheck.id); ok("accepted recheck explicitly replaces prior record while retaining its photo and review history");
  await page.locator(".photo-preview").first().click(); await page.locator("#photo-dialog").waitFor({ state: "visible" }); await page.locator("#close-photo").click(); ok("photographs open safely inside a closable dialog");
  await page.locator("#open-report").click(); await page.locator("#report-content img").first().waitFor();
  assert.equal(await page.locator("#report-content img").count(), 6);
  assert.match(await page.locator("#report-content").textContent(), /Вход в центр — Не обследован/);
  const [reportDownload] = await Promise.all([page.waitForEvent("download"), page.locator("#download-report").click()]);
  const reportText = await readFile(await reportDownload.path(), "utf8"); assert.ok(reportText.includes("data:image/png;base64,")); assert.ok(!reportText.includes('<script')); ok("standalone report includes photos, unknown coverage, history and demo warning");
  await page.pdf({ path: path.join(out, "demo-report.pdf"), format: "A4", printBackground: true }); assert.ok((await stat(path.join(out, "demo-report.pdf"))).size > 10000);
  await page.screenshot({ path: path.join(out, "report-mobile.png"), fullPage: true });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const view of ["project-view", "collector-view", "records-view"]) {
      await page.locator(`[data-view="${view}"]`).click();
      const sizes = await page.evaluate(() => ({ width: innerWidth, body: document.body.scrollWidth, html: document.documentElement.scrollWidth }));
      assert.ok(sizes.body <= width && sizes.html <= width, `Overflow ${view} at ${width}: ${JSON.stringify(sizes)}`);
    }
  } ok("all three screens fit 320, 390, 768 and 1280 px");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-view="project-view"]').click();
  const assignment = await downloadJSON(page, "#export-assignment"); assert.equal(assignment.observations.length, 0);
  const participant = await context(), worker = await participant.newPage(); await worker.goto(base); await worker.locator("#open-demo").waitFor();
  await upload(worker, assignment, "assignment.json");
  let wd = await snapshot(worker); assert.equal(wd.observations.length, 0); assert.equal(wd.projects[0].parts[0].coverage, "UNCHECKED");
  await worker.locator("#open-results").click(); await worker.locator("#add-demo-example").click(); await worker.locator("#reporter-alias").fill("Другой участник"); await worker.locator("#save-ready").click(); await worker.locator("#records-view").waitFor({ state: "visible" });
  await worker.locator('[data-view="project-view"]').click(); const results = await downloadJSON(worker, "#export-project");
  await upload(page, results); const after = await snapshot(page); assert.equal(after.observations.length, 7); assert.equal(after.projects[0].parts[0].coverage, "CHECKED");
  await upload(page, results); assert.equal((await snapshot(page)).observations.length, 7); ok("two-device assignment → results flow, coordinator coverage preserved, duplicate skipped");
  const different = structuredClone(results); different.observations[0].record.comment = "Другая версия записи";
  await upload(page, different); data = await snapshot(page); assert.equal(data.observations.length, 8); assert.equal(data.observations.filter((r) => r.conflictOfId).length, 1);
  await upload(page, different); assert.equal((await snapshot(page)).observations.length, 8); ok("conflicting import keeps both versions, repeated conflict is idempotent");
  const bad = structuredClone(results); bad.observations[0].photos[0].dataURL = "bad image";
  await page.locator("#import-backup").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
  await page.locator("#global-error").waitFor({ state: "visible" }); assert.equal((await snapshot(page)).observations.length, 8); ok("malformed import makes no database changes");

  // Upgrade a real version-1 database without running the old application.
  const migration = await context({ serviceWorkers: "block" }), oldPage = await migration.newPage();
  await oldPage.goto(new URL("icons/icon.svg", base).href);
  await oldPage.evaluate(async () => {
    await new Promise((resolve, reject) => { const q = indexedDB.open("urban-accessibility-field-v1", 1); q.onupgradeneeded = () => { const db = q.result, rows = db.createObjectStore("observations", { keyPath: "id" }); rows.createIndex("observedAt", "observedAt"); rows.createIndex("status", "status"); db.createObjectStore("photos", { keyPath: "id" }).createIndex("observationId", "observationId"); }; q.onerror = () => reject(q.error); q.onsuccess = () => { const db = q.result, tx = db.transaction(["observations", "photos"], "readwrite"); tx.objectStore("observations").put({ id: "legacy", status: "READY", finding: "PRESENT", observedAt: "2025-01-01T12:00:00Z", latitude: 55.75, longitude: 37.61, contextType: "STREET", restrictionType: "RESTRICTED", alternativeAccess: "UNKNOWN", locationDescription: "Прежняя запись" }); tx.objectStore("photos").put({ id: "legacy-photo", observationId: "legacy", name: "old.png", blob: new Blob([new Uint8Array([1,2,3])], { type: "image/png" }) }); tx.oncomplete = () => { db.close(); resolve(); }; }; });
  });
  await oldPage.goto(base); await oldPage.locator("#legacy-panel summary").waitFor();
  const migrated = await snapshot(oldPage); assert.equal(migrated.observations[0].id, "legacy"); assert.equal(migrated.photos.length, 1); assert.equal(migrated.projects.length, 0); ok("IndexedDB v1 → v2 upgrade keeps legacy record and photo");
  await oldPage.locator("#welcome-create").click();
  for (const [selector, value] of Object.entries({ "#project-name": "Реальный тестовый маршрут", "#coordinator": "Координатор", "#origin": "Остановка", "#destination": "Вход", "#target-requirements": "Без ступеней", "#objective": "Проверить вход", "#project-parts": "Путь\nВход" })) await oldPage.locator(selector).fill(value);
  await oldPage.locator('#project-form button[type="submit"]').click(); await oldPage.locator("#project-form").waitFor({ state: "hidden" });
  await oldPage.locator("#legacy-panel summary").click(); await oldPage.locator(".legacy-form button").click();
  await oldPage.waitForFunction(async () => Boolean((await (await import("./src/db.js")).getObservation("legacy")).auditProjectId));
  assert.equal((await snapshot(oldPage)).photos.length, 1); ok("create real project and attach legacy observation without losing photo");
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.locator("#open-results").waitFor();
  await coordinator.setOffline(true); await page.goto(base + "?demo=1"); await page.locator("#open-results").waitFor(); await page.locator("#open-results").click(); await page.locator("#open-report").click(); await page.locator("#report-view").waitFor({ state: "visible" }); assert.equal(await page.locator("#report-content img").count(), 8); ok("cached application, demo URL, database and report work offline");
  await coordinator.setOffline(false);
  await oldPage.goto(new URL("tests.html", base).href); await oldPage.waitForFunction(() => document.documentElement.dataset.testStatus); assert.equal(await oldPage.locator("html").getAttribute("data-test-status"), "passed"); ok("13 existing domain and GPS tests pass");
  assert.deepEqual(errors, []); console.log(`PASS: ${checks} browser scenarios; no uncaught browser errors. Artifacts: ${out}`);
} finally { await browser.close(); }
