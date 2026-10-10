import { openDatabase, AUDIT_STORES } from '../storage/database.js';
import { normalizeAudit, validateAudit, type Audit } from '../domain/audit-model.js';
import { asStorageError, StorageError } from '../domain/contracts.js';
import { validatePhoto, type Photo } from '../media/photo-contract.js';
import { validateVoiceDraft, type VoiceDraft } from '../voice/voice-drafts.js';
import { buildActDraft, validateDocumentSnapshot, type DocumentSnapshot } from './act-draft.js';
export interface DocumentBundle { snapshot: DocumentSnapshot; photos: Photo[]; }
/** Capture aggregate, drafts and image references in one transaction; never overwrite a snapshot. */
export async function captureDocument(auditId: string, expectedRevision: number): Promise<DocumentBundle> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([AUDIT_STORES.audits, AUDIT_STORES.photos, AUDIT_STORES.voiceDrafts, AUDIT_STORES.documents], 'readwrite');
    let error: unknown; let bundle: DocumentBundle;
    tx.onabort = () => reject(asStorageError(error ?? tx.error)); tx.onerror = (event) => { error = (event.target as IDBRequest).error; }; tx.oncomplete = () => resolve(bundle);
    const fail = (cause: unknown) => { error = cause; tx.abort(); };
    const request = tx.objectStore(AUDIT_STORES.audits).get(auditId);
    request.onsuccess = () => { try {
      if (!request.result) throw new StorageError('NOT_FOUND', 'Обследование не найдено.', true);
      const audit = normalizeAudit(request.result as Audit); validateAudit(audit);
      if (audit.revision !== expectedRevision) throw new StorageError('INVALID_REQUEST', 'Обследование изменилось в другой вкладке. Откройте актуальную редакцию перед новым экспортом.', true);
      const photos: Photo[] = []; let drafts: VoiceDraft[] = []; let pending = audit.photoIds.length + 1;
      const done = () => { if (--pending !== 0) return; try { bundle = { snapshot: buildActDraft(audit, photos, drafts), photos }; tx.objectStore(AUDIT_STORES.documents).add(bundle.snapshot); } catch (cause) { fail(cause); } };
      for (const id of audit.photoIds) { const photo = tx.objectStore(AUDIT_STORES.photos).get(id); photo.onsuccess = () => { try { validatePhoto(photo.result as Photo); photos.push(photo.result as Photo); done(); } catch (cause) { fail(cause); } }; }
      const voice = tx.objectStore(AUDIT_STORES.voiceDrafts).index('auditId').getAll(auditId); voice.onsuccess = () => { try { drafts = voice.result as VoiceDraft[]; drafts.forEach(validateVoiceDraft); done(); } catch (cause) { fail(cause); } };
    } catch (cause) { fail(cause); } };
  });
}
export async function listDocuments(auditId: string): Promise<DocumentSnapshot[]> {
  const db = await openDatabase(); return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIT_STORES.documents); let values: DocumentSnapshot[] = [];
    const request = tx.objectStore(AUDIT_STORES.documents).index('auditId_createdAt').getAll(IDBKeyRange.bound([auditId, ''], [auditId, '\uffff']));
    request.onsuccess = () => { try { values = request.result as DocumentSnapshot[]; values.forEach(validateDocumentSnapshot); } catch (cause) { reject(cause); tx.abort(); } };
    tx.oncomplete = () => resolve(values.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); tx.onabort = () => reject(asStorageError(tx.error));
  });
}
export async function loadDocument(id: string): Promise<DocumentBundle> {
  const db = await openDatabase(); return new Promise((resolve, reject) => {
    const tx = db.transaction([AUDIT_STORES.documents, AUDIT_STORES.photos]); let error: unknown; let bundle: DocumentBundle;
    tx.oncomplete = () => resolve(bundle); tx.onabort = () => reject(asStorageError(error ?? tx.error));
    const fail = (cause: unknown) => { error = cause; tx.abort(); }; const request = tx.objectStore(AUDIT_STORES.documents).get(id);
    request.onsuccess = () => { try {
      const snapshot = request.result as DocumentSnapshot; validateDocumentSnapshot(snapshot); bundle = { snapshot, photos: [] };
      for (const evidence of snapshot.evidence) { const image = tx.objectStore(AUDIT_STORES.photos).get(evidence.photoId); image.onsuccess = () => { try { const photo = image.result as Photo; validatePhoto(photo);
        if (photo.sha256 !== evidence.sha256 || photo.width !== evidence.width || photo.height !== evidence.height) throw new Error('Содержимое фото сохранённого документа изменилось.'); bundle.photos.push(photo);
      } catch (cause) { fail(cause); } }; }
    } catch (cause) { fail(cause); } };
  });
}
