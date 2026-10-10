import { useEffect, useRef, useState } from 'react';
import { Plus, Archive, Camera, Search, MoreHorizontal } from 'lucide-react';
import { BackupDialog } from '../backup/backup-dialog.js';
import { Button } from '../../components/ui/button.js';
import { createZ2Audit, type Audit } from '../../domain/audit-model.js';
import { Z2_TEMPLATE } from '../../templates/z2-template.js';
import { audits } from './audit-service.js';
import { ObjectDetailsForm, type ObjectDetailsValues } from './object-details-form.js';
export function AuditListPage({ navigate }: { navigate: (hash: string) => void }) {
  const [items, setItems] = useState<readonly Audit[]>([]); const [creating, setCreating] = useState(false);
  const createdId = useRef(''); const [search, setSearch] = useState('');
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [showArchive, setShowArchive] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => { void audits.list().then((values) => { if (active) { setItems([...values].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); setLoading(false); } }, (cause: unknown) => { if (active) { setError(cause instanceof Error ? cause.message : 'Не удалось прочитать обследования.'); setLoading(false); } }); };
    refresh(); const unsubscribe = audits.subscribe(refresh); return () => { active = false; unsubscribe(); };
  }, []);
  const create = async (values: ObjectDetailsValues) => {
    const actor = { id: crypto.randomUUID(), name: values.authorName }; const id = crypto.randomUUID();
    const audit = createZ2Audit({ object: values.object, inspectedOn: values.inspectedOn, author: actor, purpose: values.purpose },
      { auditId: id, objectId: crypto.randomUUID(), zoneId: crypto.randomUUID(), elementIds: Z2_TEMPLATE.elements.map(() => crypto.randomUUID()) }, new Date().toISOString());
    const result = await audits.commit({ auditId: id, actor, expectedRevision: 0, transactionId: crypto.randomUUID(), commands: [{ type: 'createAudit', audit }] });
    if (result.kind !== 'committed') throw new Error('Обследование не сохранено. Повторите создание.');
    createdId.current = id;
  };
  const archive = async (audit: Audit) => {
    if (!confirm('Переместить обследование в архив? Записи останутся на устройстве.')) return;
    try { const result = await audits.commit({ auditId: audit.id, expectedRevision: audit.revision, actor: audit.author, transactionId: crypto.randomUUID(), commands: [{ type: 'archiveAudit' }] });
    if (result.kind !== 'committed') setError('Не удалось архивировать. Обновите список: запись могла измениться в другой вкладке.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось архивировать обследование.'); }
  };
  const visible = items.filter((audit) => Boolean(audit.archivedAt) === showArchive && `${audit.object.name} ${audit.object.address}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
  return <main className="audit-main audit-list-screen">
    <header className="workspace-topbar"><div className="workspace-topbar-inner">
      <div className="workspace-title"><span className="workspace-kicker">UrbanAccess</span><h1>Обследования</h1></div>
      {!creating && <Button variant="primary" className="new-audit-button" onClick={() => setCreating(true)}><Plus aria-hidden size={18} /><span>Новое обследование</span></Button>}
    </div></header>
    <div className="workspace-content">
      <div className="list-tools"><label className="audit-search"><Search size={18} aria-hidden /><input aria-label="Поиск обследований" type="search" placeholder="Название или адрес" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <BackupDialog triggerLabel="Импорт из бэкапа" onRestored={(id) => navigate(`#/audits/${id}`)} />
      </div>
      {creating && <ObjectDetailsForm onSubmit={create} onSubmitted={() => navigate(`#/audits/${createdId.current}`)} onCancel={() => setCreating(false)} />}
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="list-section-heading"><h2>{showArchive ? 'Архив' : 'На устройстве'} <span>{visible.length}</span></h2><label className="check-field archive-filter"><input type="checkbox" checked={showArchive} onChange={(event) => setShowArchive(event.target.checked)} /><span>Показать архив</span></label></div>
      {loading ? <p role="status">Загружаем обследования</p> : <>
        <div className="audit-list">{visible.map((audit) => {
          const elements = Object.values(audit.elements); const ready = elements.filter((element) => element.readiness === 'ready' && element.confirmation?.valueRevision === element.revision).length;
          return <article className="audit-list-card" key={audit.id} onClick={() => navigate(`#/audits/${audit.id}`)}>
            <div className="audit-card-heading"><div><h2><a className="audit-card-link" href={`#/audits/${audit.id}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); navigate(`#/audits/${audit.id}`); }}>{audit.object.name}</a></h2><p className="audit-card-address">{audit.object.address}</p></div>
              <details className="audit-card-menu" onClick={(event) => event.stopPropagation()}><summary aria-label={`Действия: ${audit.object.name}`}><MoreHorizontal size={22} aria-hidden /></summary><div className="audit-card-menu-panel">
                <BackupDialog auditId={audit.id} triggerLabel="Экспорт бэкапа (.ngo)" onRestored={(id) => navigate(`#/audits/${id}`)} />
                <BackupDialog auditId={audit.id} triggerLabel="Дублировать" intent="duplicate" onRestored={(id) => navigate(`#/audits/${id}`)} />
                {!audit.archivedAt && <Button onClick={() => { void archive(audit); }}><Archive size={16} aria-hidden />Архивировать</Button>}
              </div></details>
            </div>
            <p className="audit-card-date">{new Date(`${audit.inspectedOn}T12:00:00`).toLocaleDateString('ru-RU')} · {audit.author.name}</p>
            <div className="audit-card-indicators"><span className={`audit-pill ${ready === elements.length ? 'audit-pill-ready' : ''}`}>{audit.scope.includedZones.join(', ')}: {ready}/{elements.length} готово</span><span className="audit-photo-count" aria-label={`Фотографий: ${audit.photoIds.length}`}><Camera size={15} aria-hidden />{audit.photoIds.length}</span><span className="audit-work-status">{audit.archivedAt ? 'Архив' : audit.status === 'reviewed' || audit.status === 'ready_for_review' ? 'Готов к выгрузке' : 'В работе'}</span></div>
          </article>;
        })}</div>
        {!visible.length && <div className="list-empty"><Search size={28} aria-hidden /><h2>{search.trim() ? 'Ничего не найдено' : showArchive ? 'Архив пуст' : 'Первое обследование'}</h2><p>{search.trim() ? 'Попробуйте другое название или адрес.' : showArchive ? 'Архивные записи остаются на этом устройстве.' : 'Создайте объект или импортируйте резервную копию.'}</p></div>}
      </>}
    </div>
  </main>;
}
