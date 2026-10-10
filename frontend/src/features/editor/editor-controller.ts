import type { Actor, CommitEnvelope, CommitResult, SaveState, UUID } from '../../domain/contracts.js';
import type { StoredAudit } from '../../storage/audit-store.js';

export interface EditorStore<T, C> {
  load(id: UUID): Promise<T | undefined>;
  commit(request: CommitEnvelope<C>): Promise<CommitResult<T>>;
  subscribe(listener: (id: UUID, revision: number) => void): () => void;
}
export interface EditorSnapshot<T> {
  readonly base: Readonly<T>;
  readonly value: Readonly<T>;
  readonly saveState: SaveState;
  readonly pendingCount: number;
  readonly remote: Readonly<T> | undefined;
  readonly locked: boolean;
}
export type FlushResult = { kind: 'saved'; revision: number } | { kind: 'blocked'; state: SaveState };
export interface EditorOptions<T extends StoredAudit, C> {
  initial: T;
  actor: Actor;
  store: EditorStore<T, C>;
  apply: (value: T, commands: readonly C[]) => T;
  transactionId?: () => UUID;
}

export class EditorController<T extends StoredAudit, C> {
  private base: T;
  private pending: C[] = [];
  private batch: readonly C[] = [];
  private state: SaveState;
  private remote: T | undefined;
  private locked = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<FlushResult> | undefined;
  private snapshot: EditorSnapshot<T>;
  private listeners = new Set<() => void>();
  private disposed = false;
  private remoteRevision = 0;
  private detachStore: (() => void) | undefined;
  private connections = 0;

  constructor(private readonly options: EditorOptions<T, C>) {
    this.base = structuredClone(options.initial);
    this.state = { kind: 'saved', revision: this.base.revision, at: this.base.updatedAt };
    this.snapshot = this.makeSnapshot();
  }
  getSnapshot = (): EditorSnapshot<T> => this.snapshot;
  hasPendingCommand(predicate: (command: C) => boolean): boolean { return [...this.batch, ...this.pending].some(predicate); }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private makeSnapshot(): EditorSnapshot<T> {
    const commands = [...this.batch, ...this.pending];
    const value = commands.length ? this.options.apply(structuredClone(this.base), structuredClone(commands)) : this.base;
    return Object.freeze({ base: this.base, value, saveState: this.state,
      pendingCount: commands.length, remote: this.remote, locked: this.locked });
  }
  private publish(): void {
    try { this.snapshot = this.makeSnapshot(); }
    catch (error) {
      this.state = { kind: 'error', message: error instanceof Error ? error.message : 'Не удалось применить локальные команды.' };
      this.snapshot = Object.freeze({ ...this.snapshot, base: this.base, saveState: this.state,
        remote: this.remote, locked: this.locked, pendingCount: this.batch.length + this.pending.length });
    }
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* Subscribers cannot alter commit results. */ } }
  }
  private cancelTimer(): void { clearTimeout(this.timer); this.timer = undefined; }
  enqueue(command: C): void {
    if (this.disposed || this.locked) throw new Error('Редактор временно закрыт для изменений.');
    const copy = structuredClone(command);
    // Validate optimistic application before modifying the queue.
    this.options.apply(structuredClone(this.snapshot.value as T), [copy]);
    this.pending.push(copy);
    if (this.state.kind !== 'error' && this.state.kind !== 'conflict' && !this.flight) this.state = { kind: 'dirty' };
    this.publish();
    this.cancelTimer();
    if (this.state.kind !== 'conflict' && this.state.kind !== 'error') {
      this.timer = setTimeout(() => { void this.flush(); }, 1000);
    }
  }
  flush = (): Promise<FlushResult> => {
    this.cancelTimer();
    if (this.flight) return this.flight;
    if (this.disposed) return Promise.resolve({ kind: 'blocked', state: { kind: 'error', message: 'Редактор закрыт.' } });
    if (this.state.kind === 'conflict' || this.state.kind === 'error') return Promise.resolve({ kind: 'blocked', state: this.state });
    const flight = Promise.resolve().then(() => this.drain()).catch((error: unknown): FlushResult => {
      this.pending = [...this.batch, ...this.pending]; this.batch = [];
      this.state = { kind: 'error', message: error instanceof Error ? error.message : 'Сохранение не завершено.' };
      this.publish(); return { kind: 'blocked', state: this.state };
    });
    this.flight = flight;
    void flight.then(() => {
      if (this.flight === flight) this.flight = undefined;
      if (this.remoteRevision > this.base.revision) void this.refreshRemote();
    });
    return flight;
  };
  private async drain(): Promise<FlushResult> {
    while (this.pending.length) {
      if (this.state.kind === 'error' || this.state.kind === 'conflict') return { kind: 'blocked', state: this.state };
      this.batch = this.pending; this.pending = [];
      this.state = { kind: 'saving' }; this.publish();
      let result: CommitResult<T>;
      try {
        result = await this.options.store.commit({ auditId: this.base.id, expectedRevision: this.base.revision,
          actor: this.options.actor, transactionId: (this.options.transactionId ?? (() => crypto.randomUUID()))(), commands: this.batch });
      } catch (error) {
        result = { kind: 'failed', code: error instanceof Error ? error.message : 'Ошибка сохранения', recoverable: true };
      }
      if (result.kind !== 'committed') {
        this.pending = [...this.batch, ...this.pending]; this.batch = [];
        if (result.kind === 'conflict') {
          this.remote = result.current;
          this.state = { kind: 'conflict', localRevision: this.base.revision, remoteRevision: result.current.revision };
        } else this.state = { kind: 'error', message: result.code === 'QUOTA_EXCEEDED' ? 'Недостаточно места на устройстве. Изменения остаются в редакторе. Освободите место и повторите сохранение.' : `Изменения остаются в очереди редактора. Ошибка записи: ${result.code}` };
        this.publish(); return { kind: 'blocked', state: this.state };
      }
      this.base = result.value; this.batch = [];
      this.state = this.pending.length ? { kind: 'dirty' } : { kind: 'saved', revision: this.base.revision, at: this.base.updatedAt };
      this.publish();
    }
    return { kind: 'saved', revision: this.base.revision };
  }
  discardPending(predicate: (command: C) => boolean): void {
    if (this.flight || this.state.kind === 'conflict' || this.locked) throw new Error('Дождитесь завершения сохранения или разрешите конфликт.');
    const remaining = this.pending.filter((command) => !predicate(command));
    if (remaining.length) this.options.apply(structuredClone(this.base), remaining);
    this.pending = remaining; this.cancelTimer();
    this.state = remaining.length ? { kind: 'dirty' } : { kind: 'saved', revision: this.base.revision, at: this.base.updatedAt }; this.publish();
  }
  retry(): Promise<FlushResult> {
    if (this.state.kind === 'conflict') return this.flush();
    if (this.state.kind === 'error') { this.state = { kind: 'dirty' }; this.publish(); }
    return this.flush();
  }
  async loadLatest(): Promise<void> {
    if (this.flight) await this.flight;
    const latest = await this.options.store.load(this.base.id);
    if (!latest) throw new Error('Обследование не найдено в базе.');
    this.cancelTimer(); this.base = latest; this.pending = []; this.batch = []; this.remote = undefined;
    this.remoteRevision = latest.revision;
    this.state = { kind: 'saved', revision: latest.revision, at: latest.updatedAt }; this.publish();
  }
  async saveIndependentCopy(makeCommands: (local: Readonly<T>, newId: UUID) => readonly C[]): Promise<CommitResult<T>> {
    if (this.flight) await this.flight;
    const auditId = crypto.randomUUID();
    return this.options.store.commit({ auditId, expectedRevision: 0, actor: this.options.actor,
      transactionId: crypto.randomUUID(), commands: makeCommands(structuredClone(this.snapshot.value), auditId) });
  }
  connect(): () => void {
    this.connections++;
    if (!this.detachStore) this.detachStore = this.options.store.subscribe((id, revision) => {
      if (id !== this.base.id || revision <= this.base.revision) return;
      this.remoteRevision = Math.max(this.remoteRevision, revision);
      if (!this.flight) void this.refreshRemote();
    });
    let active = true;
    return () => {
      if (!active) return; active = false;
      if (--this.connections === 0) { this.detachStore?.(); this.detachStore = undefined; }
    };
  }
  private async refreshRemote(): Promise<void> {
    try {
      const latest = await this.options.store.load(this.base.id);
      if (!latest || latest.revision <= this.base.revision || this.flight || this.disposed) return;
      if (this.pending.length) {
        this.cancelTimer(); this.remote = latest;
        this.state = { kind: 'conflict', localRevision: this.base.revision, remoteRevision: latest.revision };
      } else {
        this.base = latest; this.state = { kind: 'saved', revision: latest.revision, at: latest.updatedAt };
      }
      this.publish();
    } catch { /* A failed refresh must not discard local commands. Commit still checks revision. */ }
  }
  async prepareUpdate(): Promise<boolean> {
    this.locked = true; this.publish();
    const result = await this.flush();
    return result.kind === 'saved' && this.pending.length === 0 && this.batch.length === 0;
  }
  releaseUpdate(): void { this.locked = false; this.publish(); }
  hasUnsavedChanges = (): boolean => this.pending.length > 0 || this.batch.length > 0;
  async dispose(): Promise<FlushResult> {
    const result = await this.flush();
    if (result.kind !== 'saved') return result;
    this.cancelTimer(); this.detachStore?.(); this.detachStore = undefined;
    this.listeners.clear(); this.disposed = true; return result;
  }
}
