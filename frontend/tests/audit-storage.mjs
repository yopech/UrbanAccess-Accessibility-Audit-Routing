import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const build = await mkdtemp(path.join(tmpdir(), "urbanaccess-storage-"));
const checks = [];
let browser;
let server;
try {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    "--project", path.join(root, "frontend/tsconfig.storage.json"), "--outDir", build], { stdio: "inherit" });
  const fixture = await readFile(new URL("./audit-storage.fixture.mjs", import.meta.url));
  server = createServer(async (request, response) => {
    try {
      if (request.url === "/") { response.setHeader("content-type", "text/html"); response.end("<!doctype html><title>Storage tests</title>"); return; }
      if (request.url === "/fixture.mjs") { response.setHeader("content-type", "text/javascript"); response.end(fixture); return; }
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (!/^\/(?:domain|storage)\/[a-z-]+\.js$/.test(pathname)) { response.writeHead(404); response.end(); return; }
      const data = await readFile(path.join(build, pathname));
      response.setHeader("content-type", "text/javascript"); response.end(data);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const errors = [];
  async function page() {
    const p = await context.newPage();
    p.on("pageerror", (error) => errors.push(error.message));
    await p.goto(base);
    await p.evaluate(async () => { window.h = await import("/fixture.mjs"); });
    return p;
  }
  async function check(label, fn) { await fn(); checks.push(label); console.log(`PASS ${checks.length}: ${label}`); }
  const first = await page();
  const second = await page();

  await check("fresh v3 database has exact keys and indexes", async () => {
    const result = await first.evaluate(async () => {
      const db = new h.AuditDatabase({ name: "fresh" }); h.managers.push(db);
      const connection = await db.open();
      return { version: connection.version, schema: await h.inspectSchema(connection), count: (await h.readAll(connection, "audits")).length };
    });
    assert.equal(result.version, 3); assert.equal(result.count, 0);
    assert.equal(Object.keys(result.schema).length, 10);
    assert.deepEqual(Object.keys(result.schema.audits.indexes).sort(), ["objectId", "status", "updatedAt"]);
    assert.deepEqual(Object.keys(result.schema.auditPhotos.indexes).sort(), ["auditId", "elementId"]);
    assert.deepEqual(Object.keys(result.schema.auditEvents.indexes).sort(), ["auditId_revision", "transactionId"]);
    assert.deepEqual(result.schema.auditEvents.indexes.auditId_revision.keyPath, ["auditId", "revision"]);
    assert.deepEqual(result.schema.auditDocuments.indexes.auditId_createdAt.keyPath, ["auditId", "createdAt"]);
    assert.deepEqual(Object.keys(result.schema.auditVoiceDrafts.indexes).sort(), ["auditId", "elementId", "sessionId"]);
    for (const name of ["auditTemplates", "auditRuleSets"]) {
      assert.deepEqual(result.schema[name].keyPath, ["id", "version"]);
      assert.deepEqual(Object.keys(result.schema[name].indexes), ["id"]);
    }
  });

  await check("AC-19: v2 migration preserves records, Blob bytes, orphan photos and custom index", async () => {
    const result = await first.evaluate(async () => {
      const legacy = await h.seedLegacy("legacy-v2");
      const before = await h.legacySnapshot(legacy); const oldSchema = await h.inspectSchema(legacy); legacy.close();
      const manager = new h.AuditDatabase({ name: "legacy-v2" }); h.managers.push(manager);
      const migrated = await manager.open();
      return { before, after: await h.legacySnapshot(migrated), oldSchema, newSchema: await h.inspectSchema(migrated) };
    });
    assert.deepEqual(result.before, result.after);
    for (const name of ["observations", "photos", "projects"]) assert.deepEqual(result.oldSchema[name], result.newSchema[name]);
  });

  await check("v1 migration preserves existing stores and creates missing projects", async () => {
    const result = await first.evaluate(async () => {
      const legacy = await h.seedLegacy("legacy-v1", 1); const before = await h.legacySnapshot(legacy); legacy.close();
      const manager = new h.AuditDatabase({ name: "legacy-v1" }); h.managers.push(manager);
      const connection = await manager.open(); return { before, after: await h.legacySnapshot(connection), version: connection.version };
    });
    assert.deepEqual(result.before, result.after); assert.equal(result.version, 3);
  });

  await check("create/load/list commit audit and event together; revision increments once per batch", async () => {
    const result = await first.evaluate(async () => {
      const { store, database } = h.createStore("basic");
      const created = await store.commit(h.envelope([{ type: "create", title: "Вход" }]));
      const updated = await store.commit(h.envelope([{ type: "rename", title: "Дверь" }, { type: "increment" }], 1));
      return { created, updated, loaded: await store.load(h.auditId), list: await store.list(),
        missing: await store.load(h.objectId), events: await h.readAll(await database.open(), "auditEvents") };
    });
    assert.equal(result.created.value.revision, 1); assert.equal(result.updated.value.revision, 2);
    assert.equal(result.loaded.title, "Дверь"); assert.equal(result.loaded.count, 1); assert.equal(result.list.length, 1);
    assert.equal(result.missing, undefined);
    assert.deepEqual(result.events.sort((a, b) => a.revision - b.revision).map((e) => [e.previousRevision, e.revision]), [[0, 1], [1, 2]]);
  });

  await check("AC-15: two real pages commit same revision; only one wins and loser reducer never runs", async () => {
    await first.evaluate(async () => { window.race = h.createStore("race"); await race.store.commit(h.envelope([{ type: "create", title: "Original" }])); });
    await second.evaluate(() => { window.race = h.createStore("race"); });
    const results = await Promise.all([first, second].map((p, i) => p.evaluate((title) => race.store.commit(h.envelope([{ type: "rename", title }], 1)), `Tab ${i}`)));
    assert.deepEqual(results.map((r) => r.kind).sort(), ["committed", "conflict"]);
    const winner = results.find((r) => r.kind === "committed"); const loser = results.find((r) => r.kind === "conflict");
    assert.deepEqual(loser.current, winner.value); assert.equal(loser.expectedRevision, 1);
    const record = await first.evaluate(async () => ({ value: await race.store.load(h.auditId), events: await h.readAll(await race.database.open(), "auditEvents") }));
    assert.deepEqual(record.value, winner.value); assert.equal(record.events.length, 2);
    const reductions = await Promise.all([first, second].map((p) => p.evaluate(() => race.statistics.reductions)));
    assert.equal(reductions[0] + reductions[1], 2);
  });

  await check("concurrency remains safe without BroadcastChannel; concurrent creation has one winner", async () => {
    const result = await first.evaluate(async () => {
      const a = h.createStore("no-channel", { messaging: false }); const b = h.createStore("no-channel", { messaging: false });
      const creation = await Promise.all([a.store.commit(h.envelope([{ type: "create", title: "A" }])), b.store.commit(h.envelope([{ type: "create", title: "B" }]))]);
      const updates = await Promise.all([a.store.commit(h.envelope([{ type: "increment" }], 1)), b.store.commit(h.envelope([{ type: "increment" }], 1))]);
      return { creation, updates, events: await h.readAll(await a.database.open(), "auditEvents"), value: await a.store.load(h.auditId) };
    });
    for (const pair of [result.creation, result.updates]) assert.deepEqual(pair.map((r) => r.kind).sort(), ["committed", "conflict"]);
    assert.equal(result.events.length, 2); assert.equal(result.value.count, 1);
  });

  await check("errors and DataCloneError roll back audit and event with no success notifications", async () => {
    const result = await first.evaluate(async () => {
      const entry = h.createStore("failures", { messaging: false }); const seen = [];
      entry.store.subscribe((id, revision) => seen.push([id, revision]));
      await entry.store.commit(h.envelope([{ type: "create", title: "Keep" }]));
      const outcomes = [];
      for (const type of ["throw", "bad-id", "uncloneable"]) outcomes.push(await entry.store.commit(h.envelope([{ type }], 1)));
      outcomes.push(await entry.store.commit(h.envelope([{ type: "rename", title: "Missing" }], 5, h.uuid(), h.objectId)));
      return { outcomes, value: await entry.store.load(h.auditId), events: await h.readAll(await entry.database.open(), "auditEvents"), seen };
    });
    assert.deepEqual(result.outcomes.map((r) => r.kind), ["failed", "failed", "failed", "failed"]);
    assert.equal(result.outcomes[2].code, "DATA_CLONE_FAILED"); assert.equal(result.outcomes[3].code, "NOT_FOUND");
    assert.equal(result.value.revision, 1); assert.equal(result.value.title, "Keep"); assert.equal(result.events.length, 1); assert.equal(result.seen.length, 1);
  });

  await check("duplicate transaction aborts both queued writes", async () => {
    const result = await first.evaluate(async () => {
      const entry = h.createStore("duplicate", { messaging: false }); const id = h.uuid();
      await entry.store.commit(h.envelope([{ type: "create", title: "Original" }], 0, id));
      const failed = await entry.store.commit(h.envelope([{ type: "rename", title: "Overwrite" }], 1, id));
      return { failed, value: await entry.store.load(h.auditId), events: await h.readAll(await entry.database.open(), "auditEvents") };
    });
    assert.equal(result.failed.code, "DUPLICATE_TRANSACTION"); assert.equal(result.value.revision, 1); assert.equal(result.value.title, "Original"); assert.equal(result.events.length, 1);
  });

  await check("notifications happen after complete and carry committed metadata only", async () => {
    await second.evaluate(() => {
      window.remote = h.createStore("notifications"); window.remoteSeen = [];
      remote.store.subscribe((id, revision) => { void remote.store.load(id).then((value) => remoteSeen.push({ revision, value })); });
    });
    const result = await first.evaluate(async () => {
      const monitor = h.monitorNotifications(); const entry = h.createStore("notifications"); const seen = [];
      entry.store.subscribe((id, revision) => { void entry.store.load(id).then((value) => seen.push({ revision, value })); });
      entry.store.subscribe(() => { throw new Error("Subscriber failure"); });
      const outcome = await entry.store.commit(h.envelope([{ type: "create", title: "Visible" }]));
      window.localSeen = seen; window.localMonitor = monitor; return outcome;
    });
    assert.equal(result.kind, "committed");
    await first.waitForFunction(() => localSeen.length === 1 && h.broadcasts.length >= 1);
    await second.waitForFunction(() => remoteSeen.length === 1);
    assert.equal((await second.evaluate(() => remoteSeen[0])).value.title, "Visible");
    const messages = await first.evaluate(() => h.broadcasts.filter((m) => m.auditId === h.auditId));
    assert.ok(messages.length >= 1); assert.deepEqual(Object.keys(messages.at(-1)).sort(), ["auditId", "revision", "tabId", "transactionId", "type"]);
    await first.evaluate(() => localMonitor.close());
  });

  await check("blocked upgrade rejects; late request does not migrate after rejection; retry succeeds", async () => {
    const result = await first.evaluate(async () => {
      const blocker = await h.seedLegacy("blocked"); let blocked = 0;
      const manager = new h.AuditDatabase({ name: "blocked", onBlocked: () => blocked++ }); h.managers.push(manager);
      let code; try { await manager.open(); } catch (error) { code = error.code; }
      blocker.close();
      const unchanged = await h.rawDatabase("blocked"); const version = unchanged.version; unchanged.close();
      const upgraded = await manager.open(); return { blocked, code, version, upgraded: upgraded.version };
    });
    assert.equal(result.blocked, 1); assert.equal(result.code, "UPGRADE_BLOCKED"); assert.equal(result.version, 2); assert.equal(result.upgraded, 3);
  });

  await check("versionchange automatically closes connection, permits upgrade and rejects stale code", async () => {
    const result = await first.evaluate(async () => {
      let changes = 0;
      const manager = new h.AuditDatabase({ name: "versionchange", onVersionChange: () => changes++ }); h.managers.push(manager);
      await manager.open(); const newer = await h.rawDatabase("versionchange", 4); newer.close();
      let code; try { await manager.open(); } catch (error) { code = error.code; } return { changes, code };
    });
    assert.equal(result.changes, 1); assert.equal(result.code, "VERSION_MISMATCH");
  });

  await check("failed schema upgrade rolls back to v2 and preserves legacy bytes", async () => {
    const result = await first.evaluate(async () => {
      const legacy = await h.seedLegacy("bad-schema", 2, true); const before = await h.legacySnapshot(legacy); legacy.close();
      const manager = new h.AuditDatabase({ name: "bad-schema" }); h.managers.push(manager);
      let code; try { await manager.open(); } catch (error) { code = error.code; }
      const db = await h.rawDatabase("bad-schema"); const after = await h.legacySnapshot(db); const names = [...db.objectStoreNames]; const version = db.version; db.close();
      return { code, before, after, names, version };
    });
    assert.equal(result.code, "SCHEMA_MISMATCH"); assert.equal(result.version, 2); assert.deepEqual(result.before, result.after); assert.ok(!result.names.includes("auditEvents"));
  });

  await check("close while opening cancels upgrade; explicit close and reopen are safe", async () => {
    const result = await first.evaluate(async () => {
      const manager = new h.AuditDatabase({ name: "cancelled" }); h.managers.push(manager);
      const pending = manager.open(); manager.close(); let code; try { await pending; } catch (error) { code = error.code; }
      const opened = await manager.open(); const version = opened.version; manager.close();
      return { code, version, reopened: (await manager.open()).version };
    });
    assert.equal(result.code, "CLOSED"); assert.equal(result.version, 3); assert.equal(result.reopened, 3);
  });

  await check("invalid requests, promise reducer and disposed store cannot persist data", async () => {
    const result = await first.evaluate(async () => {
      const entry = h.createStore("invalid", { messaging: false });
      const invalid = await entry.store.commit({ ...h.envelope([{ type: "create", title: "No" }]), expectedRevision: -1 });
      const empty = await entry.store.commit(h.envelope([]));
      const asyncEntry = h.createStore("async-reducer", { messaging: false, reduce: async () => { throw new Error("Async reducer rejected"); } });
      const promise = await asyncEntry.store.commit(h.envelope([{ type: "create", title: "No" }]));
      const asyncValidation = h.createStore("async-validation", { messaging: false, validate: async () => { throw new Error("Async validation rejected"); } });
      const validation = await asyncValidation.store.commit(h.envelope([{ type: "create", title: "No" }]));
      entry.store.close(); const closed = await entry.store.commit(h.envelope([{ type: "create", title: "No" }]));
      return { invalid, empty, promise, validation, closed, events: await h.readAll(await entry.database.open(), "auditEvents"),
        asyncAudits: await h.readAll(await asyncEntry.database.open(), "audits"),
        validationAudits: await h.readAll(await asyncValidation.database.open(), "audits") };
    });
    assert.equal(result.invalid.code, "INVALID_REQUEST"); assert.equal(result.empty.code, "INVALID_REQUEST");
    assert.equal(result.promise.code, "REDUCER_FAILED"); assert.equal(result.validation.code, "INVALID_RECORD");
    assert.equal(result.closed.code, "CLOSED"); assert.equal(result.events.length, 0);
    assert.equal(result.asyncAudits.length, 0); assert.equal(result.validationAudits.length, 0);
  });

  await check("unsubscribe and channel failure do not affect persisted commit", async () => {
    const result = await first.evaluate(async () => {
      const database = new h.AuditDatabase({ name: "channel-failure" }); h.managers.push(database);
      const store = new h.AuditStore({ database, channelFactory: () => { throw new Error("Unavailable"); },
        reduce: (_, commands, context) => ({ id: context.auditId, objectId: h.objectId, revision: context.revision,
          schemaVersion: 1, status: "draft", updatedAt: context.committedAt, title: commands[0].title }) }); h.stores.push(store);
      let calls = 0; const unsubscribe = store.subscribe(() => calls++); unsubscribe();
      const outcome = await store.commit(h.envelope([{ type: "create", title: "Saved" }]));
      return { outcome, calls, value: await store.load(h.auditId) };
    });
    assert.equal(result.outcome.kind, "committed"); assert.equal(result.calls, 0); assert.equal(result.value.title, "Saved");
  });

  assert.deepEqual(errors, []);
  await first.evaluate(() => h.cleanup()); await second.evaluate(() => h.cleanup());
  console.log(`PASS ${checks.length} storage groups; native IndexedDB and real pages; no browser errors.`);
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(build, { recursive: true, force: true });
}
