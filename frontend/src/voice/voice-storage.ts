import type { Audit, AuditCommand } from '../domain/audit-model.js';
import { StorageError } from '../domain/contracts.js';
import { AUDIT_STORES } from '../storage/database.js';
import { validateVoiceDraft, type VoiceDraft } from './voice-drafts.js';
/** These requests participate in the same transaction as the Audit and auditEvents. */
export function writeVoiceDraftCommands(tx: IDBTransaction, _current: Audit | undefined, value: Audit, commands: readonly AuditCommand[], abort: (cause: unknown) => void): void {
  const consumed = new Set<string>();
  for (const command of commands) {
    if (command.type !== 'applyVoiceDraft') continue;
    if (consumed.has(command.draftId)) { abort(new StorageError('INVALID_REQUEST', 'Черновик уже добавлен в пакет.', false)); return; }
    consumed.add(command.draftId);
    const store = tx.objectStore(AUDIT_STORES.voiceDrafts); const request = store.get(command.draftId);
    request.onsuccess = () => {
      try {
        const draft = request.result as VoiceDraft | undefined;
        if (!draft) throw new StorageError('NOT_FOUND', 'Черновик диктовки не найден.', true);
        validateVoiceDraft(draft);
        if (draft.appliedAt || draft.state === 'applied' || draft.version !== command.draftVersion
          || draft.auditId !== value.id || draft.elementId !== command.elementId || draft.context.mode !== command.mode
          || value.elements[command.elementId]?.zoneId !== draft.context.zoneId || draft.reviewText !== command.text
          || !['review', 'error'].includes(draft.state)) throw new StorageError('INVALID_REQUEST', 'Черновик изменён или уже применён. Откройте его заново.', true);
        store.put({ ...draft, state: 'applied', appliedAt: value.updatedAt, updatedAt: value.updatedAt, version: draft.version + 1 } satisfies VoiceDraft);
      } catch (cause) { abort(cause); }
    };
  }
}
