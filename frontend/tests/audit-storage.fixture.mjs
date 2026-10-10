import { AuditDatabase, DATABASE_VERSION } from "/storage/database.js";
import { AuditStore, AUDIT_SYNC_CHANNEL } from "/storage/audit-store.js";

export const actor = { id: "11111111-1111-4111-8111-111111111111", name: "Инспектор" };
export const auditId = "22222222-2222-4222-8222-222222222222";
export const objectId = "33333333-3333-4333-8333-333333333333";
export const uuid = () => crypto.randomUUID();
export const stores = [];
export const managers = [];
export const broadcasts = [];

export function createStore(name, { messaging = true, reduce, validate } = {}) {
  const database = new AuditDatabase({ name });
  managers.push(database);
  const statistics = { reductions: 0 };
  const store = new AuditStore({
    database,
    channelFactory: messaging ? (channel) => new BroadcastChannel(channel) : null,
    validate,
    reduce: reduce ?? ((current, commands, context) => {
      statistics.reductions++;
      let value = current;
      for (const command of commands) {
        if (command.type === "create") {
          value = { id: context.auditId, objectId, schemaVersion: 1, revision: context.revision,
            updatedAt: context.committedAt, status: "draft", title: command.title, count: 0 };
        } else if (command.type === "rename") {
          if (!value) throw new Error("No current audit");
          value = { ...value, title: command.title };
        } else if (command.type === "increment") {
          if (!value) throw new Error("No current audit");
          value = { ...value, count: value.count + 1 };
        } else if (command.type === "throw") {
          throw new Error("Rejected command");
        } else if (command.type === "uncloneable") {
          value = { ...value, callback: () => "cannot clone" };
        } else if (command.type === "bad-id") {
          value = { ...value, id: objectId };
        } else {
          throw new Error("Unknown command");
        }
      }
      return value;
    }),
  });
  stores.push(store);
  return { store, database, statistics };
}

export function envelope(commands, revision = 0, transactionId = uuid(), id = auditId) {
  return { auditId: id, expectedRevision: revision, transactionId, actor, commands };
}

export async function rawDatabase(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade?.(request.result, request.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function seedLegacy(name, version = 2, incompatible = false) {
  const database = await rawDatabase(name, version, (db) => {
    const observations = db.createObjectStore("observations", { keyPath: "id" });
    observations.createIndex("observedAt", "observedAt");
    observations.createIndex("status", "status");
    observations.createIndex("custom-legacy-index", "author", { unique: true });
    db.createObjectStore("photos", { keyPath: "id" }).createIndex("observationId", "observationId");
    if (version === 2) db.createObjectStore("projects", { keyPath: "id" });
    if (incompatible) db.createObjectStore("audits", { keyPath: "wrongKey" });
  });
  await new Promise((resolve, reject) => {
    const names = [...database.objectStoreNames].filter((name) => name !== "audits");
    const transaction = database.transaction(names, "readwrite");
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore("observations").put({ id: "legacy-observation", author: "Игорь",
      observedAt: "2026-09-16T12:46:32Z", status: "READY", note: "Сохранить без изменений" });
    transaction.objectStore("photos").put({ id: "legacy-photo", observationId: "legacy-observation",
      blob: new Blob([new Uint8Array([0, 17, 255, 42])], { type: "image/png" }) });
    transaction.objectStore("photos").put({ id: "orphan-photo", observationId: "missing",
      blob: new Blob(["orphan"], { type: "image/jpeg" }) });
    if (version === 2) transaction.objectStore("projects").put({ id: "legacy-project", title: "Маршрут" });
  });
  return database;
}

export async function readAll(database, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function inspectSchema(database) {
  const names = [...database.objectStoreNames];
  const transaction = database.transaction(names, "readonly");
  return Object.fromEntries(names.map((name) => {
    const store = transaction.objectStore(name);
    return [name, { keyPath: store.keyPath, indexes: Object.fromEntries([...store.indexNames].map((indexName) => {
      const index = store.index(indexName);
      return [indexName, { keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }];
    })) }];
  }));
}

export async function legacySnapshot(database) {
  const observations = await readAll(database, "observations");
  const projects = database.objectStoreNames.contains("projects") ? await readAll(database, "projects") : [];
  const photos = await readAll(database, "photos");
  return { observations, projects, photos: await Promise.all(photos.map(async ({ blob, ...rest }) => ({
    ...rest, type: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())],
  }))) };
}

export function monitorNotifications() {
  const channel = new BroadcastChannel(AUDIT_SYNC_CHANNEL);
  channel.onmessage = ({ data }) => broadcasts.push(data);
  return channel;
}

export function cleanup() {
  for (const store of stores) store.close();
  for (const database of managers) database.close();
}

export { AuditDatabase, AuditStore, DATABASE_VERSION };
