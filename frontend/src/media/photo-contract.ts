import type { ISODateTime, UUID } from '../domain/contracts.js';
export interface Photo {
  id: UUID; auditId: UUID; elementId: UUID; measurementIds: UUID[]; findingIds: UUID[];
  blob: Blob; mime: 'image/jpeg' | 'image/png' | 'image/webp'; sha256: string; bytes: number;
  width: number; height: number; caption: string; createdAt: ISODateTime;
}
export type PhotoMetadata = Omit<Photo, 'blob'>;
export function photoMetadata(photo: Photo): PhotoMetadata { const { blob: _blob, ...metadata } = photo; return metadata; }

export function validatePhoto(photo: Photo): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!photo || ![photo.id, photo.auditId, photo.elementId].every((id) => typeof id === 'string' && uuid.test(id))
    || !(photo.blob instanceof Blob) || photo.bytes !== photo.blob.size || photo.bytes <= 0 || photo.bytes > 20 * 1024 * 1024
    || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mime) || photo.blob.type !== photo.mime
    || !Number.isSafeInteger(photo.width) || photo.width <= 0 || !Number.isSafeInteger(photo.height) || photo.height <= 0
    || !/^[0-9a-f]{64}$/.test(photo.sha256) || typeof photo.caption !== 'string'
    || !Array.isArray(photo.measurementIds) || !Array.isArray(photo.findingIds)
    || typeof photo.createdAt !== 'string' || !Number.isFinite(Date.parse(photo.createdAt))) throw new Error('Некорректная фотография.');
}
