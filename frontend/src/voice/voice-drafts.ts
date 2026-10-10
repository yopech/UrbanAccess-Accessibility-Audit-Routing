import { openDatabase, AUDIT_STORES } from '../storage/database.js';
import { asStorageError, StorageError } from '../domain/contracts.js';
import type { VoiceContext } from './stt-adapter.js';
export interface VoiceDraft {
  id: string; sessionId: string; auditId: string; elementId: string; context: VoiceContext;
  state: 'requesting' | 'listening' | 'stopping' | 'review' | 'error' | 'cancelled' | 'discarded' | 'applied';
  finalSegments: { resultId: string; text: string }[]; reviewText: string; version: number;
  createdAt: string; updatedAt: string; appliedAt?: string;
}
export interface VoiceDraftStore { save(draft: VoiceDraft): Promise<void>; list(auditId: string): Promise<VoiceDraft[]>; }
export function validateVoiceDraft(draft: VoiceDraft): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!draft || !draft.context || ![draft.id, draft.auditId, draft.elementId, draft.context.zoneId].every((id) => uuid.test(id))
    || draft.id !== draft.sessionId || draft.context.sessionId !== draft.sessionId || draft.context.auditId !== draft.auditId || draft.context.elementId !== draft.elementId
    || !['comment', 'recommendation'].includes(draft.context.mode) || !Number.isSafeInteger(draft.context.baseRevision) || draft.context.baseRevision < 1
    || !Number.isSafeInteger(draft.version) || draft.version < 1 || typeof draft.reviewText !== 'string' || !Array.isArray(draft.finalSegments)
    || !['requesting', 'listening', 'stopping', 'review', 'error', 'cancelled', 'discarded', 'applied'].includes(draft.state)
    || !Number.isFinite(Date.parse(draft.createdAt)) || !Number.isFinite(Date.parse(draft.updatedAt))
    || (draft.state === 'applied') !== (draft.appliedAt !== undefined) || (draft.appliedAt !== undefined && !Number.isFinite(Date.parse(draft.appliedAt)))
    || draft.finalSegments.some((segment) => !segment || typeof segment.resultId !== 'string' || typeof segment.text !== 'string')
    || new Set(draft.finalSegments.map((segment) => segment.resultId)).size !== draft.finalSegments.length) throw new StorageError('INVALID_RECORD', 'Некорректный черновик диктовки.', false);
}
export const voiceDrafts: VoiceDraftStore = {
  async save(input) {
    const draft = structuredClone(input); validateVoiceDraft(draft); const db = await openDatabase();
    await new Promise<void>((resolve, reject) => { const tx = db.transaction(AUDIT_STORES.voiceDrafts, 'readwrite'); const store = tx.objectStore(AUDIT_STORES.voiceDrafts); let error: unknown;
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(asStorageError(error ?? tx.error)); tx.onerror = (event) => { error = (event.target as IDBRequest).error; };
      const req = store.get(draft.id); req.onsuccess = () => { const old = req.result as VoiceDraft | undefined;
        try {
          if (old) {
            validateVoiceDraft(old);
            if (JSON.stringify(old) === JSON.stringify(draft)) return;
            if (old.appliedAt || old.state === 'discarded' || draft.version <= old.version) throw new StorageError('INVALID_REQUEST', 'Черновик изменён в другой вкладке или уже добавлен. Скопируйте свой текст перед повторным открытием.', true);
          }
          store.put(draft);
        } catch (cause) { error = cause; tx.abort(); }
      };
    });
  },
  async list(auditId) { const db = await openDatabase(); return new Promise<VoiceDraft[]>((resolve, reject) => {
    const tx = db.transaction(AUDIT_STORES.voiceDrafts); let values: VoiceDraft[] = []; const req = tx.objectStore(AUDIT_STORES.voiceDrafts).index('auditId').getAll(auditId);
    req.onsuccess = () => { try { values = req.result as VoiceDraft[]; values.forEach(validateVoiceDraft); } catch (cause) { reject(cause); tx.abort(); } };
    tx.oncomplete = () => resolve(values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); tx.onabort = () => reject(asStorageError(tx.error));
  }); },
};
