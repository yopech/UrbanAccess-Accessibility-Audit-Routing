import { evaluateMeasurementNorm } from '../../domain/norms/norm-engine.js';
import { useEffect, useState } from 'react';
import { Plus, Check, Camera } from 'lucide-react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../../components/ui/accordion.js';
import { Button } from '../../components/ui/button.js';
import { elementQuestions, primaryMeasurement, type Audit, type AuditCommand, type Element, type ElementPatch } from '../../domain/audit-model.js';
import { templateForZone, CHECK_LABELS, definitionFor, measurementParametersFor } from '../../domain/templates/index.js';
import { PhotoPicker } from './photo-picker.js';
import type { VoiceController } from '../voice/voice-controller.js';
import { DictationButton } from '../voice/dictation-panel.js';
import { PhotoGallery } from './photo-gallery.js';
import { SegmentedControl } from './segmented-control.js';
import { MeasurementField } from './measurement-field.js';
import type { EditorController } from './editor-controller.js';
const readinessLabels = { not_started: 'Не начат', in_progress: 'В работе', needs_clarification: 'Нужно уточнение', ready: 'Готово' };
type Controller = EditorController<Audit, AuditCommand>;
function ElementCard({ audit, element, controller, voice, focusField }: { focusField?: string | undefined; audit: Audit; element: Element; controller: Controller; voice: VoiceController }) {
  const [error, setError] = useState(''); const [showQuestions, setShowQuestions] = useState(false);
  const finding = Object.values(audit.findings).find((item) => item.elementId === element.id);
  const recommendation = Object.values(audit.recommendations).find((item) => item.elementId === element.id);
  const update = (patch: ElementPatch) => { setError(''); controller.enqueue({ type: 'updateElement', elementId: element.id, patch }); };
  const questions = elementQuestions(audit, element);
  const normRecommendations = (value: Audit) => {
    const current = value.elements[element.id];
    if (!current || current.presence === 'absent' || current.applicability === 'not_applicable') return [];
    return measurementParametersFor(current.type).flatMap((parameter) => {
      const measurement = primaryMeasurement(value, current.id, parameter); const input = current.measurementInputs[parameter];
      if (!measurement || (input && (input.text !== measurement.raw.text || input.unit !== measurement.raw.unit))) return [];
      const result = evaluateMeasurementNorm(parameter, measurement.normalized, undefined, current.type);
      return result && result.status !== 'ok' ? [result.recommendation] : [];
    });
  };
  const insertNormRecommendations = () => {
    const fresh = controller.getSnapshot().value;
    const existing = Object.values(fresh.recommendations).find((item) => item.elementId === element.id);
    const additions = normRecommendations(fresh).filter((text) => !existing?.text.includes(text));
    if (!additions.length) return;
    controller.enqueue({ type: 'updateRecommendation', recommendation: {
      id: existing?.id ?? crypto.randomUUID(), elementId: element.id,
      findingIds: Object.values(fresh.findings).filter((item) => item.elementId === element.id).map((item) => item.id),
      text: [existing?.text.trim(), ...additions].filter(Boolean).join('\n\n'),
    } });
  };

  const note = (value: string) => {
    const fresh = controller.getSnapshot().value;
    const existing = Object.values(fresh.findings).find((item) => item.elementId === element.id);
    const type = fresh.elements[element.id]!.presence === 'absent' ? 'absence' : 'observation';
    controller.enqueue(existing ? { type: 'updateFinding', id: existing.id, text: value, findingType: type }
      : { type: 'addFinding', finding: { id: crypto.randomUUID(), elementId: element.id, type, text: value, measurementIds: [], photoIds: [] } });
  };
  const confirm = async () => {
    try { controller.enqueue({ type: 'confirmElement', elementId: element.id }); await controller.flush(); setError(''); }
    catch (cause) { setShowQuestions(true); setError(cause instanceof Error ? cause.message : 'Проверьте карточку.'); }
  };
  return <div className="element-body px-4 pt-4 pb-5 flex flex-col gap-5" data-audit-element={element.id} onBlur={() => { void controller.flush(); }}>
    <fieldset className="element-field-section" disabled={Boolean(audit.archivedAt) || controller.getSnapshot().locked}>
      <details className="element-details" open={focusField === 'name'}><summary>Название и расположение</summary><label>Название элемента<input data-audit-field="name" value={element.name} onChange={(event) => update({ name: event.target.value })} /></label>
      <label>Расположение<input value={element.location} placeholder="Например, главный вход справа" onChange={(event) => update({ location: event.target.value })} /></label>
      </details><div className="status-fields">
        <SegmentedControl label="Применимость" field="applicability" value={element.applicability} onChange={(applicability) => update({ applicability })} options={[
          { value: 'unknown', label: 'Не определена' }, { value: 'applicable', label: 'Применим', accessibleLabel: 'Применим к этому входу' }, { value: 'not_applicable', label: 'Не применим' }]} />
        <SegmentedControl label="Наличие" field="presence" value={element.presence} onChange={(presence) => update({ presence, ...(presence === 'absent' && element.operability === 'working' ? { operability: 'unknown' as const } : {}) })} options={[
          { value: 'unknown', label: 'Не проверено' }, { value: 'present', label: 'Есть' }, { value: 'absent', label: 'Отсутствует' }]} />
        <SegmentedControl label="Работоспособность" field="operability" value={element.operability} onChange={(operability) => update({ operability })} options={[
          { value: 'unknown', label: 'Не проверена' }, { value: 'working', label: 'Исправен', disabled: element.presence === 'absent' }, { value: 'defective', label: 'Дефект' },
          { value: 'not_working', label: 'Не работает' }, { value: 'not_applicable', label: 'Не применима' }]} />
      </div>
      {element.presence === 'absent' && <p className="notice">Зафиксируйте отсутствие в замечании.</p>}
      {element.applicability === 'not_applicable' && <label>Причина неприменимости<textarea data-audit-field="exclusionReason" value={element.exclusionReason ?? ''} onChange={(event) => update({ exclusionReason: event.target.value })} /></label>}
      {element.presence !== 'absent' && element.applicability !== 'not_applicable' && <section className="measurement-block" aria-label="Замеры"><h3>Замеры</h3><div className="measurement-grid grid grid-cols-2 gap-3">
        {measurementParametersFor(element.type).map((parameter) => <MeasurementField key={parameter} audit={audit} element={element} parameter={parameter} controller={controller} />)}
      </div></section>}
      {element.presence !== 'absent' && element.applicability !== 'not_applicable' && (definitionFor(element.type).checks ?? []).map(parameter => <SegmentedControl key={parameter} label={CHECK_LABELS[parameter]} field={parameter} value={element.checks?.[parameter] ?? 'unknown'} options={[
        { value: 'unknown', label: 'Не проверено' }, { value: 'present', label: 'Есть' }, { value: 'absent', label: 'Отсутствует' },
      ]} onChange={value => controller.enqueue({ type: 'setElementCheck', elementId: element.id, parameter, value })} />)}
      <label>Дополнительный комментарий<textarea aria-label="Дополнительный комментарий" value={element.comment} placeholder="Описание и детали обследования" onChange={(event) => update({ comment: event.target.value })} /></label>
      <details className="element-details" open={element.presence === 'absent' || focusField === 'finding' || Boolean(finding?.text || recommendation?.text)}><summary>Замечание и рекомендация</summary><label>Замечание{element.presence === 'absent' ? ' об отсутствии' : ''}<textarea data-audit-field="finding" value={finding?.text ?? ''} placeholder="Что обнаружили при обследовании" onChange={(event) => note(event.target.value)} /></label>
      {normRecommendations(audit).length > 0 && <Button className="norm-recommendation-pill" onClick={insertNormRecommendations}><Plus size={16} aria-hidden />Вставить рекомендацию по СП 59</Button>}
      <label>Рекомендация<textarea aria-label="Рекомендация" value={recommendation?.text ?? ''} placeholder="Что предлагаете сделать" onChange={(event) => {
        const fresh = controller.getSnapshot().value;
        const existing = Object.values(fresh.recommendations).find((item) => item.elementId === element.id);
        controller.enqueue({ type: 'updateRecommendation', recommendation: { id: existing?.id ?? crypto.randomUUID(), elementId: element.id,
          findingIds: Object.values(fresh.findings).filter((item) => item.elementId === element.id).map((item) => item.id), text: event.target.value } });
      }} /></label>
      </details>
    </fieldset>
      <div className="element-action-bar" role="group" aria-label="Фото и диктовка">
        <PhotoPicker audit={audit} element={element} controller={controller} />
        <fieldset disabled={Boolean(audit.archivedAt) || controller.getSnapshot().locked}><DictationButton audit={audit} element={element} mode="comment" controller={voice} baseRevision={controller.getSnapshot().base.revision} /></fieldset>
        <fieldset className="recommendation-action" disabled={Boolean(audit.archivedAt) || controller.getSnapshot().locked}><DictationButton audit={audit} element={element} mode="recommendation" controller={voice} baseRevision={controller.getSnapshot().base.revision} /></fieldset>
      </div>
      <PhotoGallery audit={audit} element={element} controller={controller} />
    <fieldset disabled={Boolean(audit.archivedAt) || controller.getSnapshot().locked}>
      {questions.length > 0 && <div className="card-questions"><button className="question-toggle" type="button" aria-expanded={showQuestions} onClick={() => setShowQuestions(!showQuestions)}>Осталось уточнить: {questions.length}</button>{showQuestions && <ul>{questions.map((question) => <li key={question.field}>{question.message}</li>)}</ul>}</div>}
      <div className="button-row"><Button data-audit-field="readiness" variant="primary" onClick={() => { void confirm(); }}><Check size={22} aria-hidden />Подтвердить карточку</Button>
        <Button variant="secondary" onClick={() => controller.enqueue({ type: 'setElementReadiness', elementId: element.id, readiness: 'needs_clarification' })}>Нужно уточнение</Button></div>
      {error && <p role="alert" className="field-error">{error}</p>}
    </fieldset>
  </div>;
}
export function ElementAccordion({ audit, controller, voice, focusElementId, focusField, zoneId }: { audit: Audit; controller: Controller; voice: VoiceController; zoneId?: string; focusElementId?: string | undefined; focusField?: string | undefined }) {
  const zone = (zoneId ? audit.zones[zoneId] : Object.values(audit.zones).find(zone => zone.code === 'Z2'))!;
  const [open, setOpen] = useState<string[]>([focusElementId && zone.elementIds.includes(focusElementId) ? focusElementId : zone.elementIds[0]!]);
  useEffect(() => { if (!focusElementId) { if (focusField === 'template') document.querySelector<HTMLElement>('[data-audit-field=template]')?.focus(); return; } const target = document.querySelector<HTMLElement>(`[data-audit-element="${CSS.escape(focusElementId)}"] [data-audit-field="${CSS.escape(focusField ?? 'readiness')}"]`); target?.focus(); target?.scrollIntoView({ block: 'center' }); }, [focusElementId, focusField]);
  const [error, setError] = useState('');
  const change = async (next: string[]) => { void voice.stop(); const result = await controller.flush(); if (result.kind === 'saved') { setOpen(next); setError(''); } else setError('Сначала завершите сохранение или разрешите конфликт.'); };
  return <><Accordion type="multiple" value={open} onValueChange={(next) => { void change(next); }}>
    {zone.elementIds.map((id) => { const element = audit.elements[id]!; return <AccordionItem key={id} value={id} className="element-card">
      <AccordionTrigger className="element-trigger bg-white rounded-2xl border border-zinc-200/80 px-4 py-3.5">
        <span className={`readiness-dot readiness-dot-${element.readiness}`} aria-hidden />
        <span className="element-title"><strong className="text-[15px] font-semibold">{element.name || definitionFor(element.type).name}</strong>{element.location && <span className="element-location text-[13px] text-zinc-500">{element.location}</span>}
          {element.readiness === 'ready' && element.confirmation?.valueRevision === element.revision && <span className="measurement-summary">{definitionFor(element.type).parameters.map((parameter) => primaryMeasurement(audit, element.id, parameter)).filter((measurement) => !!measurement).map((measurement) => `${Number(measurement.normalized.value.toFixed(2)).toLocaleString('ru-RU')} ${measurement.normalized.unit === 'cm' ? 'см' : '%'}`).join(' · ')}</span>}
        </span>
        <span className="element-summary">
          {element.readiness === 'needs_clarification' ? <span className="readiness-badge readiness-needs_clarification">{readinessLabels[element.readiness]}</span> : <span className="sr-only">{readinessLabels[element.readiness]}</span>}
          {element.photoIds.length > 0 && <span className="photo-count" aria-label={`Фотографий: ${element.photoIds.length}`}><Camera size={16} aria-hidden />{element.photoIds.length}</span>}
        </span>
      </AccordionTrigger>
      <AccordionContent className="element-accordion-content"><ElementCard audit={audit} element={element} controller={controller} voice={voice} focusField={focusElementId === element.id ? focusField : undefined} /></AccordionContent>
    </AccordionItem>; })}
  </Accordion>
  {!audit.archivedAt && <div className="add-element-chips" role="group" aria-label="Добавить элемент">
    {templateForZone(zone.code).elements.map((definition, index) => { const type = definition.type; const count = zone.elementIds.filter(id => audit.elements[id]?.type === type).length; const name = `${definition.name} ${count + 1}`;
      return <Button key={type} data-audit-field={index === 0 ? 'template' : undefined} variant="secondary" disabled={controller.getSnapshot().locked} onClick={() => { const id = crypto.randomUUID();
        controller.enqueue({ type: 'addElement', id, zoneId: zone.id, elementType: type, name: `${definitionFor(type).name} ${count + 1}` }); void change([...open, id]);
      }}><Plus size={18} aria-hidden />{name}</Button>;
    })}
  </div>}
  {error && <p role="alert" className="field-error">{error}</p>}</>;
}
