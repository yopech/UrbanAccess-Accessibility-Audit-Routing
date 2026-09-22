export const DB_NAME = "urban-accessibility-field-v1";
const DB_VERSION = 2;
let databasePromise;
export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("observations")) {
        const store = db.createObjectStore("observations", { keyPath: "id" });
        store.createIndex("observedAt", "observedAt");
        store.createIndex("status", "status");
      }
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" }).createIndex("observationId", "observationId");
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      // Keep every v1 observation and photo, including unattached records.
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = null; };
      resolve(db);
    };
    request.onerror = () => { databasePromise = null; reject(request.error); };
    request.onblocked = () => { databasePromise = null; reject(new Error("Закройте другие вкладки UrbanAccess и перезагрузите страницу для обновления хранилища.")); };
  });
  return databasePromise;
}
function result(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function done(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error("Сохранение отменено")); }); }
async function all(store) { const db = await openDatabase(); return result(db.transaction(store).objectStore(store).getAll()); }
export const getAllObservations = () => all("observations");
export const getAllProjects = () => all("projects");
export async function getObservation(id) { const db = await openDatabase(); return result(db.transaction("observations").objectStore("observations").get(id)); }
export async function getObservationPhotos(id) { const db = await openDatabase(); return result(db.transaction("photos").objectStore("photos").index("observationId").getAll(IDBKeyRange.only(id))); }
export async function getSnapshot() {
  const db = await openDatabase(), tx = db.transaction(["projects", "observations", "photos"]);
  const [projects, observations, photos] = await Promise.all(["projects", "observations", "photos"].map((s) => result(tx.objectStore(s).getAll())));
  return { projects, observations, photos };
}
export async function saveProject(project) { const db = await openDatabase(), tx = db.transaction("projects", "readwrite"), completion = done(tx); tx.objectStore("projects").put(project); await completion; }
export async function saveRecords(records) { const db = await openDatabase(), tx = db.transaction("observations", "readwrite"), completion = done(tx); records.forEach((r) => tx.objectStore("observations").put(r)); await completion; }
export async function saveObservation(record, photos) {
  const db = await openDatabase(), tx = db.transaction(["observations", "photos"], "readwrite"), completion = done(tx);
  tx.objectStore("observations").put(record);
  const store = tx.objectStore("photos"), keys = store.index("observationId").getAllKeys(IDBKeyRange.only(record.id));
  keys.onsuccess = () => {
    keys.result.forEach((k) => store.delete(k));
    photos.forEach((p, i) => store.put({ ...p, id: `${record.id}:photo:${i}`, observationId: record.id }));
  };
  await completion;
}
export async function applyImport(plan) {
  const db = await openDatabase(), tx = db.transaction(["projects", "observations", "photos"], "readwrite"), completion = done(tx);
  plan.projects.forEach((p) => tx.objectStore("projects").put(p));
  plan.observations.forEach(({ record, photos }) => {
    tx.objectStore("observations").put(record);
    photos.forEach((p, i) => tx.objectStore("photos").put({ ...p, id: `${record.id}:photo:${i}`, observationId: record.id }));
  });
  await completion;
}
export async function deleteObservation(id) {
  const db = await openDatabase(), tx = db.transaction(["observations", "photos"], "readwrite"), completion = done(tx);
  tx.objectStore("observations").delete(id);
  const store = tx.objectStore("photos"), keys = store.index("observationId").getAllKeys(IDBKeyRange.only(id));
  keys.onsuccess = () => keys.result.forEach((key) => store.delete(key));
  await completion;
}
