import { asStorageError, StorageError } from "../domain/contracts.js";

export const DATABASE_NAME = "urban-accessibility-field-v1";
export const DATABASE_VERSION = 3;

export const AUDIT_STORES = {
  audits: "audits",
  photos: "auditPhotos",
  events: "auditEvents",
  documents: "auditDocuments",
  voiceDrafts: "auditVoiceDrafts",
  templates: "auditTemplates",
  ruleSets: "auditRuleSets",
} as const;

interface IndexDefinition {
  readonly name: string;
  readonly keyPath: string | readonly string[];
}

interface StoreDefinition {
  readonly name: string;
  readonly keyPath: string | readonly string[];
  readonly indexes: readonly IndexDefinition[];
}

const auditSchema: readonly StoreDefinition[] = [
  { name: AUDIT_STORES.audits, keyPath: "id", indexes: [
    { name: "updatedAt", keyPath: "updatedAt" },
    { name: "status", keyPath: "status" },
    { name: "objectId", keyPath: "objectId" },
  ] },
  { name: AUDIT_STORES.photos, keyPath: "id", indexes: [
    { name: "auditId", keyPath: "auditId" },
    { name: "elementId", keyPath: "elementId" },
  ] },
  { name: AUDIT_STORES.events, keyPath: "id", indexes: [
    { name: "auditId_revision", keyPath: ["auditId", "revision"] },
    { name: "transactionId", keyPath: "transactionId" },
  ] },
  { name: AUDIT_STORES.documents, keyPath: "id", indexes: [
    { name: "auditId_createdAt", keyPath: ["auditId", "createdAt"] },
  ] },
  { name: AUDIT_STORES.voiceDrafts, keyPath: "id", indexes: [
    { name: "auditId", keyPath: "auditId" },
    { name: "elementId", keyPath: "elementId" },
    { name: "sessionId", keyPath: "sessionId" },
  ] },
  { name: AUDIT_STORES.templates, keyPath: ["id", "version"], indexes: [
    { name: "id", keyPath: "id" },
  ] },
  { name: AUDIT_STORES.ruleSets, keyPath: ["id", "version"], indexes: [
    { name: "id", keyPath: "id" },
  ] },
];

export interface DatabaseOptions {
  readonly name?: string;
  readonly factory?: IDBFactory;
  readonly onBlocked?: (event: IDBVersionChangeEvent) => void;
  readonly onVersionChange?: (event: IDBVersionChangeEvent) => void;
  readonly onClose?: () => void;
}

function safelyNotify(callback: (() => void) | undefined): void {
  try { callback?.(); } catch { /* Notification failures cannot change storage outcomes. */ }
}

function sameKeyPath(actual: string | string[] | null, expected: string | readonly string[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function checkStore(store: IDBObjectStore, definition: StoreDefinition): void {
  if (!sameKeyPath(store.keyPath, definition.keyPath) || store.autoIncrement) {
    throw new StorageError("SCHEMA_MISMATCH", `Несовместимая схема хранилища ${definition.name}.`, false);
  }
  for (const indexDefinition of definition.indexes) {
    if (!store.indexNames.contains(indexDefinition.name)) {
      throw new StorageError("SCHEMA_MISMATCH", `Не найден индекс ${definition.name}.${indexDefinition.name}.`, false);
    }
    const index = store.index(indexDefinition.name);
    if (!sameKeyPath(index.keyPath, indexDefinition.keyPath) || index.unique || index.multiEntry) {
      throw new StorageError("SCHEMA_MISMATCH", `Несовместимый индекс ${definition.name}.${indexDefinition.name}.`, false);
    }
  }
}

function upgradeSchema(database: IDBDatabase, transaction: IDBTransaction): void {
  // Existing legacy stores and their records/indexes are never modified.
  if (!database.objectStoreNames.contains("observations")) {
    const store = database.createObjectStore("observations", { keyPath: "id" });
    store.createIndex("observedAt", "observedAt");
    store.createIndex("status", "status");
  }
  if (!database.objectStoreNames.contains("photos")) {
    database.createObjectStore("photos", { keyPath: "id" }).createIndex("observationId", "observationId");
  }
  if (!database.objectStoreNames.contains("projects")) {
    database.createObjectStore("projects", { keyPath: "id" });
  }
  for (const definition of auditSchema) {
    const store = database.objectStoreNames.contains(definition.name)
      ? transaction.objectStore(definition.name)
      : database.createObjectStore(definition.name, { keyPath: Array.isArray(definition.keyPath)
        ? [...definition.keyPath] : definition.keyPath as string });
    for (const index of definition.indexes) {
      if (!store.indexNames.contains(index.name)) {
        store.createIndex(index.name, Array.isArray(index.keyPath) ? [...index.keyPath] : index.keyPath as string);
      }
    }
    checkStore(store, definition);
  }
}

export class AuditDatabase {
  private connection: IDBDatabase | undefined;
  private opening: Promise<IDBDatabase> | undefined;
  private cancelOpening: (() => void) | undefined;
  private readonly options: DatabaseOptions;

  constructor(options: DatabaseOptions = {}) {
    this.options = options;
  }

  open(): Promise<IDBDatabase> {
    if (this.connection) return Promise.resolve(this.connection);
    if (this.opening) return this.opening;
    const factory = this.options.factory ?? globalThis.indexedDB;
    if (!factory) {
      return Promise.reject(new StorageError("UNAVAILABLE", "IndexedDB недоступна в этом браузере.", false));
    }
    let cancel: (() => void) | undefined;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      let upgradeError: StorageError | undefined;
      const fail = (error: StorageError): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      cancel = () => fail(new StorageError("CLOSED", "Открытие хранилища отменено.", true));
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(this.options.name ?? DATABASE_NAME, DATABASE_VERSION);
      } catch (error) {
        fail(asStorageError(error, "OPEN_FAILED"));
        return;
      }
      request.onblocked = (event) => {
        fail(new StorageError("UPGRADE_BLOCKED", "Закройте другие вкладки UrbanAccess и повторите открытие.", true));
        safelyNotify(() => this.options.onBlocked?.(event));
      };
      request.onupgradeneeded = () => {
        const transaction = request.transaction;
        if (!transaction) {
          upgradeError = new StorageError("SCHEMA_MISMATCH", "Не создана транзакция обновления базы.", false);
          return;
        }
        // A blocked/cancelled request can fire later. Never migrate after rejecting it.
        if (settled) { transaction.abort(); return; }
        try { upgradeSchema(request.result, transaction); }
        catch (error) {
          upgradeError = asStorageError(error, "SCHEMA_MISMATCH");
          transaction.abort();
        }
      };
      request.onerror = () => fail(upgradeError ?? asStorageError(request.error, "OPEN_FAILED"));
      request.onsuccess = () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        try {
          const transaction = database.transaction(auditSchema.map((definition) => definition.name), "readonly");
          for (const definition of auditSchema) checkStore(transaction.objectStore(definition.name), definition);
          for (const name of ["observations", "photos", "projects"]) {
            if (!database.objectStoreNames.contains(name)) {
              throw new StorageError("SCHEMA_MISMATCH", `Не найдено прежнее хранилище ${name}.`, false);
            }
          }
        } catch (error) {
          database.close();
          fail(asStorageError(error, "SCHEMA_MISMATCH"));
          return;
        }
        database.onversionchange = (event) => {
          if (this.connection === database) this.connection = undefined;
          database.close();
          safelyNotify(() => this.options.onVersionChange?.(event));
        };
        database.onclose = () => {
          if (this.connection === database) this.connection = undefined;
          safelyNotify(this.options.onClose);
        };
        this.connection = database;
        settled = true;
        resolve(database);
      };
    });
    this.opening = opening;
    this.cancelOpening = cancel;
    const clearPending = (): void => {
      if (this.opening !== opening) return;
      this.opening = undefined;
      this.cancelOpening = undefined;
    };
    void opening.then(clearPending, clearPending);
    return opening;
  }

  close(): void {
    this.cancelOpening?.();
    this.cancelOpening = undefined;
    this.opening = undefined;
    this.connection?.close();
    this.connection = undefined;
  }
}

const sharedDatabase = new AuditDatabase();
export function openDatabase(): Promise<IDBDatabase> { return sharedDatabase.open(); }
export function closeDatabase(): void { sharedDatabase.close(); }
