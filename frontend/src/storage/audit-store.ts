import {
  asStorageError,
  StorageError,
  type Actor,
  type CommitEnvelope,
  type CommitResult,
  type ISODateTime,
  type Revision,
  type UUID,
} from "../domain/contracts.js";
import { AUDIT_STORES, AuditDatabase } from "./database.js";

export const AUDIT_SYNC_CHANNEL = "urbanaccess_audit_sync";

export interface StoredAudit {
  id: UUID;
  objectId: UUID;
  schemaVersion: number;
  revision: Revision;
  status: string;
  updatedAt: ISODateTime;
}

export interface ReductionContext {
  readonly auditId: UUID;
  readonly actor: Readonly<Actor>;
  readonly transactionId: UUID;
  readonly revision: Revision;
  readonly committedAt: ISODateTime;
}

export interface AuditEvent<C> {
  id: UUID;
  auditId: UUID;
  revision: Revision;
  previousRevision: Revision;
  transactionId: UUID;
  actor: Actor;
  committedAt: ISODateTime;
  commands: readonly C[];
}

export interface AuditStoreOptions<T extends StoredAudit, C> {
  readonly database?: AuditDatabase;
  readonly reduce: (current: Readonly<T> | undefined, commands: readonly C[], context: ReductionContext) => T;
  readonly normalize?: (value: T) => T;
  readonly validate?: (value: Readonly<T>) => void;
  readonly transactionStores?: readonly string[];
  readonly writeTransaction?: (transaction: IDBTransaction, current: T | undefined, value: T, commands: readonly C[], abort: (cause: unknown) => void) => void;
  readonly eventCommands?: (commands: readonly C[]) => readonly unknown[];
  readonly now?: () => ISODateTime;
  readonly tabId?: UUID;
  readonly channelFactory?: ((name: string) => BroadcastChannel) | null;
}

type AuditListener = (auditId: UUID, revision: Revision) => void;

interface SyncMessage {
  type: "audit-committed";
  auditId: UUID;
  revision: Revision;
  transactionId: UUID;
  tabId: UUID;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isUUID(value: unknown): value is UUID {
  return typeof value === "string" && uuidPattern.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSynchronous(value: unknown, code: "INVALID_RECORD" | "REDUCER_FAILED"): void {
  if (isRecord(value) && typeof value.then === "function") {
    // Observe rejection without awaiting or extending the IndexedDB transaction.
    void Promise.resolve(value).catch(() => undefined);
    throw new StorageError(code, "Применение команд и проверка данных должны быть синхронными.", false);
  }
}

function isRevision(value: unknown, minimum: number): value is Revision {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isDateTime(value: unknown): value is ISODateTime {
  return typeof value === "string" && isoPattern.test(value) && Number.isFinite(Date.parse(value));
}

function assertStoredAudit(value: unknown): asserts value is StoredAudit {
  if (!isRecord(value) || !isUUID(value.id) || !isUUID(value.objectId)
    || !isRevision(value.revision, 1) || !isRevision(value.schemaVersion, 1)
    || typeof value.status !== "string" || !value.status.trim() || !isDateTime(value.updatedAt)) {
    throw new StorageError("INVALID_RECORD", "Некорректная запись обследования.", false);
  }
}

function assertEnvelope<C>(request: CommitEnvelope<C>): void {
  if (!isRecord(request) || !isUUID(request.auditId) || !isUUID(request.transactionId)
    || !isRevision(request.expectedRevision, 0) || !isRecord(request.actor)
    || !isUUID(request.actor.id) || typeof request.actor.name !== "string" || !request.actor.name.trim()
    || !Array.isArray(request.commands) || request.commands.length === 0) {
    throw new StorageError("INVALID_REQUEST", "Некорректный запрос сохранения.", false);
  }
}

function isSyncMessage(value: unknown): value is SyncMessage {
  return isRecord(value) && value.type === "audit-committed" && isUUID(value.auditId)
    && isRevision(value.revision, 1) && isUUID(value.transactionId) && isUUID(value.tabId);
}

export class AuditStore<T extends StoredAudit, C> {
  private readonly database: AuditDatabase;
  private readonly ownsDatabase: boolean;
  private readonly options: AuditStoreOptions<T, C>;
  private readonly tabId: UUID;
  private readonly listeners = new Set<AuditListener>();
  private readonly channel: BroadcastChannel | undefined;
  private disposed = false;

  constructor(options: AuditStoreOptions<T, C>) {
    this.options = options;
    this.database = options.database ?? new AuditDatabase();
    this.ownsDatabase = options.database === undefined;
    this.tabId = options.tabId ?? globalThis.crypto.randomUUID();
    if (!isUUID(this.tabId)) throw new StorageError("INVALID_REQUEST", "Некорректный идентификатор вкладки.", false);
    const factory = options.channelFactory === undefined
      ? (typeof globalThis.BroadcastChannel === "function" ? (name: string) => new BroadcastChannel(name) : null)
      : options.channelFactory;
    let channel: BroadcastChannel | undefined;
    try { channel = factory?.(AUDIT_SYNC_CHANNEL); }
    catch { /* Revision checks remain effective when messaging is unavailable. */ }
    this.channel = channel;
    if (channel) {
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (this.disposed || !isSyncMessage(event.data) || event.data.tabId === this.tabId) return;
        this.notify(event.data.auditId, event.data.revision);
      };
    }
  }

  private ensureOpen(): void {
    if (this.disposed) throw new StorageError("CLOSED", "Хранилище закрыто.", true);
  }

  private readRecord(value: unknown): T {
    assertStoredAudit(value);
    const record = this.options.normalize ? this.options.normalize(value as T) : value as T;
    requireSynchronous(this.options.validate?.(record), "INVALID_RECORD");
    return record;
  }

  private notify(auditId: UUID, revision: Revision): void {
    for (const listener of [...this.listeners]) {
      try { listener(auditId, revision); }
      catch { /* A subscriber cannot turn a committed write into a failed write. */ }
    }
  }

  async load(id: UUID): Promise<T | undefined> {
    this.ensureOpen();
    if (!isUUID(id)) throw new StorageError("INVALID_REQUEST", "Некорректный идентификатор обследования.", false);
    try {
      const database = await this.database.open();
      this.ensureOpen();
      return await new Promise<T | undefined>((resolve, reject) => {
        const transaction = database.transaction(AUDIT_STORES.audits, "readonly");
        let record: T | undefined;
        let error: StorageError | undefined;
        transaction.oncomplete = () => resolve(record);
        transaction.onabort = () => reject(error ?? asStorageError(transaction.error));
        transaction.onerror = () => { error ??= asStorageError(transaction.error); };
        const request = transaction.objectStore(AUDIT_STORES.audits).get(id);
        request.onerror = () => { error = asStorageError(request.error); };
        request.onsuccess = () => {
          try { if (request.result !== undefined) record = this.readRecord(request.result as unknown); }
          catch (cause) { error = asStorageError(cause, "INVALID_RECORD"); transaction.abort(); }
        };
      });
    } catch (error) { throw asStorageError(error); }
  }

  async list(): Promise<readonly T[]> {
    this.ensureOpen();
    try {
      const database = await this.database.open();
      this.ensureOpen();
      return await new Promise<readonly T[]>((resolve, reject) => {
        const transaction = database.transaction(AUDIT_STORES.audits, "readonly");
        let records: readonly T[] = [];
        let error: StorageError | undefined;
        transaction.oncomplete = () => resolve(records);
        transaction.onabort = () => reject(error ?? asStorageError(transaction.error));
        transaction.onerror = () => { error ??= asStorageError(transaction.error); };
        const request = transaction.objectStore(AUDIT_STORES.audits).getAll();
        request.onerror = () => { error = asStorageError(request.error); };
        request.onsuccess = () => {
          try { records = (request.result as unknown[]).map((value) => this.readRecord(value)); }
          catch (cause) { error = asStorageError(cause, "INVALID_RECORD"); transaction.abort(); }
        };
      });
    } catch (error) { throw asStorageError(error); }
  }

  async commit(input: CommitEnvelope<C>): Promise<CommitResult<T>> {
    try {
      this.ensureOpen();
      assertEnvelope(input);
      // Capture caller-owned data before awaiting database opening.
      const envelope = structuredClone(input);
      const committedAt = (this.options.now ?? (() => new Date().toISOString()))();
      if (!isDateTime(committedAt)) throw new StorageError("INVALID_REQUEST", "Некорректная дата операции.", false);
      const database = await this.database.open();
      this.ensureOpen();
      return await new Promise<CommitResult<T>>((resolve) => {
        const transaction = database.transaction([...new Set([AUDIT_STORES.audits, AUDIT_STORES.events, ...this.options.transactionStores ?? []])], "readwrite");
        let result: CommitResult<T> | undefined;
        let failure: StorageError | undefined;
        transaction.onabort = () => {
          const error = failure ?? asStorageError(transaction.error);
          resolve({ kind: "failed", code: error.code, recoverable: error.recoverable });
        };
        transaction.onerror = (event) => { failure ??= asStorageError((event.target as IDBRequest).error ?? transaction.error); };
        transaction.oncomplete = () => {
          if (!result) {
            resolve({ kind: "failed", code: "TRANSACTION_ABORTED", recoverable: true });
            return;
          }
          if (result.kind === "committed") {
            const message: SyncMessage = {
              type: "audit-committed", auditId: envelope.auditId, revision: result.value.revision,
              transactionId: envelope.transactionId, tabId: this.tabId,
            };
            this.notify(message.auditId, message.revision);
            try { this.channel?.postMessage(message); }
            catch { /* The database is committed even if the notification cannot be sent. */ }
          }
          resolve(result);
        };
        const audits = transaction.objectStore(AUDIT_STORES.audits);
        const events = transaction.objectStore(AUDIT_STORES.events);
        const get = audits.get(envelope.auditId);
        get.onerror = () => { failure ??= asStorageError(get.error); };
        get.onsuccess = () => {
          try {
            const current = get.result === undefined ? undefined : this.readRecord(get.result as unknown);
            if (current && current.revision !== envelope.expectedRevision) {
              result = { kind: "conflict", current, expectedRevision: envelope.expectedRevision };
              return;
            }
            if (!current && envelope.expectedRevision !== 0) {
              result = { kind: "failed", code: "NOT_FOUND", recoverable: false };
              return;
            }
            const previousRevision = current?.revision ?? 0;
            if (previousRevision === Number.MAX_SAFE_INTEGER) {
              throw new StorageError("INVALID_RECORD", "Достигнут предел номера редакции.", false);
            }
            const revision = previousRevision + 1;
            let reduced: T;
            try {
              reduced = this.options.reduce(current === undefined ? undefined : structuredClone(current), envelope.commands, {
                auditId: envelope.auditId, actor: Object.freeze({ ...envelope.actor }),
                transactionId: envelope.transactionId, revision, committedAt,
              });
            } catch (cause) { throw asStorageError(cause, "REDUCER_FAILED"); }
            requireSynchronous(reduced, "REDUCER_FAILED");
            if (!isRecord(reduced) || reduced.id !== envelope.auditId) {
              throw new StorageError("INVALID_RECORD", "Команда вернула некорректное обследование.", false);
            }
            const value = this.readRecord({ ...reduced, revision, updatedAt: committedAt });
            requireSynchronous(this.options.writeTransaction?.(transaction, current, value, envelope.commands, (cause) => { failure = asStorageError(cause); transaction.abort(); }), "REDUCER_FAILED");
            const event: AuditEvent<unknown> = {
              id: envelope.transactionId, auditId: envelope.auditId, revision, previousRevision,
              transactionId: envelope.transactionId, actor: envelope.actor, committedAt, commands: this.options.eventCommands?.(envelope.commands) ?? envelope.commands,
            };
            const eventWrite = events.add(event);
            eventWrite.onerror = () => {
              failure ??= eventWrite.error?.name === "ConstraintError"
                ? new StorageError("DUPLICATE_TRANSACTION", "Такая транзакция уже была сохранена.", false, eventWrite.error)
                : asStorageError(eventWrite.error);
            };
            const auditWrite = audits.put(value);
            auditWrite.onerror = () => { failure ??= asStorageError(auditWrite.error); };
            result = { kind: "committed", value, transactionId: envelope.transactionId };
          } catch (cause) {
            failure = asStorageError(cause);
            transaction.abort();
          }
        };
      });
    } catch (cause) {
      const error = asStorageError(cause);
      return { kind: "failed", code: error.code, recoverable: error.recoverable };
    }
  }

  subscribe(listener: AuditListener): () => void {
    this.ensureOpen();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.channel?.close();
    this.listeners.clear();
    if (this.ownsDatabase) this.database.close();
  }
}
