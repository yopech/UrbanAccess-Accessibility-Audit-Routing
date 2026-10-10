import { AUDIT_STORES, openDatabase } from '../storage/database.js';
import { StorageError, asStorageError } from '../domain/contracts.js';
import type { Audit, AuditCommand } from '../domain/audit-model.js';
import { photoMetadata, validatePhoto, type Photo } from './photo-contract.js';
export function photoEventCommands(commands: readonly AuditCommand[]): readonly unknown[] {
  return commands.map((command) => command.type === 'attachPhoto' || command.type === 'restorePhoto' ? { ...command, photo: photoMetadata(command.photo) } : command);
}
export function writePhotoCommands(tx: IDBTransaction, _current: Audit | undefined, value: Audit, commands: readonly AuditCommand[], abort: (cause: unknown) => void): void {
  const store = tx.objectStore(AUDIT_STORES.photos);
  for (const command of commands) {
    if (command.type === 'attachPhoto') { validatePhoto(command.photo); store.add(command.photo); }
    else if (command.type === 'updatePhoto' || command.type === 'restorePhoto') {
      const id = command.type === 'restorePhoto' ? command.photo.id : command.photoId; const request = store.get(id);
      request.onsuccess = () => {
        try {
          const photo = request.result as Photo | undefined;
          if (!photo || photo.auditId !== value.id || photo.elementId !== (command.type === 'restorePhoto' ? command.photo.elementId : command.elementId)) throw new StorageError('INVALID_RECORD', 'Снимок не найден или связан с другой карточкой.', false);
          validatePhoto(photo);
          if (command.type === 'updatePhoto') store.put({ ...photo, caption: command.caption, measurementIds: [...command.measurementIds], findingIds: [...command.findingIds] });
          if (command.type === 'restorePhoto') {
            if (photo.sha256 !== command.photo.sha256 || photo.bytes !== command.photo.bytes || photo.width !== command.photo.width || photo.height !== command.photo.height) throw new StorageError('INVALID_RECORD', 'Содержимое сохранённого снимка отличается.', false);
            store.put({ ...photo, caption: command.photo.caption, measurementIds: [...command.photo.measurementIds], findingIds: [...command.photo.findingIds] });
          }
          // Metadata may change; the image bytes, identity and hash never change.
        } catch (cause) { abort(cause); }
      };
    }
    // Detaching keeps the Blob for event history and future document versions. Garbage collection is a separate operation.
  }
}
export async function loadPhoto(id: string): Promise<Photo | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIT_STORES.photos); const req = tx.objectStore(AUDIT_STORES.photos).get(id); let photo: Photo | undefined;
    req.onsuccess = () => { try { if (req.result) { photo = req.result as Photo; validatePhoto(photo); } } catch (cause) { reject(cause); tx.abort(); } };
    tx.oncomplete = () => resolve(photo); tx.onabort = () => reject(asStorageError(tx.error));
  });
}
