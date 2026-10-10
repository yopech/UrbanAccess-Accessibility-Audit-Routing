import { useEffect, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { Camera, type LucideIcon } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../../components/ui/button.js';
import { processPhoto, type Photo } from '../../media/audit-media.js';
import type { Audit, AuditCommand, Element } from '../../domain/audit-model.js';
import type { EditorController } from './editor-controller.js';
import { pwaUpdates } from '../../pwa/pwa-update-controller.js';
import { updateParticipants } from '../../pwa/update-participants.js';
import { registerNavigationGuard } from '../../app/navigation-guards.js';
import { PhotoView } from './photo-viewer.js';
export function MediaButton({ onClick, disabled, buttonRef, label = 'Снять или выбрать фото', icon: Icon = Camera }: { onClick(): void; disabled: boolean; buttonRef?: Ref<HTMLButtonElement>; label?: string; icon?: LucideIcon }) {
  return <div className="media-action"><button ref={buttonRef} type="button" className="media-button h-14 w-14" aria-label={label} onClick={onClick} disabled={disabled}><Icon size={22} aria-hidden /><span>{label === 'Снять или выбрать фото' ? 'Фото' : label === 'Диктовать комментарий' ? 'Комментарий' : label === 'Диктовать рекомендацию' ? 'Рекомендация' : label}</span></button></div>;
}
export function PhotoPicker({ audit, element, controller }: { audit: Audit; element: Element; controller: EditorController<Audit, AuditCommand> }) {
  const pwa = useSyncExternalStore(pwaUpdates.subscribe, pwaUpdates.getSnapshot, pwaUpdates.getSnapshot);
  const mediaButton = useRef<HTMLButtonElement>(null); const camera = useRef<HTMLInputElement>(null); const gallery = useRef<HTMLInputElement>(null);
  const [choosing, setChoosing] = useState(false); const [busy, setBusy] = useState(false); const [preview, setPreview] = useState<{ photo: Photo; overTarget: boolean }>();
  const [error, setError] = useState(''); const [detailed, setDetailed] = useState(false); const fileRef = useRef<File | undefined>(undefined); const active = useRef(true); const pending = useRef(false);
  const context = useRef<{ auditId: string; elementId: string } | undefined>(undefined);
  const participantRelease = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { if (!participantRelease.current && pwa.status !== 'preparing') participantRelease.current = updateParticipants.add({ prepareUpdate: async () => !pending.current, releaseUpdate() {} }); }, [pwa.status]);
  useEffect(() => { active.current = true;
    const guard = registerNavigationGuard(() => !pending.current || confirm('Фото ещё не добавлено. Покинуть экран и отменить его обработку?'));
    const warn = (event: BeforeUnloadEvent) => { if (pending.current) { event.preventDefault(); event.returnValue = ''; } };
    const cancel = () => { pending.current = false; }; window.addEventListener('beforeunload', warn);
    const inputs = [camera.current, gallery.current]; inputs.forEach((input) => input?.addEventListener('cancel', cancel));
    return () => { active.current = false; participantRelease.current?.(); participantRelease.current = undefined; guard(); window.removeEventListener('beforeunload', warn); inputs.forEach((input) => input?.removeEventListener('cancel', cancel)); }; }, []);
  const process = async (file: File, mode: 'compact' | 'detailed') => {
    if (!context.current) return; const captured = { ...context.current, caption: preview?.photo.caption ?? '' }; pending.current = true; setBusy(true); setError('');
    try { const result = await processPhoto(file, captured, mode); if (active.current) { setPreview(result); setDetailed(mode === 'detailed'); } }
    catch (cause) { if (active.current) { pending.current = Boolean(preview); if (!preview) fileRef.current = undefined; setError(cause instanceof Error ? cause.message : 'Не удалось обработать фото.'); } }
    finally { if (active.current) setBusy(false); }
  };
  const select = (file: File | undefined) => { setChoosing(false); if (!file) { pending.current = false; return; } fileRef.current = file; context.current = { auditId: audit.id, elementId: element.id }; void process(file, 'compact'); };
  const add = async () => {
    if (!preview) return;
    try { controller.enqueue({ type: 'attachPhoto', photo: preview.photo }); pending.current = false; setPreview(undefined); fileRef.current = undefined;
      await controller.flush();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Фото пока не сохранено.'); }
  };
  const disabled = Boolean(audit.archivedAt) || controller.getSnapshot().locked || busy;
  return <section className="photo-picker" aria-label="Добавление фотографии"><MediaButton buttonRef={mediaButton} disabled={disabled} onClick={() => setChoosing(true)} />
    <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" hidden onChange={(event) => { select(event.target.files?.[0]); event.target.value = ''; }} />
    <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(event) => { select(event.target.files?.[0]); event.target.value = ''; }} />
    <Dialog.Root open={choosing} onOpenChange={setChoosing}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content" onCloseAutoFocus={(event) => { event.preventDefault(); mediaButton.current?.focus(); }}>
      <Dialog.Title>Добавить фотографию</Dialog.Title><Dialog.Description>Снимите элемент или выберите фотографию с устройства. Поддерживаются JPEG, PNG, WebP до 20 МБ.</Dialog.Description>
      <Button onClick={() => { context.current = { auditId: audit.id, elementId: element.id }; pending.current = true; setChoosing(false); camera.current?.click(); }}>Снять камерой</Button><Button onClick={() => { context.current = { auditId: audit.id, elementId: element.id }; pending.current = true; setChoosing(false); gallery.current?.click(); }}>Выбрать с устройства</Button>
      <Dialog.Close asChild><Button>Отмена</Button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
    {busy && <p role="status">Обрабатываем фотографию</p>}{error && <p role="alert" className="field-error">{error}</p>}
    <Dialog.Root open={Boolean(preview)} onOpenChange={(open) => { if (!open && !busy) { setPreview(undefined); pending.current = false; fileRef.current = undefined; } }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content photo-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); mediaButton.current?.focus(); }} onPointerDownOutside={(event) => event.preventDefault()}>
        <Dialog.Title>Проверьте фотографию перед добавлением</Dialog.Title><Dialog.Description>Увеличьте снимок и проверьте читаемость шкал. В обследование попадёт одна выбранная копия.</Dialog.Description>
        {preview && <><PhotoView key={preview.photo.id} blob={preview.photo.blob} caption="Предварительный просмотр снимка" />
          <p>{preview.photo.width} × {preview.photo.height} пикселей, {(preview.photo.bytes / 1024 / 1024).toFixed(2)} МБ.</p>
          {preview.overTarget && <p className="notice">Размер больше целевых 3 МБ. Более сильное сжатие может ухудшить шкалы; добавляйте эту копию, если детали читаются.</p>}
          <label>Подпись фотографии<input value={preview.photo.caption} onChange={(event) => setPreview({ ...preview, photo: { ...preview.photo, caption: event.target.value } })} /></label>
          <Button disabled={busy} onClick={() => { if (fileRef.current) void process(fileRef.current, detailed ? 'compact' : 'detailed'); }}>{detailed ? 'Использовать уменьшенную копию' : 'Использовать подробную копию'}</Button>
          <Button variant="primary" disabled={busy} onClick={() => { void add(); }}>Добавить фото к элементу</Button></>}
        <Dialog.Close asChild><Button disabled={busy}>Отменить добавление</Button></Dialog.Close>
      </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
