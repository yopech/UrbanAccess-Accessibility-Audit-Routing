import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/app/shell.css';
import { AuditStore, type StoredAudit } from '../src/storage/audit-store.js';
import { EditorController, type EditorStore } from '../src/features/editor/editor-controller.js';
import { useEditorController } from '../src/features/editor/use-editor-controller.js';
import { SaveStatusBadge } from '../src/features/editor/save-status-badge.js';
import { RevisionConflictDialog } from '../src/features/editor/revision-conflict-dialog.js';
import { PwaUpdatePrompt } from '../src/pwa/pwa-update-prompt.js';
import { pwaUpdates } from '../src/pwa/pwa-update-controller.js';
interface Audit extends StoredAudit { title: string; }
type Command = { title: string };
const auditId = '22222222-2222-4222-8222-222222222222';
const actor = { id: '11111111-1111-4111-8111-111111111111', name: 'Тест' };
const store = new AuditStore<Audit, Command>({ reduce: (current, commands, context) => ({
  ...current, id: context.auditId, objectId: '33333333-3333-4333-8333-333333333333', schemaVersion: 1,
  revision: context.revision, updatedAt: context.committedAt, status: 'draft', title: commands.at(-1)!.title,
}) });
let gate: (() => void) | undefined;
let delayed = false;
let fail = false;
const port: EditorStore<Audit, Command> = { load: (id) => store.load(id), subscribe: (listener) => store.subscribe(listener),
  async commit(request) {
    if (delayed) { delayed = false; await new Promise<void>((resolve) => { gate = resolve; }); }
    if (fail) return { kind: 'failed', code: 'QUOTA_EXCEEDED', recoverable: true };
    return store.commit(request);
  } };
const loaded = await store.load(auditId);
const result = loaded ? undefined : await store.commit({ auditId, expectedRevision: 0, transactionId: crypto.randomUUID(), actor, commands: [{ title: 'Base' }] });
const initial = loaded ?? (result?.kind === 'committed' ? result.value : result?.kind === 'conflict' ? result.current : undefined);
if (!initial) throw new Error('Fixture initialization failed');
const controller = new EditorController({ initial, actor, store: port, apply: (value, commands) => ({ ...value, title: commands.at(-1)?.title ?? value.title }) });
declare global { interface Window { qa: { controller: typeof controller; store: typeof store; delay(): void; release(): void; fail(value: boolean): void; copyId?: string; }; } }
window.qa = { controller, store, delay: () => { delayed = true; }, release: () => { gate?.(); }, fail: (value) => { fail = value; } };
function Fixture() {
  const state = useEditorController(controller);
  return <main data-build={__APP_VERSION__}><h1>QA {__APP_VERSION__}</h1>
    <label>Название<input aria-label="Название" value={state.value.title} disabled={state.locked} onChange={(event) => controller.enqueue({ title: event.target.value })} /></label>
    <SaveStatusBadge state={state.saveState} onRetry={() => { void controller.retry(); }} />
    <RevisionConflictDialog open={state.saveState.kind === 'conflict'} local={state.value} remote={state.remote}
      onLoadLatest={() => controller.loadLatest()} onSaveCopy={async () => {
        const copy = await controller.saveIndependentCopy((value) => [{ title: value.title }]);
        if (copy.kind !== 'committed') throw new Error('Copy failed');
        window.qa.copyId = copy.value.id; await controller.loadLatest();
      }} />
    <PwaUpdatePrompt />
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
void pwaUpdates.start();
