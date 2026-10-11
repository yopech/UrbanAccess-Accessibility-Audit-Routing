import { evaluateMeasurementNorm } from '../../domain/norms/norm-engine.js';
import { useEffect, useState } from 'react';
import { Plus, Check, Camera, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { elementQuestions, primaryMeasurement, type Audit, type AuditCommand, type Element, type ElementPatch, type Operability } from '../../domain/audit-model.js';
import { templateForZone, CHECK_LABELS, definitionFor, measurementParametersFor } from '../../domain/templates/index.js';
import type { VoiceController } from '../voice/voice-controller.js';
import { DictationButton } from '../voice/dictation-panel.js';
import { PhotoGallery } from './photo-gallery.js';
import { ElementIcon } from './element-icon.js';
import { elementVisualStatus } from './element-visual-status.js';
import { SegmentedControl } from './segmented-control.js';
import { MeasurementField } from './measurement-field.js';
import type { EditorController } from './editor-controller.js';
type Controller = EditorController<Audit, AuditCommand>;
function AttributeToggle({ label, field, value, positive, negative, onChange }: { label: string; field: string; value: string; positive: string; negative: string; onChange(value: boolean): void }) {
  return <div className="attribute-toggle-row"><span><strong>{label}</strong><small>{value === 'unknown' ? 'Не проверено' : value === 'applicable' || value === 'present' ? positive : negative}</small></span><button type="button" role="switch" aria-label={label} aria-checked={value === 'applicable' || value === 'present'} data-audit-field={field} data-unchecked={value === 'unknown'} className="apple-attribute-toggle" onClick={() => onChange(value !== 'applicable' && value !== 'present')}><span /></button></div>;
}
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
        <AttributeToggle label="Применимость" field="applicability" value={element.applicability} positive="Применим" negative="Не применим" onChange={(checked) => update({ applicability: checked ? 'applicable' : 'not_applicable' })} />
        <AttributeToggle label="Наличие" field="presence" value={element.presence} positive="Есть" negative="Отсутствует" onChange={(checked) => { const presence = checked ? 'present' : 'absent'; update({ presence, ...(presence === 'absent' && element.operability === 'working' ? { operability: 'unknown' as const } : {}) }); }} />
        <label className="operability-row"><span>Работоспособность</span><span className="operability-choice"><select aria-label="Работоспособность" data-audit-field="operability" value={element.operability} onChange={(event) => update({ operability: event.target.value as Operability })}>
          <option value="unknown">Не проверена</option><option value="working" disabled={element.presence === 'absent'}>Исправен</option><option value="defective">Дефект</option><option value="not_working">Не работает</option><option value="not_applicable">Не применима</option>
        </select><ChevronRight size={18} aria-hidden /></span></label>
      </div>
      {element.presence === 'absent' && <p className="notice">Зафиксируйте отсутствие в замечании.</p>}
      {element.applicability === 'not_applicable' && <label>Причина неприменимости<textarea data-audit-field="exclusionReason" value={element.exclusionReason ?? ''} onChange={(event) => update({ exclusionReason: event.target.value })} /></label>}
      {element.presence !== 'absent' && element.applicability !== 'not_applicable' && <section className="measurement-block" aria-label="Замеры"><h3>Замеры</h3><div className="measurement-grid grid grid-cols-2 gap-3">
        {measurementParametersFor(element.type).map((parameter) => <MeasurementField key={parameter} audit={audit} element={element} parameter={parameter} controller={controller} />)}
      </div></section>}
      {element.presence !== 'absent' && element.applicability !== 'not_applicable' && (definitionFor(element.type).checks ?? []).map(parameter => <SegmentedControl key={parameter} label={CHECK_LABELS[parameter]} field={parameter} value={element.checks?.[parameter] ?? 'unknown'} options={[
        { value: 'unknown', label: 'Не проверено', variant: 'warning' }, { value: 'present', label: 'Есть', variant: 'success' }, { value: 'absent', label: 'Отсутствует', variant: 'danger' },
      ]} onChange={value => controller.enqueue({ type: 'setElementCheck', elementId: element.id, parameter, value })} />)}
      <section className="element-notes" aria-label="Записи инспектора"><h3>Записи инспектора</h3><details className="note-row"><summary><span>Дополнительный комментарий<small>{element.comment || 'Описание и детали обследования'}</small></span><ChevronRight size={18} aria-hidden /></summary><label>Дополнительный комментарий<textarea aria-label="Дополнительный комментарий" value={element.comment} placeholder="Описание и детали обследования" onChange={(event) => update({ comment: event.target.value })} /></label></details>
      <details className="note-row" open={element.presence === 'absent' || focusField === 'finding'}><summary><span>Замечания и дефекты<small>{finding?.text || 'Наблюдения и выявленные дефекты'}</small></span><ChevronRight size={18} aria-hidden /></summary><label>Замечание{element.presence === 'absent' ? ' об отсутствии' : ''}<textarea data-audit-field="finding" value={finding?.text ?? ''} placeholder="Что обнаружили при обследовании" onChange={(event) => note(event.target.value)} /></label>
      </details><details className="note-row" open={focusField === 'recommendation'}><summary><span>Рекомендация по СП 59<small>{recommendation?.text || 'Предлагаемые мероприятия'}</small></span><ChevronRight size={18} aria-hidden /></summary>
      {normRecommendations(audit).length > 0 && <Button className="norm-recommendation-pill" onClick={insertNormRecommendations}><Plus size={16} aria-hidden />Вставить рекомендацию по СП 59</Button>}
      <label>Рекомендация<textarea data-audit-field="recommendation" aria-label="Рекомендация" value={recommendation?.text ?? ''} placeholder="Что предлагаете сделать" onChange={(event) => {
        const fresh = controller.getSnapshot().value;
        const existing = Object.values(fresh.recommendations).find((item) => item.elementId === element.id);
        controller.enqueue({ type: 'updateRecommendation', recommendation: { id: existing?.id ?? crypto.randomUUID(), elementId: element.id,
          findingIds: Object.values(fresh.findings).filter((item) => item.elementId === element.id).map((item) => item.id), text: event.target.value } });
      }} /></label>
      </details></section>
    </fieldset>
      <div className="element-action-bar" role="group" aria-label="Фото и диктовка">
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
export function ElementAccordion({ audit, controller, voice, focusElementId, focusField, zoneId, onOpenElement }: { audit: Audit; controller: Controller; voice: VoiceController; zoneId?: string; focusElementId?: string | undefined; focusField?: string | undefined; onOpenElement(id: string): void }) {
  const zone = (zoneId ? audit.zones[zoneId] : Object.values(audit.zones).find(zone => zone.code === 'Z2'))!;
  const [error, setError] = useState('');
  useEffect(() => { if (!focusElementId) { if (focusField === 'template') document.querySelector<HTMLElement>('[data-audit-field=template]')?.focus(); return; } const target = document.querySelector<HTMLElement>(`[data-audit-element="${CSS.escape(focusElementId)}"] [data-audit-field="${CSS.escape(focusField ?? 'name')}"]`); if (focusField) { target?.focus(); target?.scrollIntoView({ block: 'center' }); } }, [focusElementId, focusField]);
  const selected = audit.elements[focusElementId ?? ''];
  if (selected && zone.elementIds.includes(selected.id)) return <section className="element-detail-page"><header className="element-detail-heading"><ElementIcon elementType={selected.type} /><h2>{selected.name || definitionFor(selected.type).name}</h2>{selected.readiness === 'needs_clarification' && <span className="readiness-badge readiness-needs_clarification">Нужно уточнение</span>}</header><ElementCard audit={audit} element={selected} controller={controller} voice={voice} focusField={focusField} /></section>;
  return <><div className="element-navigation-list">{zone.elementIds.map(id => { const element = audit.elements[id]!; return <article key={id} className="element-card border-l-4" data-visual-status={elementVisualStatus(audit, element)}>
    <button type="button" className="element-trigger element-navigation-row" aria-label={`Открыть элемент: ${element.name}`} onClick={() => onOpenElement(id)}>
      <ElementIcon elementType={element.type} /><span className="element-title"><strong>{element.name || definitionFor(element.type).name}</strong>{element.location && <span className="element-location">{element.location}</span>}</span>
      <span className="element-summary">{element.readiness === 'needs_clarification' && <span className="readiness-badge readiness-needs_clarification">Нужно уточнение</span>}{element.photoIds.length > 0 && <span className="photo-count" aria-label={`Фотографий: ${element.photoIds.length}`}><Camera size={16} aria-hidden />{element.photoIds.length}</span>}</span><ChevronRight size={20} aria-hidden />
    </button></article>; })}</div>
    {!audit.archivedAt && <div className="add-element-chips" role="group" aria-label="Добавить элемент">{templateForZone(zone.code).elements.map((definition,index) => { const count = zone.elementIds.filter(id => audit.elements[id]?.type === definition.type).length;
      return <Button key={definition.type} data-audit-field={index === 0 ? 'template' : undefined} disabled={controller.getSnapshot().locked} onClick={async () => { try { await voice.stop(); const id=crypto.randomUUID(); controller.enqueue({ type:'addElement',id,zoneId:zone.id,elementType:definition.type,name:`${definition.name} ${count + 1}` }); if ((await controller.flush()).kind === 'saved') onOpenElement(id); else setError('Сначала завершите сохранение.'); } catch(cause) { setError(cause instanceof Error ? cause.message : 'Не удалось добавить элемент.'); } }}><Plus size={18} aria-hidden />{definition.name} {count + 1}</Button>;
    })}</div>}{error && <p role="alert" className="field-error">{error}</p>}
  </>;
}
