import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorController, type EditorStore } from '../../src/features/editor/editor-controller.js';
import { UpdateParticipants } from '../../src/pwa/update-participants.js';
import type { CommitEnvelope, CommitResult } from '../../src/domain/contracts.js';
import type { StoredAudit } from '../../src/storage/audit-store.js';
interface Audit extends StoredAudit { title: string; }
type Command = { title: string };
const initial: Audit = { id: '22222222-2222-4222-8222-222222222222', objectId: '33333333-3333-4333-8333-333333333333',
  schemaVersion: 1, revision: 1, updatedAt: '2026-10-10T10:00:00Z', status: 'draft', title: 'Base' };
const actor = { id: '11111111-1111-4111-8111-111111111111', name: 'Игорь' };
function setup(commit?: EditorStore<Audit, Command>['commit']) {
  let current = { ...initial };
  const requests: CommitEnvelope<Command>[] = [];
  const listeners = new Set<(id: string, revision: number) => void>();
  const store: EditorStore<Audit, Command> = {
    async load() { return current; },
    commit: vi.fn(async (request: CommitEnvelope<Command>): Promise<CommitResult<Audit>> => {
      requests.push(request);
      if (commit) return commit(request);
      current = { ...current, title: request.commands.at(-1)!.title, revision: request.expectedRevision + 1 };
      return { kind: 'committed', value: current, transactionId: request.transactionId };
    }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const controller = new EditorController({ initial, actor, store, transactionId: () => '44444444-4444-4444-8444-444444444444',
    apply: (value, commands) => ({ ...value, title: commands.at(-1)?.title ?? value.title }) });
  return { controller, store, requests, listeners, setRemote: (value: Audit) => { current = value; for (const fn of listeners) fn(value.id, value.revision); } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
afterEach(() => vi.useRealTimers());
describe('EditorController', () => {
  it('applies optimistic changes immediately and debounces 1000ms after last edit', async () => {
    vi.useFakeTimers(); const { controller, store } = setup();
    controller.enqueue({ title: 'A' }); expect(controller.getSnapshot().value.title).toBe('A');
    await vi.advanceTimersByTimeAsync(900); controller.enqueue({ title: 'B' });
    await vi.advanceTimersByTimeAsync(999); expect(store.commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(store.commit).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().saveState.kind).toBe('saved');
  });
  it('flush awaits the actual commit, including a second queue, with one commit at a time', async () => {
    const first = deferred<CommitResult<Audit>>(); let calls = 0;
    const { controller, requests } = setup(async (request) => {
      if (++calls === 1) return first.promise;
      return { kind: 'committed', value: { ...initial, title: request.commands.at(-1)!.title, revision: 3 }, transactionId: request.transactionId };
    });
    controller.enqueue({ title: 'A' }); const flush = controller.flush();
    await Promise.resolve(); controller.enqueue({ title: 'B' }); expect(calls).toBe(1);
    expect(controller.flush()).toBe(flush); expect(controller.getSnapshot().value.title).toBe('B');
    first.resolve({ kind: 'committed', value: { ...initial, title: 'A', revision: 2 }, transactionId: 'one' });
    expect(await flush).toEqual({ kind: 'saved', revision: 3 }); expect(calls).toBe(2);
    expect(requests.map((r) => r.expectedRevision)).toEqual([1, 2]); expect(controller.getSnapshot().value.title).toBe('B');
  });
  it('retains both queues on failure, stays in error until retry, and cancels debounce', async () => {
    vi.useFakeTimers(); let fail = true;
    const { controller, requests } = setup(async (request) => fail ? { kind: 'failed', code: 'QUOTA_EXCEEDED', recoverable: true }
      : { kind: 'committed', value: { ...initial, revision: 2, title: request.commands.at(-1)!.title }, transactionId: 'retry' });
    controller.enqueue({ title: 'A' }); expect((await controller.flush()).kind).toBe('blocked'); controller.enqueue({ title: 'B' });
    await vi.advanceTimersByTimeAsync(2000); expect(requests.length).toBe(1); expect(controller.getSnapshot().pendingCount).toBe(2);
    fail = false; await controller.retry(); expect(requests[1]!.commands.length).toBe(2); expect(controller.getSnapshot().value.title).toBe('B');
  });
  it('AC-15 pauses on conflict without replacing local edits or retrying a new revision', async () => {
    const remote = { ...initial, revision: 2, title: 'Other tab' };
    const { controller, requests } = setup(async () => ({ kind: 'conflict', current: remote, expectedRevision: 1 }));
    controller.enqueue({ title: 'My edit' }); expect((await controller.flush()).kind).toBe('blocked');
    expect(controller.getSnapshot().value.title).toBe('My edit'); expect(controller.getSnapshot().remote).toEqual(remote);
    await controller.flush(); await controller.retry(); expect(requests.length).toBe(1);
  });
  it('loads latest only on explicit choice and discards the old queue', async () => {
    const { controller, setRemote } = setup(); controller.enqueue({ title: 'Local' }); setRemote({ ...initial, title: 'Remote', revision: 2 });
    await controller.loadLatest(); expect(controller.getSnapshot().value.title).toBe('Remote'); expect(controller.hasUnsavedChanges()).toBe(false);
  });
  it('responds to remote notifications, cleans subscriptions, and works with Strict Mode reconnect', async () => {
    const { controller, listeners, setRemote } = setup(); const disconnect = controller.connect(); const second = controller.connect();
    expect(listeners.size).toBe(1); controller.enqueue({ title: 'Local' }); setRemote({ ...initial, revision: 2 });
    await Promise.resolve(); expect(controller.getSnapshot().saveState.kind).toBe('conflict');
    disconnect(); second(); expect(listeners.size).toBe(0); const again = controller.connect(); expect(listeners.size).toBe(1); again();
  });
  it('freezes input during update preparation and flushes before reporting readiness', async () => {
    const gate = deferred<CommitResult<Audit>>(); const { controller } = setup(() => gate.promise);
    controller.enqueue({ title: 'Save first' }); const prepare = controller.prepareUpdate();
    expect(() => controller.enqueue({ title: 'Too late' })).toThrow();
    gate.resolve({ kind: 'committed', value: { ...initial, revision: 2, title: 'Save first' }, transactionId: 'saved' });
    expect(await prepare).toBe(true); controller.releaseUpdate(); controller.enqueue({ title: 'Allowed' }); await controller.dispose();
  });
  it('does not allow an update when commit fails', async () => {
    const { controller } = setup(async () => ({ kind: 'failed', code: 'QUOTA_EXCEEDED', recoverable: true }));
    controller.enqueue({ title: 'Keep' }); expect(await controller.prepareUpdate()).toBe(false); controller.releaseUpdate();
    expect(controller.getSnapshot().value.title).toBe('Keep'); expect(controller.hasUnsavedChanges()).toBe(true);
  });
  it('saving an independent copy uses a new ID and revision zero without overwriting original', async () => {
    const { controller, requests } = setup(); controller.enqueue({ title: 'Copy' });
    await controller.saveIndependentCopy((value) => [{ title: value.title }]);
    expect(requests[0]!.auditId).not.toBe(initial.id); expect(requests[0]!.expectedRevision).toBe(0);
    expect(controller.getSnapshot().pendingCount).toBe(1); await controller.dispose();
  });
});
it('update registry includes exports/voice blockers and releases all participants', async () => {
  const registry = new UpdateParticipants(); const releaseUpdate = vi.fn();
  registry.add({ prepareUpdate: async () => false, releaseUpdate });
  expect(await registry.prepareUpdate()).toBe(false); registry.releaseUpdate(); expect(releaseUpdate).toHaveBeenCalledTimes(1);
});

it('update registry releases a prepared participant even after it unmounts', async () => {
  const registry = new UpdateParticipants(); const releaseUpdate = vi.fn();
  const unregister = registry.add({ prepareUpdate: async () => true, releaseUpdate });
  await registry.prepareUpdate(); unregister(); registry.releaseUpdate();
  expect(releaseUpdate).toHaveBeenCalledTimes(1);
});
