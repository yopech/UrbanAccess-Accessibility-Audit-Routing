import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { loadPhoto } from '../../media/photo-storage.js';
import type { Photo } from '../../media/photo-contract.js';
import { PARAMETER_LABELS } from '../../domain/measurements.js';
import type { Audit, AuditCommand, Element } from '../../domain/audit-model.js';
import type { EditorController } from './editor-controller.js';
import { pwaUpdates } from '../../pwa/pwa-update-controller.js';
import { updateParticipants } from '../../pwa/update-participants.js';
import { registerNavigationGuard } from '../../app/navigation-guards.js';
import { PhotoViewer } from './photo-viewer.js';
function PhotoCard({ photo, audit, controller, readOnly, onDetach }: { photo: Photo; audit: Audit; controller: EditorController<Audit, AuditCommand>; readOnly: boolean; onDetach(photo: Photo): void }) {
  const pwa = useSyncExternalStore(pwaUpdates.subscribe, pwaUpdates.getSnapshot, pwaUpdates.getSnapshot);
  const [editing, setEditing] = useState(false); const [caption, setCaption] = useState(photo.caption);
  const [measurements, setMeasurements] = useState(photo.measurementIds); const [findings, setFindings] = useState(photo.findingIds); const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false); const draft = useRef(false); draft.current = editing || removing;
  const participantRelease = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { if (!participantRelease.current && pwa.status !== 'preparing') participantRelease.current = updateParticipants.add({ prepareUpdate: async () => !draft.current, releaseUpdate() {} }); }, [pwa.status]);
  useEffect(() => {
    const guard = registerNavigationGuard(() => !draft.current || confirm('Закрыть несохранённую подпись и связи фотографии?'));
    const warn = (event: BeforeUnloadEvent) => { if (draft.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn);
    return () => { participantRelease.current?.(); participantRelease.current = undefined; guard(); window.removeEventListener('beforeunload', warn); }; }, []);
  const toggle = (ids: string[], id: string, checked: boolean) => checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id);
  return <article className="photo-card"><PhotoViewer blob={photo.blob} caption={photo.caption} /><p>{photo.caption || 'Без подписи'}</p>
    {photo.measurementIds.map((id) => <p className="secondary-text" key={id}>Замер: {audit.measurements[id]?.parameter === 'custom' ? 'Дополнительный' : PARAMETER_LABELS[audit.measurements[id]?.parameter as keyof typeof PARAMETER_LABELS]} · версия {audit.measurements[id]?.revision}</p>)}
    {photo.findingIds.map((id) => <p className="secondary-text" key={id}>Замечание: {audit.findings[id]?.text}</p>)}
    {!readOnly && <div className="button-row"><Button onClick={() => { setCaption(photo.caption); setMeasurements(photo.measurementIds); setFindings(photo.findingIds); setEditing(true); }}>Подпись и связи</Button>
      <Button variant="danger" onClick={() => setRemoving(true)}><Trash2 aria-hidden />Отвязать фото</Button></div>}
    <Dialog.Root open={editing} onOpenChange={setEditing}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content">
      <Dialog.Title>Подпись и связи фотографии</Dialog.Title><Dialog.Description>Свяжите снимок с замерами или замечаниями этой карточки. Сами показания не изменятся.</Dialog.Description>
      <label>Подпись фотографии<input value={caption} onChange={(event) => setCaption(event.target.value)} /></label>
      <fieldset><legend>Замеры элемента</legend>{Object.values(audit.measurements).filter((item) => item.elementId === photo.elementId && (item.primary || measurements.includes(item.id))).map((item) => <label className="check-field" key={item.id}>
        <input type="checkbox" checked={measurements.includes(item.id)} onChange={(event) => setMeasurements(toggle(measurements, item.id, event.target.checked))} /><span>{item.parameter === 'custom' ? item.customLabel : PARAMETER_LABELS[item.parameter]}: {item.raw.text} {item.raw.unit}, версия {item.revision}</span></label>)}
        {!Object.values(audit.measurements).some((item) => item.elementId === photo.elementId) && <p>Сначала зафиксируйте замер в карточке.</p>}</fieldset>
      <fieldset><legend>Замечания элемента</legend>{Object.values(audit.findings).filter((item) => item.elementId === photo.elementId).map((item) => <label className="check-field" key={item.id}>
        <input type="checkbox" checked={findings.includes(item.id)} onChange={(event) => setFindings(toggle(findings, item.id, event.target.checked))} /><span>{item.text || 'Замечание без текста'}</span></label>)}</fieldset>
      {error && <p role="alert" className="field-error">{error}</p>}
      <Button variant="primary" onClick={async () => { try { controller.enqueue({ type: 'updatePhoto', photoId: photo.id, elementId: photo.elementId, caption, measurementIds: measurements, findingIds: findings });
        if ((await controller.flush()).kind === 'saved') setEditing(false); else setError('Изменения остаются в редакторе. Завершите сохранение перед закрытием.');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить связи.'); } }}>Сохранить подпись и связи</Button>
      <Dialog.Close asChild><Button>Закрыть</Button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={removing} onOpenChange={setRemoving}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content">
      <Dialog.Title>Отвязать фотографию?</Dialog.Title><Dialog.Description>Фото исчезнет из рабочей карточки и замечаний. Снимок останется в хранилище для истории и сохранённых документов.</Dialog.Description>
      <Button variant="danger" onClick={() => { onDetach(photo); setRemoving(false); }}>Подтвердить отвязку</Button><Dialog.Close asChild><Button>Отмена</Button></Dialog.Close>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </article>;
}
export function PhotoGallery({ audit, element, controller }: { audit: Audit; element: Element; controller: EditorController<Audit, AuditCommand> }) {
  const [photos, setPhotos] = useState<Photo[]>([]); const [error, setError] = useState(''); const [removed, setRemoved] = useState<Photo>();
  const snapshot = controller.getSnapshot(); const ids = element.photoIds.join(',');
  useEffect(() => { let active = true; void Promise.all(element.photoIds.map(loadPhoto)).then((values) => { if (active) { setPhotos(values.filter((photo): photo is Photo => Boolean(photo))); setError(''); } }, (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось прочитать фото.'); }); return () => { active = false; }; }, [ids, snapshot.base.revision]);
  const pending = element.photoIds.filter((id) => !snapshot.base.photoIds.includes(id));
  const readOnly = Boolean(audit.archivedAt) || snapshot.locked;
  if (!element.photoIds.length && !removed && !error) return null;
  return <section aria-label="Фотографии элемента"><h3>Фотографии элемента</h3>{error && <p role="alert" className="field-error">{error}</p>}
    <div className="photo-grid">{photos.filter((photo) => element.photoIds.includes(photo.id)).map((photo) => <PhotoCard key={photo.id} photo={photo} audit={audit} controller={controller} readOnly={readOnly} onDetach={(value) => {
      controller.enqueue({ type: 'detachPhoto', photoId: value.id, elementId: element.id }); setRemoved(value); void controller.flush();
    }} />)}</div>
    {pending.length > 0 && <div className="notice"><p>Фото ожидает сохранения на устройстве.</p>{snapshot.saveState.kind === 'error' && <Button onClick={async () => { try {
      controller.discardPending((command) => (command.type === 'attachPhoto' || command.type === 'restorePhoto') ? pending.includes(command.photo.id)
        : (command.type === 'updatePhoto' || command.type === 'detachPhoto') && pending.includes(command.photoId));
      await controller.flush(); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось убрать несохранённое фото.'); } }}>Убрать несохранённое фото и сохранить текст</Button>}</div>}
    {removed && !element.photoIds.includes(removed.id) && !readOnly && <div className="notice"><p>Фото отвязано от рабочей карточки.</p><Button onClick={() => { controller.enqueue({ type: 'restorePhoto', photo: removed }); setRemoved(undefined); void controller.flush(); }}>Вернуть фото</Button></div>}
    {!element.photoIds.length && <p className="secondary-text">Фотографий пока нет.</p>}
  </section>;
}
