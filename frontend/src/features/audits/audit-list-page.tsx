import { useEffect, useLayoutEffect, useState } from 'react';
import { Plus, Archive, ArchiveRestore, Search, MoreHorizontal, ChevronLeft } from 'lucide-react';
import { BackupDialog } from '../backup/backup-dialog.js';
import { Button } from '../../components/ui/button.js';
import type { Audit } from '../../domain/audit-model.js';
import { audits } from './audit-service.js';
import { ObjectDetailsForm } from './object-details-form.js';
import emptyAuditsIllustration from '../../assets/illustrations/empty-audits.png';
const landingUrl = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:5176/' : new URL('../landing/', new URL(import.meta.env.BASE_URL, location.origin)).href;
export function AuditListPage({ navigate, initialScrollY = 0 }: { navigate: (hash: string) => void; initialScrollY?: number }) {
  const [items, setItems] = useState<readonly Audit[]>([]);
  const [editing, setEditing] = useState<Audit>();
  const [openMenuId, setOpenMenuId] = useState<string>();
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.audit-card-actions, .list-more-menu')) { setOpenMenuId(undefined); setToolsOpen(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { document.querySelector<HTMLElement>('.audit-card-menu[open] > summary, .list-more-button[aria-expanded=true]')?.focus(); setOpenMenuId(undefined); setToolsOpen(false); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, []);
  const [search, setSearch] = useState(''); const [toolsOpen, setToolsOpen] = useState(false);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [showArchive, setShowArchive] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => { void audits.list().then((values) => { if (active) { setItems([...values].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); setLoading(false); } }, (cause: unknown) => { if (active) { setError(cause instanceof Error ? cause.message : 'Не удалось прочитать обследования.'); setLoading(false); } }); };
    refresh(); const unsubscribe = audits.subscribe(refresh); return () => { active = false; unsubscribe(); };
  }, []);
  useLayoutEffect(() => { if (!loading) window.scrollTo({ top: initialScrollY, behavior: 'instant' }); }, [loading, initialScrollY]);
  const archive = async (audit: Audit) => {
    if (!confirm('Переместить обследование в архив? Записи останутся на устройстве.')) return;
    try { const result = await audits.commit({ auditId: audit.id, expectedRevision: audit.revision, actor: audit.author, transactionId: crypto.randomUUID(), commands: [{ type: 'archiveAudit' }] });
    if (result.kind !== 'committed') setError('Не удалось архивировать. Обновите список: запись могла измениться в другой вкладке.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось архивировать обследование.'); }
  };
  const unarchive = async (audit: Audit) => {
    try {
      const result = await audits.commit({ auditId: audit.id, expectedRevision: audit.revision, actor: audit.author, transactionId: crypto.randomUUID(), commands: [{ type: 'unarchiveAudit' }] });
      if (result.kind !== 'committed') setError('Не удалось вернуть обследование. Обновите список: запись могла измениться в другой вкладке.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось вернуть обследование из архива.'); }
  };
  const visible = items.filter((audit) => Boolean(audit.archivedAt) === showArchive && `${audit.object.name} ${audit.object.address}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')));
  return <main className="audit-main audit-list-screen" data-page-ready={!loading}>
    <header className="workspace-topbar"><div className="workspace-topbar-inner">
      <div className="workspace-title audit-list-title"><a className="list-back-link" href={landingUrl} aria-label="Вернуться на лендинг"><ChevronLeft size={24} strokeWidth={2.5} aria-hidden /></a><h1>Обследования</h1></div>
      <div className="list-more-menu">
        <Button className="list-more-button" aria-label="Настройки списка" aria-expanded={toolsOpen} aria-controls="list-tools-panel" onClick={() => { setOpenMenuId(undefined); setToolsOpen(!toolsOpen); }}><MoreHorizontal size={22} aria-hidden /></Button>
        <div id="list-tools-panel" className="list-more-panel motion-popover" data-state={toolsOpen ? 'open' : 'closed'} aria-hidden={!toolsOpen} inert={!toolsOpen}>
          <BackupDialog triggerLabel="Импорт из бэкапа" onRestored={(id) => navigate(`#/audits/${id}`)} />
          <label className="check-field archive-filter"><input type="checkbox" checked={showArchive} onChange={(event) => { setShowArchive(event.target.checked); setToolsOpen(false); }} /><span>Показать архив</span></label>
        </div>
      </div>
    </div></header>
    <div className="workspace-content">
      <div className="list-tools"><label className="audit-search"><Search size={18} aria-hidden /><input aria-label="Поиск обследований" type="search" placeholder="Название или адрес" value={search} onChange={(event) => setSearch(event.target.value)} /></label>

      </div>
      {editing && <ObjectDetailsForm initial={editing} onCancel={() => setEditing(undefined)} onSubmit={async values => {
        const result = await audits.commit({ auditId:editing.id,expectedRevision:editing.revision,actor:editing.author,transactionId:crypto.randomUUID(),commands:[{type:'updateObjectDetails',object:values.object,inspectedOn:values.inspectedOn,author:{...editing.author,name:values.authorName}},{type:'setScope',includedZones:[...editing.scope.includedZones],purpose:values.purpose}] });
        if (result.kind !== 'committed') throw new Error('Реквизиты пока не сохранены. Обновите форму: обследование могло измениться.');
      }} onSubmitted={() => setEditing(undefined)} />}
      {error && <p role="alert" className="field-error">{error}</p>}

      {loading ? <p role="status">Загружаем обследования</p> : <>
        <div className="audit-list">{visible.map((audit) => {
          const elements = Object.values(audit.elements); const ready = elements.filter((element) => element.readiness === 'ready' && element.confirmation?.valueRevision === element.revision).length;
          return <article className="audit-list-card" key={audit.id} onClick={() => navigate(`#/audits/${audit.id}`)}>
            <div className="audit-card-heading"><div><h2><a className="audit-card-link" title={audit.object.name} href={`#/audits/${audit.id}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); navigate(`#/audits/${audit.id}`); }}>{audit.object.name}</a></h2></div>
              <div className="audit-card-actions" onClick={(event) => { event.stopPropagation(); if (!(event.target instanceof Element) || !event.target.closest('summary')) setOpenMenuId(undefined); }}>
              <details className="audit-card-menu" open={openMenuId === audit.id}><summary onClick={event => { event.preventDefault(); setToolsOpen(false); setOpenMenuId(current => current === audit.id ? undefined : audit.id); }} aria-expanded={openMenuId === audit.id} aria-label={`Действия: ${audit.object.name}`}><MoreHorizontal size={22} aria-hidden /></summary></details>
              <div className="audit-card-menu-panel motion-popover" data-state={openMenuId === audit.id ? 'open' : 'closed'} aria-hidden={openMenuId !== audit.id} inert={openMenuId !== audit.id}>
                <Button disabled={!!audit.archivedAt} onClick={async () => { try { const fresh = await audits.load(audit.id); if (fresh) setEditing(fresh); else setError('Обследование не найдено.'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось открыть реквизиты.'); } }}>Данные объекта</Button>
                <BackupDialog auditId={audit.id} triggerLabel="Резервная копия" onRestored={(id) => navigate(`#/audits/${id}`)} />
                <BackupDialog auditId={audit.id} triggerLabel="Дублировать" intent="duplicate" onRestored={(id) => navigate(`#/audits/${id}`)} />
                {!audit.archivedAt && <Button onClick={() => { void archive(audit); }}><Archive size={16} aria-hidden />Архивировать</Button>}
                {audit.archivedAt && <Button onClick={() => { void unarchive(audit); }}><ArchiveRestore size={16} aria-hidden />Вернуть из архива</Button>}
              </div></div>
            </div>
            <div className="audit-progress-labels"><span className={`audit-pill ${ready === elements.length ? 'audit-pill-ready' : ready > 0 ? 'audit-pill-progress' : ''}`}>{audit.archivedAt ? 'Архив' : ready === elements.length ? 'Завершено' : ready > 0 || elements.some(element => element.readiness !== 'not_started') ? 'В работе' : 'Черновик'}</span><span>{ready}/{elements.length} готово</span></div>
            <div className="audit-list-progress" role="progressbar" aria-label={`Готовность: ${audit.object.name}`} aria-valuenow={ready} aria-valuemin={0} aria-valuemax={elements.length}><span style={{width:`${elements.length ? ready / elements.length * 100 : 0}%`}} /></div>
            <div className="audit-card-footer"><time>{new Date(`${audit.inspectedOn}T12:00:00`).toLocaleDateString('ru-RU')}</time><span>{audit.author.name}</span></div>
          </article>;
        })}</div>
        {!visible.length && (search.trim() || showArchive ? <div className="list-empty"><Search size={28} aria-hidden /><h2>{search.trim() ? 'Ничего не найдено' : 'Архив пуст'}</h2><p>{search.trim() ? 'Попробуйте другое название или адрес.' : 'Архивные записи остаются на этом устройстве.'}</p></div> : <div className="list-empty list-empty-illustrated"><img src={emptyAuditsIllustration} width={1024} height={1536} alt="" decoding="async" /><h2>здесь будут ваши обследования</h2></div>)}
      </>}
    </div>
    <div className="audit-list-dock"><Button variant="primary" className="new-audit-button" onClick={() => navigate('#/audits/new')}><Plus size={18} aria-hidden />Новое обследование</Button>{items.find(item => !item.archivedAt) && <Button onClick={() => navigate(`#/audits/${items.find(item => !item.archivedAt)!.id}`)}>Продолжить</Button>}</div>
  </main>;
}
