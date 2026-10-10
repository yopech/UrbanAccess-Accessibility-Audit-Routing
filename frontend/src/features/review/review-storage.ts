import type { Audit, AuditCommand } from '../../domain/audit-model.js';
import { StorageError } from '../../domain/contracts.js';
import { AUDIT_STORES } from '../../storage/database.js';
import { validateVoiceDraft, type VoiceDraft } from '../../voice/voice-drafts.js';
import { pendingVoiceDrafts } from './readiness.js';
export function writeReviewCommands(tx: IDBTransaction, _current: Audit | undefined, value: Audit, commands: readonly AuditCommand[], abort: (cause: unknown) => void): void {
  if (!commands.some((command) => command.type === 'reviewAudit')) return;
  const request = tx.objectStore(AUDIT_STORES.voiceDrafts).index('auditId').getAll(value.id);
  request.onsuccess = () => { try {
    const drafts = request.result as VoiceDraft[]; drafts.forEach(validateVoiceDraft);
    if (pendingVoiceDrafts(drafts).length) throw new StorageError('INVALID_REQUEST', 'Сначала добавьте или отклоните голосовые черновики.', true);
  } catch (cause) { abort(cause); } };
}
