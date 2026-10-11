import { useEffect, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { Camera, ImagePlus, X, type LucideIcon } from 'lucide-react';
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
export function PhotoPicker({ audit, element, controller, strip = false }: { audit: Audit; element: Element; controller: EditorController<Audit, AuditCommand>; strip?: boolean }) {
  const pwa = useSyncExternalStore(pwaUpdates.subscribe, pwaUpdates.getSnapshot, pwaUpdates.getSnapshot);
  const mediaButton = useRef<HTMLButtonElement>(null); const camera = useRef<HTMLInputElement>(null); const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [preview, setPreview] = useState<{ photo: Photo; overTarget: boolean }>();
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
  const select = (file: File | undefined) => { if (!file) { pending.current = false; return; } fileRef.current = file; context.current = { auditId: audit.id, elementId: element.id }; void process(file, 'compact'); };
  const add = async () => {
    if (!preview) return;
    try { controller.enqueue({ type: 'attachPhoto', photo: preview.photo }); pending.current = false; setPreview(undefined); fileRef.current = undefined;
      await controller.flush();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Фото пока не сохранено.'); }
  };
  const disabled = Boolean(audit.archivedAt) || controller.getSnapshot().locked || busy;
  const choose = (source: 'camera' | 'gallery', trigger: HTMLButtonElement) => {
    mediaButton.current = trigger;
    context.current = { auditId: audit.id, elementId: element.id };
    pending.current = true;
    (source === 'camera' ? camera : gallery).current?.click();
  };
  return <section className="photo-picker" aria-label="Добавление фотографии">
    <div className={strip ? 'photo-source-buttons' : 'photo-source-buttons photo-source-inline'}>
      <button ref={mediaButton} type="button" className="photo-strip-add" aria-label="Снять фото" disabled={disabled} onClick={event => choose('camera', event.currentTarget)}><Camera size={24} aria-hidden /></button>
      <button type="button" className="photo-strip-add" aria-label="Выбрать из медиатеки" disabled={disabled} onClick={event => choose('gallery', event.currentTarget)}><ImagePlus size={24} aria-hidden /></button>
    </div>
    <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" hidden onChange={(event) => { select(event.target.files?.[0]); event.target.value = ''; }} />
    <input ref={gallery} type="file" accept="image/*" hidden onChange={(event) => { select(event.target.files?.[0]); event.target.value = ''; }} />
    {busy && <p role="status">Обрабатываем фотографию</p>}{error && <p role="alert" className="field-error">{error}</p>}
    <Dialog.Root open={Boolean(preview)} onOpenChange={(open) => { if (!open && !busy) { setPreview(undefined); pending.current = false; fileRef.current = undefined; } }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content photo-dialog photo-fullscreen" onCloseAutoFocus={(event) => { event.preventDefault(); mediaButton.current?.focus(); }} onPointerDownOutside={(event) => event.preventDefault()}>
        <Dialog.Title className="sr-only">Проверьте фотографию перед добавлением</Dialog.Title><Dialog.Description className="sr-only">Увеличьте снимок и проверьте читаемость шкал. В обследование попадёт одна выбранная копия.</Dialog.Description>
        {preview && <><PhotoView key={preview.photo.id} blob={preview.photo.blob} caption="Предварительный просмотр снимка" />
          <div className="photo-dock">
          {preview.overTarget && <p className="photo-size-notice">Подробный снимок больше 3 МБ.</p>}
          <label>Подпись фотографии<input placeholder={element.name} value={preview.photo.caption} onChange={(event) => setPreview({ ...preview, photo: { ...preview.photo, caption: event.target.value } })} /></label>
          <div className="photo-dock-actions"><Button disabled={busy} onClick={() => camera.current?.click()}>Переснять</Button>
          <Button variant="primary" disabled={busy} onClick={() => { void add(); }}>Добавить фото к элементу</Button></div>
          <details className="photo-quality"><summary>Качество снимка</summary><Button disabled={busy} onClick={() => { if (fileRef.current) void process(fileRef.current, detailed ? 'compact' : 'detailed'); }}>{detailed ? 'Использовать уменьшенную копию' : 'Использовать подробную копию'}</Button></details>
          </div></>}
        <Dialog.Close asChild><button className="photo-close" disabled={busy} aria-label="Отменить добавление"><X size={20} aria-hidden /></button></Dialog.Close>
      </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
