import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Camera, Check, Printer, Mic } from 'lucide-react';
import { AuditPrintView } from './audit-print-view.js';
import type { Audit, AuditCommand } from '../../domain/audit-model.js';
import { audits, createEditor } from '../audits/audit-service.js';
import type { EditorController } from '../editor/editor-controller.js';
import { useEditorController } from '../editor/use-editor-controller.js';
import { RevisionConflictDialog } from '../editor/revision-conflict-dialog.js';
import { SaveStatusBadge } from '../editor/save-status-badge.js';
import { BackupDialog } from '../backup/backup-dialog.js';
import { Button } from '../../components/ui/button.js';
import { voiceDrafts, type VoiceDraft } from '../../voice/voice-drafts.js';
import { auditReadiness } from './readiness.js';
import { captureDocument, listDocuments, loadDocument, type DocumentBundle } from '../../documents/document-store.js';
import type { DocumentSnapshot } from '../../documents/act-draft.js';
import { pwaUpdates } from '../../pwa/pwa-update-controller.js';
import { updateParticipants } from '../../pwa/update-participants.js';
import { registerNavigationGuard } from '../../app/navigation-guards.js';
type Controller = EditorController<Audit, AuditCommand>;

function Review({ controller, navigate, register }: { controller: Controller; navigate(route: string): void; register(controller: Controller | undefined): void }) {
  const snapshot = useEditorController(controller); const audit = snapshot.value;
  const pwa = useSyncExternalStore(pwaUpdates.subscribe, pwaUpdates.getSnapshot, pwaUpdates.getSnapshot);
  const [drafts, setDrafts] = useState<VoiceDraft[]>([]); const [documents, setDocuments] = useState<DocumentSnapshot[]>([]);
  const [expert, setExpert] = useState(audit.responsibleExpert?.name ?? ''); const [error, setError] = useState(''); const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false); const busyRef = useRef(false); const participant = useRef<(() => void) | undefined>(undefined); const [print, setPrint] = useState<DocumentBundle>();
  const readiness = auditReadiness(audit, drafts);
  const [documentBytes, setDocumentBytes] = useState<{ revision: number; bytes: number }>();
  const total = Object.keys(audit.elements).length; const ready = Math.max(0, total - readiness.notReady);
  const reviewed = !!audit.reviewed && snapshot.saveState.kind === 'saved';
  useEffect(() => { register(controller); return () => register(undefined); }, [controller, register]);
  useEffect(() => { let active = true; setLoaded(false); void Promise.all([voiceDrafts.list(audit.id), listDocuments(audit.id)]).then(([voice, docs]) => { if (active) { setDrafts(voice); setDocuments(docs); setLoaded(true); } }, (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось получить материалы.'); }); return () => { active = false; }; }, [audit.id, audit.revision]);
  useEffect(() => { if (!participant.current && pwa.status !== 'preparing') participant.current = updateParticipants.add({ prepareUpdate: async () => !busyRef.current, releaseUpdate() {} }); }, [pwa.status]);
  useEffect(() => { const guard = registerNavigationGuard(() => !busyRef.current); const warn = (event: BeforeUnloadEvent) => { if (busyRef.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn);
    return () => { guard(); participant.current?.(); window.removeEventListener('beforeunload', warn); };
  }, []);
  const edit = (elementId: string, field: string, voice?: string) => navigate(`#/audits/${audit.id}?element=${encodeURIComponent(elementId)}&field=${encodeURIComponent(field)}${voice ? `&voice=${voice}` : ''}`);
  const review = async () => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError('');
    try { if (!expert.trim()) throw new Error('Укажите имя эксперта.'); controller.enqueue({ type: 'reviewAudit', expert: { id: audit.responsibleExpert?.id ?? crypto.randomUUID(), name: expert.trim() } }); if ((await controller.flush()).kind !== 'saved') { if (controller.getSnapshot().saveState.kind === 'error') { controller.discardPending((command) => command.type === 'reviewAudit'); setDrafts(await voiceDrafts.list(audit.id)); } throw new Error('Проверка пока не сохранена. Разрешите конфликт или проверьте голосовые черновики.'); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить проверку.'); } finally { busyRef.current = false; setBusy(false); }
  };
  const exportDocument = async (format: 'docx' | 'print', savedId?: string) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setStatus('');
    try {
      if ((await controller.flush()).kind !== 'saved') throw new Error('Сначала завершите сохранение или разрешите конфликт.');
      const bundle = savedId ? await loadDocument(savedId) : await captureDocument(audit.id, controller.getSnapshot().base.revision);
      setDocuments(await listDocuments(audit.id)); setStatus(`Снимок документа сохранён. Редакция ${bundle.snapshot.auditRevision}.`);
      if (format === 'print') setPrint(bundle);
      else { const { exportActDocx, downloadAct } = await import('../../documents/act-export.js'); const blob = await exportActDocx(bundle.snapshot, bundle.photos); setDocumentBytes({ revision: bundle.snapshot.auditRevision, bytes: blob.size }); downloadAct(blob, bundle.snapshot); setStatus(`Снимок редакции ${bundle.snapshot.auditRevision} сохранён. DOCX передан браузеру для скачивания.`); }
      const latest = await audits.load(audit.id); if (latest && latest.revision > bundle.snapshot.auditRevision) setStatus((text) => `${text} Текущая редакция обследования уже ${latest.revision}; документ содержит выбранную редакцию ${bundle.snapshot.auditRevision}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Экспорт не завершён.'); } finally { busyRef.current = false; setBusy(false); }
  };
  return <main className="audit-page audit-review">
    <header className="workspace-topbar review-topbar"><div className="workspace-topbar-inner">
      <Button className="review-back" aria-label="Вернуться к карточкам" disabled={busy} onClick={() => navigate(`#/audits/${audit.id}`)}><ChevronLeft size={20} aria-hidden /><span>Назад в редактор</span></Button>
      <div className="workspace-title"><span className="workspace-kicker">Сводка · {audit.scope.includedZones.join(', ')}</span><h1>{audit.object.name}</h1></div>
      <Button aria-label="Экспорт документа" className="quiet-button" onClick={() => document.getElementById('act-export')?.scrollIntoView({ behavior: 'smooth' })}><Download size={18} aria-hidden /><span>Экспорт</span></Button>
    </div></header>
    <div className="workspace-content review-content">
      <div className="review-object-line"><p>{audit.object.address}</p><SaveStatusBadge compact state={snapshot.saveState} onRetry={() => { void controller.retry(); }} /></div>
      <section className="review-card readiness-card"><div className="review-section-heading"><h2>{audit.scope.includedZones.length === 1 ? 'Готовность входной группы' : 'Готовность обследования'}</h2><span className={`audit-pill ${readiness.ready && loaded ? 'audit-pill-ready' : ''}`}>{ready} из {total}</span></div>
        <div className="review-progress" role="progressbar" aria-label="Готовность карточек обследования" aria-valuenow={ready} aria-valuemin={0} aria-valuemax={total}><div style={{ width: `${total ? ready / total * 100 : 0}%` }} /></div>
        <div className="review-counts"><div><strong>{readiness.notReady}</strong><p>Карточек не готово</p></div><div><strong>{readiness.pendingDrafts.length}</strong><p>Черновиков диктовки</p></div><div><strong>{readiness.questions.length}</strong><p>Полей для проверки</p></div></div>
        {!loaded && <p role="status">Загружаем голосовые черновики и документы</p>}
        {(readiness.questions.length > 0 || readiness.pendingDrafts.length > 0) && <h3>Что требуется уточнить</h3>}
        <div className="review-issues">{readiness.questions.map((question, index) => <Button className="review-issue" key={`${question.elementId}-${question.field}-${index}`} disabled={busy} onClick={() => edit(question.elementId, question.field)}><span><strong>{audit.elements[question.elementId]?.name ?? 'Форма'}: </strong><span>{question.message}</span></span><ChevronRight size={18} aria-hidden /></Button>)}
          {readiness.pendingDrafts.map((draft) => <Button className="review-issue" key={draft.id} disabled={busy} onClick={() => edit(draft.elementId, 'comment', draft.id)}><Mic size={18} aria-hidden /><span><strong>Проверить голосовой черновик: {audit.elements[draft.elementId]?.name}</strong><span>Откройте запись и подтвердите текст.</span></span><ChevronRight size={18} aria-hidden /></Button>)}
        </div>
        {loaded && readiness.ready && <p className="review-ready-note"><Check size={18} aria-hidden />Карточки завершены, голосовые черновики разобраны. Материалы готовы для экспертной проверки.</p>}
      </section>
      <section className="review-card expert-card"><div className="review-section-heading"><h2>Экспертная проверка</h2><Button role="switch" aria-checked={reviewed} aria-label="Проверено экспертом" className={`expert-switch ${reviewed ? 'is-checked' : ''}`} disabled={busy || !loaded || !readiness.ready || !expert.trim() || !!audit.archivedAt || snapshot.locked || !!audit.reviewed} onClick={() => { void review(); }}><span className="expert-switch-thumb" /></Button></div>
        <p className="expert-switch-label">Проверено экспертом</p>
        {reviewed && audit.reviewed ? <p className="expert-record" data-expert-status="reviewed">Проверено экспертом: {audit.reviewed.by.name}. Редакция {audit.reviewed.auditRevision}, {new Date(audit.reviewed.at).toLocaleString('ru-RU')}.</p> : <p className="review-muted" data-expert-status="unreviewed">Эта редакция ещё не проверена экспертом.</p>}
        <label className="expert-name-field">Имя эксперта<input aria-label="Имя эксперта" value={expert} disabled={busy || !!audit.archivedAt || snapshot.locked} onChange={(event) => setExpert(event.target.value)} /></label>
        <p className="review-caption">Отметка относится к текущей редакции. Последующие правки снимают её. Имя указывает пользователь устройства.</p>
      </section>
      <section className="review-card document-card" id="act-export"><div className="review-section-heading"><h2>Документ обследования</h2><FileText size={22} aria-hidden /></div>
        <div className="document-preview"><div className="document-preview-icon"><FileText size={32} aria-hidden /></div><div><strong>Черновик акта · {audit.scope.includedZones.join(', ')}</strong><p>Таблицы элементов и замеров, подтверждённые замечания и рекомендации.</p><div className="document-facts"><span>{total} элементов</span><span><Camera size={14} aria-hidden />{audit.photoIds.length} фото</span></div></div></div>
        <p className="review-caption">Другие зоны объекта не входят в этот фрагмент. Неполные сведения отмечаются в файле.</p>
        <p className="document-size">{documentBytes ? `DOCX редакции ${documentBytes.revision}: ${(documentBytes.bytes / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ` : 'Размер DOCX будет рассчитан при формировании.'}</p>
        <div className="document-actions"><Button variant="primary" disabled={busy || !loaded || snapshot.locked} onClick={() => { void exportDocument('docx'); }}><Download size={18} aria-hidden />Скачать DOCX</Button><Button aria-label="Открыть печатную версию" disabled={busy || !loaded || snapshot.locked} onClick={() => { void exportDocument('print'); }}><Printer size={18} aria-hidden />Печать / PDF (A4)</Button></div>
        <p role="status" aria-live="polite">{busy ? 'Обрабатываем материалы на устройстве' : status}</p>{error && <p role="alert" className="field-error">{error}</p>}
        {documents.length > 0 && <details className="document-history" open><summary>Сохранённые редакции <span>{documents.length}</span></summary>{documents.map((document) => <div className="document-history-item" key={document.id}><p><strong>Редакция {document.auditRevision}</strong> · {new Date(document.createdAt).toLocaleString('ru-RU')}</p><p className="review-caption">{document.status === 'reviewed' ? 'С экспертной проверкой' : 'Без экспертной проверки'}. Пробелов: {document.missingInformation.length}.</p><div className="button-row"><Button disabled={busy} onClick={() => { void exportDocument('docx', document.id); }}>DOCX этой редакции</Button><Button disabled={busy} onClick={() => { void exportDocument('print', document.id); }}>Печатная версия этой редакции</Button></div></div>)}</details>}
      </section>
      <div className="review-backup"><BackupDialog auditId={audit.id} beforeOperation={async () => (await controller.flush()).kind === 'saved'} onRestored={(id) => navigate(`#/audits/${id}`)} /><p>Переносимая копия записей и фотографий.</p></div>
    </div>
    {print && <AuditPrintView bundle={print} close={() => setPrint(undefined)} />}
    <RevisionConflictDialog open={snapshot.saveState.kind === 'conflict'} local={snapshot.value} remote={snapshot.remote} onLoadLatest={() => controller.loadLatest()} />
  </main>;
}
export function AuditReviewPage({ id, navigate, register }: { id: string; navigate(route: string): void; register(controller: Controller | undefined): void }) {
  const [controller, setController] = useState<Controller>(); const [error, setError] = useState('');
  useEffect(() => { let active = true; void audits.load(id).then((audit) => { if (active) { if (!audit) setError('Обследование не найдено.'); else setController(createEditor(audit)); } }, (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось открыть сводку.'); }); return () => { active = false; }; }, [id]);
  if (error) return <main className="audit-page"><p role="alert">{error}</p><Button onClick={() => navigate('#/audits')}>Все обследования</Button></main>;
  return controller ? <Review controller={controller} navigate={navigate} register={register} /> : <main className="audit-page" role="status">Открываем сводку</main>;
}
