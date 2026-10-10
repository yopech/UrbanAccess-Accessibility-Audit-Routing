export type UUID = string;
export type ISODateTime = string;
export type LocalDate = string;
export type Revision = number;

export interface Actor {
  id: UUID;
  name: string;
}

export interface Confirmation {
  by: Actor;
  at: ISODateTime;
  valueRevision: Revision;
}

export interface VersionRef {
  id: string;
  version: string;
}

export interface CommitEnvelope<C> {
  auditId: UUID;
  expectedRevision: Revision;
  transactionId: UUID;
  actor: Actor;
  commands: readonly C[];
}

export type CommitResult<T> =
  | { kind: "committed"; value: T; transactionId: UUID }
  | { kind: "conflict"; current: T; expectedRevision: Revision }
  | { kind: "failed"; code: string; recoverable: boolean };

export type SaveState =
  | { kind: "saved"; revision: Revision; at: ISODateTime }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "conflict"; localRevision: Revision; remoteRevision: Revision };

export type StorageErrorCode =
  | "UNAVAILABLE"
  | "OPEN_FAILED"
  | "UPGRADE_BLOCKED"
  | "SCHEMA_MISMATCH"
  | "VERSION_MISMATCH"
  | "CLOSED"
  | "INVALID_REQUEST"
  | "INVALID_RECORD"
  | "NOT_FOUND"
  | "DUPLICATE_TRANSACTION"
  | "REDUCER_FAILED"
  | "DATA_CLONE_FAILED"
  | "QUOTA_EXCEEDED"
  | "TRANSACTION_ABORTED";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly recoverable: boolean;

  constructor(
    code: StorageErrorCode,
    message: string,
    recoverable: boolean,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "StorageError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export function asStorageError(
  cause: unknown,
  fallback: StorageErrorCode = "TRANSACTION_ABORTED",
): StorageError {
  if (cause instanceof StorageError) return cause;
  const name = cause instanceof Error || cause instanceof DOMException ? cause.name : "";
  if (name === "QuotaExceededError") {
    return new StorageError("QUOTA_EXCEEDED", "Недостаточно места для сохранения данных.", true, cause);
  }
  if (name === "DataCloneError") {
    return new StorageError("DATA_CLONE_FAILED", "Данные не поддерживают безопасное сохранение.", false, cause);
  }
  if (name === "VersionError") {
    return new StorageError("VERSION_MISMATCH", "Открыта более новая версия базы. Обновите приложение.", false, cause);
  }
  return new StorageError(fallback, "Операция с локальным хранилищем не завершена.", true, cause);
}
