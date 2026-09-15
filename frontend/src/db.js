const DB_NAME = "urban-accessibility-field-v1";
const DB_VERSION = 1;

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Транзакция отменена"));
  });
}

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("observations")) {
        const observations = database.createObjectStore("observations", { keyPath: "id" });
        observations.createIndex("observedAt", "observedAt");
        observations.createIndex("status", "status");
      }
      if (!database.objectStoreNames.contains("photos")) {
        const photos = database.createObjectStore("photos", { keyPath: "id" });
        photos.createIndex("observationId", "observationId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

export async function saveObservation(observation, photos) {
  const database = await openDatabase();
  const transaction = database.transaction(["observations", "photos"], "readwrite");
  transaction.objectStore("observations").put(observation);

  const photoStore = transaction.objectStore("photos");
  const index = photoStore.index("observationId");
  const keysRequest = index.getAllKeys(IDBKeyRange.only(observation.id));
  keysRequest.onsuccess = () => {
    for (const key of keysRequest.result) photoStore.delete(key);
    for (const photo of photos) photoStore.put({ ...photo, observationId: observation.id });
  };

  await transactionDone(transaction);
}

export async function getObservation(id) {
  const database = await openDatabase();
  const transaction = database.transaction("observations", "readonly");
  return requestResult(transaction.objectStore("observations").get(id));
}

export async function getAllObservations() {
  const database = await openDatabase();
  const transaction = database.transaction("observations", "readonly");
  const observations = await requestResult(transaction.objectStore("observations").getAll());
  return observations.sort((a, b) => new Date(b.observedAt || b.createdAt) - new Date(a.observedAt || a.createdAt));
}

export async function getObservationPhotos(observationId) {
  const database = await openDatabase();
  const transaction = database.transaction("photos", "readonly");
  return requestResult(transaction.objectStore("photos").index("observationId").getAll(IDBKeyRange.only(observationId)));
}

export async function deleteObservation(id) {
  const database = await openDatabase();
  const transaction = database.transaction(["observations", "photos"], "readwrite");
  transaction.objectStore("observations").delete(id);
  const photoStore = transaction.objectStore("photos");
  const keysRequest = photoStore.index("observationId").getAllKeys(IDBKeyRange.only(id));
  keysRequest.onsuccess = () => {
    for (const key of keysRequest.result) photoStore.delete(key);
  };
  await transactionDone(transaction);
}
