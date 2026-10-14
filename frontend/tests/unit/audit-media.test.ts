import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { detectImage, MAX_INPUT_BYTES, sha256 } from '../../src/media/audit-media.js';
import { applyAuditCommands, createZ2Audit, normalizeAudit, validateAudit, type Audit, type AuditCommand } from '../../src/domain/audit-model.js';
import { photoMetadata, type Photo } from '../../src/media/photo-contract.js';
import { photoEventCommands } from '../../src/media/photo-storage.js';
import { Z2_TEMPLATE } from '../../src/templates/z2-template.js';
const actor = { id: randomUUID(), name: 'Инспектор' }; const at = '2026-10-10T12:00:00Z';
it('restores an archived audit without changing its inspection records and keeps archived records read-only', () => {
  const original = initial(); const elementId = Object.keys(original.elements)[0]!;
  const archived = reduce(original, { type: 'archiveAudit' });
  expect(() => reduce(archived, { type: 'updateElement', elementId, patch: { comment: 'Изменение' } })).toThrow('только для чтения');
  const restored = reduce(archived, { type: 'unarchiveAudit' });
  expect(restored.archivedAt).toBeUndefined();
  expect(archived.archivedAt).toBe(at);
  expect(restored.elements).toEqual(archived.elements);
  expect(restored.measurements).toEqual(archived.measurements);
  expect(restored.photoIds).toEqual(archived.photoIds);
  expect(restored.revision).toBe(archived.revision + 1);
  expect(reduce(restored, { type: 'updateElement', elementId, patch: { comment: 'Снова доступно' } }).elements[elementId]!.comment).toBe('Снова доступно');
  expect(() => reduce(restored, { type: 'unarchiveAudit' })).toThrow('основном списке');
});
function initial() { return createZ2Audit({ object: { name: 'Объект', address: 'Москва' }, author: actor, inspectedOn: '2026-10-10', purpose: 'Вход' }, { auditId: randomUUID(), objectId: randomUUID(), zoneId: randomUUID(), elementIds: Z2_TEMPLATE.elements.map(() => randomUUID()) }, at); }
function reduce(audit: Audit, ...commands: AuditCommand[]) { return applyAuditCommands(audit, commands, { auditId: audit.id, actor, committedAt: at, revision: audit.revision + 1, transactionId: randomUUID() }); }
function photo(audit: Audit, elementId: string): Photo { const blob = new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' }); return { id: randomUUID(), auditId: audit.id, elementId, blob, mime: 'image/jpeg', bytes: blob.size, sha256: 'a'.repeat(64), width: 10, height: 20, caption: 'Вход', createdAt: at, measurementIds: [], findingIds: [] }; }
it('detects supported signatures and rejects deceptive MIME, SVG and executable filenames', async () => {
  expect(await detectImage(new Blob([new Uint8Array([255, 216, 255, 0])]), 'a.jpg')).toBe('jpeg');
  expect(await detectImage(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]), 'a.png')).toBe('png');
  expect(await detectImage(new Blob(['RIFF0000WEBPdata']), 'a.webp')).toBe('webp');
  await expect(detectImage(new Blob(['<svg/>'], { type: 'image/jpeg' }), 'fake.jpg')).rejects.toThrow();
  await expect(detectImage(new Blob([new Uint8Array([255, 216, 255])]), 'a.exe')).rejects.toThrow();
  await expect(detectImage(new Blob(['MZabc']), 'fake.png')).rejects.toThrow();
});
it('rejects oversized and empty input before decoding', async () => {
  await expect(detectImage(new Blob([]))).rejects.toThrow('20 МБ');
  await expect(detectImage(new Blob([new Uint8Array(MAX_INPUT_BYTES + 1)]))).rejects.toThrow('20 МБ');
});
it('hashes exactly the final blob', async () => { expect(await sha256(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); });
it('AC-02: distinct doors own distinct photo IDs; audit contains no Blob', () => {
  let audit = initial(); const door = Object.values(audit.elements)[0]!; const second = randomUUID();
  audit = reduce(audit, { type: 'addElement', id: second, zoneId: door.zoneId, elementType: 'door', name: 'Вторая дверь' });
  const a = photo(audit, door.id), b = photo(audit, second); audit = reduce(audit, { type: 'attachPhoto', photo: a }, { type: 'attachPhoto', photo: b });
  expect(audit.elements[door.id]?.photoIds).toEqual([a.id]); expect(audit.elements[second]?.photoIds).toEqual([b.id]);
  expect(JSON.stringify(audit)).not.toContain('blob'); expect(photoMetadata(a)).not.toHaveProperty('blob');
  expect((photoEventCommands([{ type: 'attachPhoto', photo: a }])[0] as { photo: object }).photo).not.toHaveProperty('blob');
});
it('links to measurements/findings must belong to the same element; detach cleans links and restore preserves IDs', () => {
  let audit = initial(); const door = Object.values(audit.elements)[0]!; const other = Object.values(audit.elements)[1]!; const findingId = randomUUID();
  audit = reduce(audit, { type: 'addFinding', finding: { id: findingId, elementId: door.id, type: 'observation', text: 'Порог', measurementIds: [], photoIds: [] } });
  const image = photo(audit, door.id); image.findingIds = [findingId]; audit = reduce(audit, { type: 'attachPhoto', photo: image });
  expect(audit.findings[findingId]?.photoIds).toEqual([image.id]);
  expect(() => reduce(audit, { type: 'updatePhoto', photoId: image.id, elementId: other.id, caption: '', measurementIds: [], findingIds: [] })).toThrow();
  audit = reduce(audit, { type: 'detachPhoto', photoId: image.id, elementId: door.id }); expect(audit.findings[findingId]?.photoIds).toEqual([]); expect(audit.photoIds).toEqual([]);
  audit = reduce(audit, { type: 'restorePhoto', photo: image }); expect(audit.photoIds).toEqual([image.id]);
});
it('normalizes earlier M1 cards without touching the original or legacy data', () => { const audit = initial(); delete (audit.elements[Object.keys(audit.elements)[0]!] as Partial<Audit['elements'][string]>).photoIds;
  const next = normalizeAudit(audit); validateAudit(next); expect(Object.values(next.elements)[0]?.photoIds).toEqual([]); expect(Object.values(audit.elements)[0]?.photoIds).toBeUndefined(); });
