import { AuditStore } from '../../storage/audit-store.js';
import { applyAuditCommands, normalizeAudit, validateAudit, type Audit, type AuditCommand } from '../../domain/audit-model.js';
import { EditorController } from '../editor/editor-controller.js';
import { openDatabase, AUDIT_STORES } from '../../storage/database.js';
import { writePhotoCommands, photoEventCommands } from '../../media/photo-storage.js';
import { writeReviewCommands } from '../review/review-storage.js';
import { writeVoiceDraftCommands } from '../../voice/voice-storage.js';
import { AUDIT_TEMPLATES } from '../../domain/templates/index.js';
export const audits = new AuditStore<Audit, AuditCommand>({ reduce: applyAuditCommands, normalize: normalizeAudit, validate: validateAudit, transactionStores: [AUDIT_STORES.photos, AUDIT_STORES.voiceDrafts], writeTransaction: (tx, current, value, commands, abort) => { writePhotoCommands(tx, current, value, commands, abort); writeVoiceDraftCommands(tx, current, value, commands, abort); writeReviewCommands(tx, current, value, commands, abort); }, eventCommands: photoEventCommands });
export function createEditor(audit: Audit): EditorController<Audit, AuditCommand> {
  return new EditorController({ initial: audit, actor: audit.author, store: audits,
    apply: (current, commands) => applyAuditCommands(current, commands, { auditId: current.id,
      actor: current.author, transactionId: current.id, revision: current.revision + 1, committedAt: current.updatedAt }) });
}
export async function installZ2Template(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUDIT_STORES.templates, 'readwrite');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    const store = tx.objectStore(AUDIT_STORES.templates);
    for (const template of AUDIT_TEMPLATES) { const request = store.get([template.id, template.version]);
      request.onsuccess = () => { if (!request.result) store.add(template); };
    }
  });
}
