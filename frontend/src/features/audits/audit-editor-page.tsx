import { useEffect, useState } from 'react';
import { ZONE_TEMPLATES, templateForZone, type SupportedZoneCode } from '../../domain/templates/index.js';
import type { Audit, AuditCommand } from '../../domain/audit-model.js';
import { audits, createEditor } from './audit-service.js';
import { useEditorController } from '../editor/use-editor-controller.js';
import type { EditorController } from '../editor/editor-controller.js';
import { AuditHeader } from './audit-header.js';
import { BottomActionBar } from './bottom-action-bar.js';
import { RevisionConflictDialog } from '../editor/revision-conflict-dialog.js';
import { ElementAccordion } from '../editor/element-accordion.js';
import { ObjectDetailsForm } from './object-details-form.js';
import { voiceDrafts } from '../../voice/voice-drafts.js';
import { VoiceController } from '../voice/voice-controller.js';
import { useVoiceController } from '../voice/use-voice-controller.js';
import { DictationPanel, VoiceDraftSheet } from '../voice/dictation-panel.js';
import { BackupDialog } from '../backup/backup-dialog.js';
import { Button } from '../../components/ui/button.js';
type Focus = { focusElementId?: string | undefined; focusField?: string | undefined; voiceDraftId?: string | undefined };
type Controller = EditorController<Audit, AuditCommand>;
function Editor({ controller, navigate, register, focusElementId, focusField, voiceDraftId }: Focus & { controller: Controller; navigate: (route: string) => void; register: (controller: Controller | undefined) => void }) {
  const snapshot = useEditorController(controller); const audit = snapshot.value;
  const [details, setDetails] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false); const [draftsCount, setDraftsCount] = useState(0);
  const elements = Object.values(audit.elements); const readyCount = elements.filter((element) => element.readiness === 'ready').length;
  const [activeZone, setActiveZone] = useState<SupportedZoneCode>(() => (audit.zones[audit.elements[focusElementId ?? '']?.zoneId ?? '']?.code ?? 'Z2') as SupportedZoneCode);
  const [zoneError, setZoneError] = useState(''); const [switching, setSwitching] = useState(false);
  const zone = Object.values(audit.zones).find(zone => zone.code === activeZone) ?? Object.values(audit.zones).find(zone => zone.code === 'Z2') ?? Object.values(audit.zones)[0]!;
  const zoneElements = zone.elementIds.map(id => audit.elements[id]!);
  const focusedZone = audit.zones[audit.elements[focusElementId ?? '']?.zoneId ?? '']?.code;
  useEffect(() => { if (focusedZone) setActiveZone(focusedZone as SupportedZoneCode); }, [focusElementId, focusedZone]);
  const [voice] = useState(() => new VoiceController()); useVoiceController(voice);
  useEffect(() => { register(controller); return () => register(undefined); }, [controller, register]);
  useEffect(() => { let active = true; if (voiceDraftId) void voiceDrafts.list(audit.id).then(async (drafts) => { const draft = drafts.find((item) => item.id === voiceDraftId); if (active && draft) await voice.resume(draft); }); return () => { active = false; }; }, [voiceDraftId, voice, audit.id]);
  const selectZone = async (code: SupportedZoneCode) => {
    if (switching || code === zone.code) return;
    setSwitching(true); setZoneError('');
    try {
      await voice.stop();
      if ((await controller.flush()).kind !== 'saved') throw new Error('Сначала завершите сохранение или разрешите конфликт.');
      const fresh = controller.getSnapshot().value;
      if (!Object.values(fresh.zones).some(zone => zone.code === code)) {
        const template = templateForZone(code);
        controller.enqueue({ type: 'initializeZone', code, id: crypto.randomUUID(), elementIds: template.elements.map(() => crypto.randomUUID()) });
        if ((await controller.flush()).kind !== 'saved') throw new Error('Новая зона пока не сохранена.');
      }
      setActiveZone(code);
    } catch (cause) { setZoneError(cause instanceof Error ? cause.message : 'Не удалось открыть зону.'); }
    finally { setSwitching(false); }
  };
  return <main className="audit-page audit-editor pb-[88px]">
    <AuditHeader name={audit.object.name} saveState={snapshot.saveState} zoneLabel={`${({ Z1: 'Территория', Z2: 'Входная группа', Z3: 'Пути внутри здания', Z4: 'Санузел' } as Record<string,string>)[zone.code]} · ${zone.code}`} readyCount={zoneElements.filter(element => element.readiness === 'ready').length} totalCount={zoneElements.length} draftsCount={draftsCount}
      onBack={() => navigate('#/audits')} onDraftsOpen={() => setDraftsOpen(true)} onRetry={() => { void controller.retry(); }}>
      <nav className="zone-switcher zone-scope-bar" aria-label="Зоны обследования">{ZONE_TEMPLATES.map(template => <button key={template.code} type="button" aria-current={zone.code === template.code ? 'page' : undefined} disabled={snapshot.locked || switching || (Boolean(audit.archivedAt) && !Object.values(audit.zones).some(zone => zone.code === template.code))} onClick={() => { void selectZone(template.code as SupportedZoneCode); }}>{template.code} {({ Z1: 'Территория', Z2: 'Вход', Z3: 'Внутри', Z4: 'Санузел' } as Record<string,string>)[template.code]}</button>)}</nav>
    </AuditHeader>
    <div className="audit-editor-content">{zoneError && <p role="alert" className="field-error">{zoneError}</p>}
    <div className="object-management">{audit.archivedAt ? <p className="notice">Обследование в архиве. Данные доступны для просмотра.</p> : <Button className="object-details-button" variant="secondary" disabled={snapshot.locked} onClick={async () => { void voice.stop(); if ((await controller.flush()).kind === 'saved') setDetails(!details); }}>Данные объекта</Button>}<BackupDialog auditId={audit.id} beforeOperation={async () => { await voice.stop(); return (await controller.flush()).kind === 'saved'; }} onRestored={(id) => navigate(`#/audits/${id}`)} /></div>
    {details && <ObjectDetailsForm initial={audit} onCancel={() => setDetails(false)} onSubmit={async (values) => {
      controller.enqueue({ type: 'updateObjectDetails', object: values.object, inspectedOn: values.inspectedOn, author: { ...audit.author, name: values.authorName } });
      controller.enqueue({ type: 'setScope', includedZones: [...audit.scope.includedZones], purpose: values.purpose });
      if ((await controller.flush()).kind !== 'saved') throw new Error('Данные объекта пока не сохранены.'); setDetails(false);
    }} />}
    <section aria-labelledby="zone-heading"><h2 id="zone-heading" className="sr-only" tabIndex={-1}>{zone.title}</h2>
      <ElementAccordion key={zone.id} zoneId={zone.id} audit={audit} controller={controller} voice={voice} focusElementId={focusElementId} focusField={focusField} /></section></div>
    <VoiceDraftSheet audit={audit} controller={voice} open={draftsOpen} onClose={() => setDraftsOpen(false)} onCountChange={setDraftsCount} />
    <BottomActionBar readyCount={readyCount} totalCount={elements.length} disabled={snapshot.locked} onReview={() => { void voice.stop(); navigate(`#/audits/${audit.id}/review`); }} />
    <DictationPanel controller={voice} editor={controller} />
    <RevisionConflictDialog open={snapshot.saveState.kind === 'conflict'} local={snapshot.value} remote={snapshot.remote} onLoadLatest={() => controller.loadLatest()} />
  </main>;
}
export function AuditEditorPage({ id, navigate, register, ...focus }: Focus & { id: string; navigate: (route: string) => void; register: (controller: Controller | undefined) => void }) {
  const [controller, setController] = useState<Controller>(); const [error, setError] = useState('');
  useEffect(() => { let active = true; setController(undefined); setError(''); void audits.load(id).then((audit) => {
    if (active) { if (audit) setController(createEditor(audit)); else setError('Обследование не найдено.'); }
  }, (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось открыть обследование.'); }); return () => { active = false; }; }, [id]);
  if (error) return <main className="audit-page"><p role="alert">{error}</p><Button onClick={() => navigate('#/audits')}>Все обследования</Button></main>;
  if (!controller) return <main className="audit-page" role="status">Открываем обследование</main>;
  return <Editor key={id} {...focus} controller={controller} navigate={navigate} register={register} />;
}
