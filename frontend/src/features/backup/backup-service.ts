import { openDatabase, AUDIT_STORES } from '../../storage/database.js';
import { AUDIT_SYNC_CHANNEL, type AuditEvent } from '../../storage/audit-store.js';
import { AUDIT_TEMPLATES } from '../../domain/templates/index.js';
import { validateAudit, type Audit } from '../../domain/audit-model.js';
import { asStorageError } from '../../domain/contracts.js';
import { validatePhoto, photoMetadata, type Photo, type PhotoMetadata } from '../../media/photo-contract.js';
import { validateVoiceDraft, type VoiceDraft } from '../../voice/voice-drafts.js';
import { validateDocumentSnapshot, type DocumentSnapshot } from '../../documents/act-draft.js';
export interface AuditBackupEnvelope {
  format: 'urbanaccess-audit-backup'; version: '1.0.0'; exportedAt: string; appVersion: string;
  audit: Audit; drafts: VoiceDraft[];
  mediaManifest: (PhotoMetadata & { mimeType: Photo['mime']; byteLength: number; filename: string })[];
  mediaPayload: { id: string; dataURL: string }[];
  documents: DocumentSnapshot[]; events: AuditEvent<unknown>[];
}
export interface BackupPreview {
  name: string; exportedAt: string; bytes: number; elements: number; measurements: number; findings: number; photos: number;
  collision: boolean; localRevision?: number; backupRevision: number;
}
export interface PreparedBackup { file: File; preview: BackupPreview; }
const MAX_FILE = 200 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
async function hash(blob: Blob): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function dataURL(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(new Error('Не удалось прочитать фотографию.')); reader.readAsDataURL(blob); }); }
function decode(value: string, mime: string): Blob {
  check(typeof value === 'string' && value.startsWith(`data:${mime};base64,`), 'Некорректный формат упакованной фотографии.');
  const base64 = value.slice(value.indexOf(',') + 1);
  check(base64.length <= Math.ceil(20 * 1024 * 1024 / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64), 'Повреждена кодировка фотографии.');
  const raw = atob(base64); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
function uniqueIds(values: { id: string }[], label: string): void { check(values.every((value) => value && uuid.test(value.id)) && new Set(values.map((value) => value.id)).size === values.length, `Некорректные или повторяющиеся ID: ${label}.`); }
function checkLinks(envelope: AuditBackupEnvelope, photos: Photo[]): void {
  const { audit } = envelope; const byId = new Map(photos.map((photo) => [photo.id, photo]));
  for (const id of audit.photoIds) {
    const photo = byId.get(id); check(photo && audit.elements[photo.elementId]?.photoIds.includes(id), 'В копии отсутствует фото карточки или нарушена его привязка.');
    check(photo.measurementIds.every((key) => audit.measurements[key]?.elementId === photo.elementId) && photo.findingIds.every((key) => audit.findings[key]?.elementId === photo.elementId), 'Нарушена связь фото с замером или замечанием.');
  }
  for (const zone of Object.values(audit.zones)) check(typeof zone.title === 'string', 'Некорректное название зоны.');
  for (const element of Object.values(audit.elements)) check(!element.parentElementId || audit.elements[element.parentElementId], 'Родительский элемент отсутствует.');
  for (const draft of envelope.drafts) { validateVoiceDraft(draft); check(draft.auditId === audit.id && audit.elements[draft.elementId]?.zoneId === draft.context.zoneId, 'Черновик диктовки связан с другим объектом или элементом.'); }
  for (const document of envelope.documents) {
    validateDocumentSnapshot(document); check(AUDIT_TEMPLATES.some(template => template.id === document.template?.id && template.version === document.template.version) && ['draft', 'reviewed'].includes(document.status) && document.missingInformation.every((text) => typeof text === 'string') && document.auditRevision <= audit.revision, 'Некорректные метаданные документа.');
    for (const block of document.blocks) { if (block.kind === 'heading') check([1, 2, 3].includes(block.level), 'Некорректный заголовок документа.'); if (block.kind === 'paragraph' || block.kind === 'table') check(Array.isArray(block.sourceIds) && block.sourceIds.every((id) => typeof id === 'string' && uuid.test(id)), 'Некорректные ссылки документа.'); if (block.kind === 'photo') check(typeof block.label === 'string' && typeof block.caption === 'string', 'Некорректная подпись документа.'); }
    check(document.auditId === audit.id, 'Документ связан с другим обследованием.');
    for (const evidence of document.evidence) { const photo = byId.get(evidence.photoId); check(photo && photo.sha256 === evidence.sha256 && photo.width === evidence.width && photo.height === evidence.height && typeof evidence.label === 'string' && typeof evidence.caption === 'string', 'Фотография сохранённого документа отсутствует или изменена.'); }
  }
  for (const event of envelope.events) check(event.auditId === audit.id && uuid.test(event.transactionId) && event.id === event.transactionId && Number.isSafeInteger(event.revision) && event.revision >= 1 && event.revision <= audit.revision && Number.isSafeInteger(event.previousRevision) && event.previousRevision >= 0 && date(event.committedAt) && event.actor && uuid.test(event.actor.id) && typeof event.actor.name === 'string' && Array.isArray(event.commands), 'Некорректная история изменений.');
}
function preview(envelope: AuditBackupEnvelope, bytes: number, local?: Audit): BackupPreview {
  return { name: envelope.audit.object.name, exportedAt: envelope.exportedAt, bytes, elements: Object.keys(envelope.audit.elements).length, measurements: Object.keys(envelope.audit.measurements).length, findings: Object.keys(envelope.audit.findings).length, photos: envelope.mediaManifest.length, collision: !!local, ...(local ? { localRevision: local.revision } : {}), backupRevision: envelope.audit.revision };
}
async function localAudit(id: string): Promise<Audit | undefined> {
  const db = await openDatabase(); return new Promise((resolve, reject) => { const tx = db.transaction(AUDIT_STORES.audits); const req = tx.objectStore(AUDIT_STORES.audits).get(id); tx.oncomplete = () => resolve(req.result as Audit | undefined); tx.onabort = () => reject(asStorageError(tx.error)); });
}
async function readBundle(id: string): Promise<{ audit: Audit; photos: Photo[]; drafts: VoiceDraft[]; documents: DocumentSnapshot[]; events: AuditEvent<unknown>[] }> {
  check(uuid.test(id), 'Некорректный ID обследования.'); const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([AUDIT_STORES.audits, AUDIT_STORES.photos, AUDIT_STORES.voiceDrafts, AUDIT_STORES.documents, AUDIT_STORES.events]);
    const audit = tx.objectStore(AUDIT_STORES.audits).get(id);
    const photos = tx.objectStore(AUDIT_STORES.photos).index('auditId').getAll(id);
    const drafts = tx.objectStore(AUDIT_STORES.voiceDrafts).index('auditId').getAll(id);
    const documents = tx.objectStore(AUDIT_STORES.documents).index('auditId_createdAt').getAll(IDBKeyRange.bound([id, ''], [id, '\uffff']));
    const events = tx.objectStore(AUDIT_STORES.events).index('auditId_revision').getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    tx.onabort = () => reject(asStorageError(tx.error)); tx.oncomplete = () => { if (!audit.result) reject(new Error('Обследование не найдено.')); else resolve({ audit: audit.result as Audit, photos: photos.result as Photo[], drafts: drafts.result as VoiceDraft[], documents: documents.result as DocumentSnapshot[], events: events.result as AuditEvent<unknown>[] }); };
  });
}
export async function prepareAuditBackup(auditId: string): Promise<PreparedBackup> {
  const bundle = await readBundle(auditId); validateAudit(bundle.audit);
  const envelope: AuditBackupEnvelope = { format: 'urbanaccess-audit-backup', version: '1.0.0', exportedAt: new Date().toISOString(), appVersion: __APP_VERSION__, audit: bundle.audit, drafts: bundle.drafts, documents: bundle.documents, events: bundle.events, mediaManifest: [], mediaPayload: [] };
  for (const photo of bundle.photos) { validatePhoto(photo); check(photo.auditId === auditId && await hash(photo.blob) === photo.sha256, `Нарушена целостность фото ${photo.id}. Экспорт остановлен.`);
    envelope.mediaManifest.push({ ...photoMetadata(photo), mimeType: photo.mime, byteLength: photo.bytes, filename: `${photo.id}.${photo.mime === 'image/jpeg' ? 'jpg' : photo.mime.split('/')[1]}` }); envelope.mediaPayload.push({ id: photo.id, dataURL: await dataURL(photo.blob) }); }
  checkLinks(envelope, bundle.photos);
  const name = bundle.audit.object.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[.\s]+$/g, '').slice(0, 80) || 'обследование';
  const file = new File([JSON.stringify(envelope)], `backup-${name}-${envelope.exportedAt.slice(0, 10)}.ngo`, { type: 'application/json' });
  check(file.size <= MAX_FILE, 'Копия превышает лимит 200 МБ.'); return { file, preview: preview(envelope, file.size) };
}
export function downloadAuditBackup(file: File): void { const url = URL.createObjectURL(file); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; document.body.append(anchor); try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); } }
export async function exportAuditBackup(auditId: string): Promise<PreparedBackup> { const result = await prepareAuditBackup(auditId); downloadAuditBackup(result.file); return result; }
async function validateFile(file: File): Promise<{ envelope: AuditBackupEnvelope; photos: Photo[] }> {
  check(file.size > 0 && file.size <= MAX_FILE, 'Пустой файл или размер больше 200 МБ.'); let envelope: AuditBackupEnvelope;
  try { envelope = JSON.parse(await file.text()) as AuditBackupEnvelope; } catch { throw new Error('Файл не содержит корректную резервную копию JSON.'); }
  try {
    check(envelope && envelope.format === 'urbanaccess-audit-backup' && envelope.version === '1.0.0', 'Неподдерживаемый формат или версия резервной копии.');
    check(date(envelope.exportedAt) && typeof envelope.appVersion === 'string' && envelope.appVersion.trim(), 'В копии отсутствуют метаданные экспорта.');
    validateAudit(envelope.audit);
    check([envelope.drafts, envelope.mediaManifest, envelope.mediaPayload, envelope.documents, envelope.events].every(Array.isArray), 'В копии отсутствуют обязательные разделы.');
    uniqueIds(envelope.drafts, 'черновики'); uniqueIds(envelope.mediaManifest, 'фотографии'); uniqueIds(envelope.mediaPayload, 'данные фотографий'); uniqueIds(envelope.documents, 'документы'); uniqueIds(envelope.events, 'события');
    check(envelope.mediaManifest.length === envelope.mediaPayload.length, 'Число фотографий и вложений не совпадает.');
    const payload = new Map(envelope.mediaPayload.map((item) => [item.id, item.dataURL])); const photos: Photo[] = [];
    for (const entry of envelope.mediaManifest) {
      check(entry && entry.mimeType === entry.mime && entry.byteLength === entry.bytes && typeof entry.filename === 'string' && entry.filename && entry.auditId === envelope.audit.id, 'Некорректный манифест фотографий.');
      const encoded = payload.get(entry.id); check(encoded, `В копии отсутствует файл ${entry.id}.`);
      const { mimeType: _mime, byteLength: _size, filename: _name, ...metadata } = entry; const photo: Photo = { ...metadata, blob: decode(encoded, entry.mime) }; validatePhoto(photo);
      check(photo.measurementIds.every((id) => uuid.test(id)) && photo.findingIds.every((id) => uuid.test(id)), 'Некорректные ссылки фотографии.');
      check(await hash(photo.blob) === entry.sha256, `Контрольная сумма SHA-256 фотографии ${entry.filename} не совпадает. Файл повреждён.`);
      const bitmap = await createImageBitmap(photo.blob); try { check(bitmap.width === photo.width && bitmap.height === photo.height, `Размеры фотографии ${entry.filename} не совпадают с манифестом.`); } finally { bitmap.close(); }
      photos.push(photo);
    }
    checkLinks(envelope, photos); return { envelope, photos };
  } catch (cause) { throw new Error(`Резервная копия не прошла проверку: ${cause instanceof Error ? cause.message : 'повреждённые данные'}`); }
}
export async function inspectAuditBackup(file: File): Promise<BackupPreview> { const { envelope } = await validateFile(file); return preview(envelope, file.size, await localAudit(envelope.audit.id)); }
function cloneIds(envelope: AuditBackupEnvelope, photos: Photo[]): { envelope: AuditBackupEnvelope; photos: Photo[] } {
  const ids = new Map<string, string>(); const put = (id: string) => { if (!ids.has(id)) ids.set(id, crypto.randomUUID()); };
  put(envelope.audit.id); put(envelope.audit.objectId);
  for (const collection of [envelope.audit.zones, envelope.audit.elements, envelope.audit.measurements, envelope.audit.findings, envelope.audit.recommendations]) Object.keys(collection).forEach(put);
  [...photos, ...envelope.drafts, ...envelope.documents, ...envelope.events].forEach((item) => put(item.id));
  // Rewrite identifiers only. Names, comments and document text remain verbatim.
  const remap = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') return (key === 'id' || key.endsWith('Id') || key.endsWith('Ids')) ? ids.get(value) ?? value : value;
    if (value instanceof Blob) return value;
    if (Array.isArray(value)) return value.map((item) => remap(item, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [ids.get(name) ?? name, remap(item, name)]));
    return value;
  };
  return { envelope: remap(envelope) as AuditBackupEnvelope, photos: remap(photos) as Photo[] };
}
export async function restoreAuditBackup(file: File, strategy: 'replace' | 'duplicate', expectedLocalRevision?: number | null): Promise<Audit> {
  check(strategy === 'replace' || strategy === 'duplicate', 'Выберите способ восстановления.');
  let { envelope, photos } = await validateFile(file); const before = await localAudit(envelope.audit.id);
  if (strategy === 'replace' && expectedLocalRevision !== undefined) check((before?.revision ?? null) === expectedLocalRevision, 'Локальное обследование изменилось после предпросмотра. Выберите файл заново.');
  if (strategy === 'duplicate') ({ envelope, photos } = cloneIds(envelope, photos));
  const audit = envelope.audit; const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([AUDIT_STORES.audits, AUDIT_STORES.photos, AUDIT_STORES.voiceDrafts, AUDIT_STORES.documents, AUDIT_STORES.events], 'readwrite'); let failure: unknown;
    const abort = (cause: unknown) => { failure = cause; tx.abort(); };
    tx.onerror = (event) => { failure ??= (event.target as IDBRequest).error; }; tx.onabort = () => reject(failure instanceof Error && !(failure instanceof DOMException) ? failure : asStorageError(failure ?? tx.error)); tx.oncomplete = () => resolve();
    const get = tx.objectStore(AUDIT_STORES.audits).get(audit.id); get.onsuccess = () => {
      try {
        const current = get.result as Audit | undefined;
        check(strategy === 'duplicate' ? !current : JSON.stringify(current) === JSON.stringify(before), 'Обследование изменилось в другой вкладке. Повторите предпросмотр восстановления.');
        if (current) {
          const sourceRevision = audit.revision; audit.revision = Math.max(current.revision, audit.revision) + 1; check(Number.isSafeInteger(audit.revision), 'Достигнут предел номера ревизии.'); audit.updatedAt = new Date().toISOString(); delete audit.reviewed; if (audit.status === 'reviewed') audit.status = 'ready_for_review';
          const transactionId = crypto.randomUUID(); envelope.events.push({ id: transactionId, transactionId, auditId: audit.id, revision: audit.revision, previousRevision: current.revision, actor: audit.author, committedAt: audit.updatedAt, commands: [{ type: 'restoreBackup', sourceRevision, exportedAt: envelope.exportedAt }] });
        }
        validateAudit(audit); checkLinks(envelope, photos);
        const collections = [
          { store: AUDIT_STORES.photos, index: 'auditId', range: IDBKeyRange.only(audit.id), values: photos },
          { store: AUDIT_STORES.voiceDrafts, index: 'auditId', range: IDBKeyRange.only(audit.id), values: envelope.drafts },
          { store: AUDIT_STORES.documents, index: 'auditId_createdAt', range: IDBKeyRange.bound([audit.id, ''], [audit.id, '\uffff']), values: envelope.documents },
          { store: AUDIT_STORES.events, index: 'auditId_revision', range: IDBKeyRange.bound([audit.id, 0], [audit.id, Number.MAX_SAFE_INTEGER]), values: envelope.events },
        ];
        for (const collection of collections) {
          const store = tx.objectStore(collection.store); const cursor = store.index(collection.index).openCursor(collection.range);
          cursor.onsuccess = () => { try { const item = cursor.result; if (item) { item.delete(); item.continue(); } else {
            // add, rather than put, rejects global ID collisions with other audits.
            for (const value of collection.values) store.add(value);
          } } catch (cause) { abort(cause); } };
        }
        tx.objectStore(AUDIT_STORES.audits).put(audit);
      } catch (cause) { abort(cause); }
    };
  });
  try { const channel = new BroadcastChannel(AUDIT_SYNC_CHANNEL); channel.postMessage({ type: 'audit-committed', auditId: audit.id, revision: audit.revision, transactionId: crypto.randomUUID(), tabId: crypto.randomUUID() }); channel.close(); } catch { /* Revision checks still protect commits if messaging is unavailable. */ }
  return audit;
}
