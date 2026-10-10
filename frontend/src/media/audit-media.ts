import type { UUID } from '../domain/contracts.js';
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const TARGET_BYTES = 3 * 1024 * 1024;
export { photoMetadata, type Photo, type PhotoMetadata } from './photo-contract.js';
import type { Photo } from './photo-contract.js';
export class MediaError extends Error { constructor(message: string) { super(message); this.name = 'MediaError'; } }
export async function detectImage(file: Blob, name = ''): Promise<'jpeg' | 'png' | 'webp' | 'heic'> {
  if (!file.size || file.size > MAX_INPUT_BYTES) throw new MediaError('Выберите непустую фотографию размером до 20 МБ.');
  if (/\.(svg|html?|js|mjs|exe|com|bat|cmd|sh|ps1)$/i.test(name) || /svg|javascript|html|executable/i.test(file.type)) throw new MediaError('SVG и исполняемые файлы нельзя добавлять как фотографии.');
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer()); const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && /heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(ascii(8, 64))) return 'heic';
  throw new MediaError('Поддерживаются фотографии JPEG, PNG и WebP. Файл не содержит поддерживаемого изображения.');
}
export async function sha256(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new MediaError('Для безопасного сохранения фото откройте приложение по HTTPS или на localhost.');
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release(): void }> {
  if (typeof createImageBitmap === 'function') {
    try { const image = await createImageBitmap(blob, { imageOrientation: 'from-image' }); return { source: image, width: image.width, height: image.height, release: () => image.close() }; }
    catch { /* HTMLImageElement is also an EXIF-aware native decoder. Never rotate a decoded image again. */ }
  }
  const url = URL.createObjectURL(blob); const image = new Image();
  try { image.src = url; await image.decode(); return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => { image.src = ''; URL.revokeObjectURL(url); } }; }
  catch (cause) { image.src = ''; URL.revokeObjectURL(url); throw cause; }
}
function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new MediaError('Браузер не смог обработать фото. Попробуйте изображение меньшего размера.')), 'image/jpeg', quality));
}
export async function processPhoto(file: File, context: { auditId: UUID; elementId: UUID; measurementIds?: UUID[]; findingIds?: UUID[]; caption?: string }, mode: 'compact' | 'detailed' = 'compact'): Promise<{ photo: Photo; overTarget: boolean }> {
  const format = await detectImage(file, file.name);
  let decoded: Awaited<ReturnType<typeof decode>>;
  try { decoded = await decode(file); } catch { throw new MediaError(format === 'heic' ? 'Этот браузер не может открыть HEIC/HEIF. Сохраните снимок как JPEG и выберите его снова.' : 'Не удалось прочитать фотографию. Файл может быть повреждён.'); }
  const canvas = document.createElement('canvas');
  try {
    if (!decoded.width || !decoded.height) throw new MediaError('У изображения нет корректных размеров.');
    const ratio = mode === 'compact' ? Math.min(1, 2560 / Math.max(decoded.width, decoded.height)) : 1;
    canvas.width = Math.max(1, Math.round(decoded.width * ratio)); canvas.height = Math.max(1, Math.round(decoded.height * ratio));
    const drawing = canvas.getContext('2d'); if (!drawing) throw new MediaError('Обработка фотографий недоступна в этом браузере.');
    drawing.fillStyle = '#fff'; drawing.fillRect(0, 0, canvas.width, canvas.height); drawing.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    let blob = await encode(canvas, mode === 'detailed' ? .98 : .94);
    if (mode === 'compact') for (const quality of [.90, .86, .82]) { if (blob.size <= TARGET_BYTES) break; blob = await encode(canvas, quality); }
    // Keep a quality floor. The inspector checks instrument scales in the preview rather than accepting aggressive compression silently.
    if (blob.size > MAX_INPUT_BYTES) throw new MediaError('Обработанная фотография превышает 20 МБ. Выберите уменьшенную копию.');
    const photo: Photo = { id: crypto.randomUUID(), ...context, measurementIds: [...context.measurementIds ?? []], findingIds: [...context.findingIds ?? []], caption: context.caption ?? '',
      blob, mime: 'image/jpeg', width: canvas.width, height: canvas.height, bytes: blob.size, sha256: await sha256(blob), createdAt: new Date().toISOString() };
    return { photo, overTarget: blob.size > TARGET_BYTES };
  } finally { decoded.release(); canvas.width = 0; canvas.height = 0; }
}
