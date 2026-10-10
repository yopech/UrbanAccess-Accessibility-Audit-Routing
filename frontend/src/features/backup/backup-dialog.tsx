import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Download, Upload, X } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { prepareAuditBackup, downloadAuditBackup, inspectAuditBackup, restoreAuditBackup, type BackupPreview, type PreparedBackup } from './backup-service.js';
import { updateParticipants } from '../../pwa/update-participants.js';
import { registerNavigationGuard } from '../../app/navigation-guards.js';
const size = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МБ`;
export function BackupDialog({ auditId, beforeOperation, onRestored, triggerLabel, intent }: { auditId?: string; beforeOperation?: () => Promise<boolean>; onRestored: (id: string) => void; triggerLabel?: string; intent?: 'duplicate' }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [error, setError] = useState(''); const [status, setStatus] = useState(''); const [prepared, setPrepared] = useState<PreparedBackup>();
  const [file, setFile] = useState<File>(); const [preview, setPreview] = useState<BackupPreview>(); const [strategy, setStrategy] = useState<'replace' | 'duplicate'>('duplicate');
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { const guard = registerNavigationGuard(() => !busyRef.current); const warn = (event: BeforeUnloadEvent) => { if (busyRef.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn);
    return () => { guard(); release.current?.(); window.removeEventListener('beforeunload', warn); };
  }, []);
  const operation = async (run: () => Promise<void>) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setStatus('');
    try { release.current = updateParticipants.add({ prepareUpdate: async () => !busyRef.current, releaseUpdate() {} }); if (beforeOperation && !await beforeOperation()) throw new Error('Сначала завершите сохранение или разрешите конфликт.'); await run(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Операция с резервной копией не завершена.'); }
    finally { busyRef.current = false; setBusy(false); release.current?.(); release.current = undefined; }
  };
  const inspect = (selected?: File) => { if (!selected || busyRef.current) return; setFile(selected); setPreview(undefined); setPrepared(undefined); setStrategy('duplicate'); void operation(async () => { setPreview(await inspectAuditBackup(selected)); }); };
  const close = () => { if (busyRef.current) return; setOpen(false); setFile(undefined); setPreview(undefined); setPrepared(undefined); setError(''); setStatus(''); };
  return <Dialog.Root open={open} onOpenChange={(value) => { if (value) setOpen(true); else close(); }}>
    <Dialog.Trigger asChild><Button className="backup-trigger">{triggerLabel ?? (auditId ? 'Резервная копия' : 'Восстановить из копии')}</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content backup-dialog" onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busyRef.current) event.preventDefault(); }}>
      <Dialog.Title>{intent === 'duplicate' ? 'Создать копию обследования' : 'Резервное копирование обследования'}</Dialog.Title><Dialog.Description>Файл содержит записи, голосовые черновики, историю, документы и фотографии в исходном качестве. Всё обрабатывается на устройстве.</Dialog.Description>
      <Button disabled={busy} onClick={close} aria-label="Закрыть резервное копирование"><X size={18} aria-hidden />Закрыть</Button>
      {intent === 'duplicate' && auditId && <section><p>Создадим независимое обследование с теми же записями и фотографиями. Исходное обследование останется без изменений.</p><Button variant="primary" disabled={busy} onClick={() => { let restoredId: string | undefined; void operation(async () => { const backup = await prepareAuditBackup(auditId); const restored = await restoreAuditBackup(backup.file, 'duplicate'); restoredId = restored.id; setOpen(false); }).then(() => { if (restoredId) onRestored(restoredId); }); }}>Создать копию обследования</Button></section>}
      {intent !== 'duplicate' && auditId && <section><h3>Экспорт</h3><p>Соберите копию, чтобы увидеть полный размер файла вместе с фотографиями.</p>
        <Button disabled={busy} onClick={() => { setPrepared(undefined); void operation(async () => { setPrepared(await prepareAuditBackup(auditId)); }); }}><Download size={18} aria-hidden />Подготовить резервную копию</Button>
        {prepared && <><p>Размер: {size(prepared.file.size)}. Фотографий: {prepared.preview.photos}. Редакция: {prepared.preview.backupRevision}.</p><Button variant="primary" disabled={busy} onClick={() => { downloadAuditBackup(prepared.file); setStatus('Файл передан браузеру для скачивания.'); }}>Скачать резервную копию</Button></>}
      </section>}
      {intent !== 'duplicate' && <section><h3>Восстановление</h3><label className="backup-dropzone" onDragOver={(event) => { event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); inspect(event.dataTransfer.files[0]); }}>
        <Upload size={24} aria-hidden /><span>Выберите файл .ngo или .json, либо перетащите его сюда</span><input type="file" aria-label="Файл резервной копии" accept=".ngo,.json,application/json" disabled={busy} onChange={(event) => { inspect(event.target.files?.[0]); event.target.value = ''; }} />
      </label>
      {preview && <div className="backup-preview"><h3>{preview.name}</h3><p>Копия от {new Date(preview.exportedAt).toLocaleString('ru-RU')}. Размер: {size(preview.bytes)}.</p><p>Элементов: {preview.elements}; замеров: {preview.measurements}; замечаний: {preview.findings}; фотографий: {preview.photos}.</p>
        <p className="backup-integrity" role="status">Целостность данных подтверждена</p>
        {preview.collision ? <fieldset disabled={busy}><legend>Обследование уже есть на устройстве</legend>
          <label className="check-field"><input type="radio" name="backup-strategy" checked={strategy === 'duplicate'} onChange={() => setStrategy('duplicate')} />Создать копию</label>
          <label className="check-field"><input type="radio" name="backup-strategy" checked={strategy === 'replace'} onChange={() => setStrategy('replace')} />Заменить существующее</label>
          {strategy === 'replace' && <p>Текущие материалы будут заменены данными файла. Восстановление получит новую ревизию; текущую экспертную проверку потребуется повторить.</p>}
        </fieldset> : <p>Совпадений ID нет. Обследование будет восстановлено с исходными идентификаторами и ревизиями.</p>}
        <Button variant="primary" disabled={busy || !file} onClick={() => { let restoredId: string | undefined; void operation(async () => { const restored = await restoreAuditBackup(file!, preview.collision ? strategy : 'replace', preview.localRevision ?? null); setOpen(false); setPrepared(undefined); setFile(undefined); setPreview(undefined); restoredId = restored.id; }).then(() => { if (restoredId) onRestored(restoredId); }); }}>Восстановить обследование</Button>
      </div>}
      </section>}<p role="status" aria-live="polite">{busy ? 'Проверяем и обрабатываем данные на устройстве…' : status}</p>{error && <p role="alert" className="field-error">{error}</p>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
