import { aggregateAuditDefects } from './defect-aggregator.js';
import { validateAudit, primaryMeasurement, type Audit } from '../domain/audit-model.js';
import type { UUID, Revision, ISODateTime, VersionRef, Actor } from '../domain/contracts.js';
import { PARAMETER_LABELS } from '../domain/measurements.js';
import type { Photo } from '../media/photo-contract.js';
import { auditReadiness } from '../features/review/readiness.js';
import type { VoiceDraft } from '../voice/voice-drafts.js';
import { measurementParametersFor, definitionFor, CHECK_LABELS, templateForZone, AUDIT_TEMPLATES } from '../domain/templates/index.js';
export const SCOPE_LABEL = 'Черновик. Фрагмент обследования: Входная группа Z2';
export function scopeLabelForAudit(audit: Audit): string { return audit.scope.includedZones.length === 1 && audit.scope.includedZones[0] === 'Z2' ? SCOPE_LABEL : `Черновик. Фрагмент обследования: ${audit.scope.includedZones.map(code => `${templateForZone(code).title} ${code}`).join('; ')}`; }
export type DocumentBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; pageBreakBefore?: boolean }
  | { kind: 'paragraph'; text: string; sourceIds: UUID[] }
  | { kind: 'table'; rows: readonly (readonly string[])[]; sourceIds: UUID[] }
  | { kind: 'photo'; photoId: UUID; label: string; caption: string };
export interface DocumentSnapshot {
  id: UUID; auditId: UUID; auditRevision: Revision; template: VersionRef; ruleSet?: VersionRef;
  status: 'draft' | 'reviewed'; scopeLabel: string; blocks: readonly DocumentBlock[];
  evidence: readonly { photoId: UUID; label: string; caption: string; sha256: string; width: number; height: number }[];
  missingInformation: readonly string[]; createdAt: ISODateTime;
  expertReview?: { auditRevision: Revision; by: Actor; at: ISODateTime };
}
const displayDate = (value: string): string => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(value)) + ' (МСК)';
const applicability = { unknown: 'Не определена', applicable: 'Применим', not_applicable: 'Не применим' };
const presence = { unknown: 'Не проверено', present: 'Есть', absent: 'Отсутствует' };
const operability = { unknown: 'Не проверена', working: 'Работает', defective: 'Есть неисправность', not_working: 'Не работает', not_applicable: 'Не применима' };
const units: Record<string, string> = { mm: 'мм', cm: 'см', m: 'м', '%': '%', deg: '°' };
export function buildActDraft(audit: Audit, photos: readonly Photo[], drafts: readonly VoiceDraft[], id: UUID = crypto.randomUUID(), at: ISODateTime = new Date().toISOString()): DocumentSnapshot {
  validateAudit(audit); const scopeLabel = scopeLabelForAudit(audit); const readiness = auditReadiness(audit, drafts);
  const missing = readiness.questions.map((q) => `${audit.elements[q.elementId]?.name ?? 'Форма'}: ${q.message}`);
  missing.push(...readiness.pendingDrafts.map((draft) => `${audit.elements[draft.elementId]?.name ?? 'Элемент'}: голосовой черновик ещё не принят.`));
  const blocks: DocumentBlock[] = [
    { kind: 'heading', level: 1, text: scopeLabel },
    { kind: 'paragraph', text: `Объект: ${audit.object.name}. Адрес: ${audit.object.address}.`, sourceIds: [audit.objectId] },
    { kind: 'paragraph', text: `Дата обследования: ${audit.inspectedOn}. Исполнитель: ${audit.author.name}. Цель: ${audit.scope.purpose}.`, sourceIds: [audit.id] },
    { kind: 'paragraph', text: `Редакция обследования: ${audit.revision}. Шаблон: ${audit.template.id}, версия ${audit.template.version}. В документ включены только созданные зоны: ${audit.scope.includedZones.join(', ')}.`, sourceIds: [audit.id] },
    { kind: 'paragraph', text: audit.reviewed ? `Проверено экспертом: ${audit.reviewed.by.name}, ${displayDate(audit.reviewed.at)}. Проверена редакция ${audit.reviewed.auditRevision}.` : 'Экспертная проверка этой редакции не выполнена.', sourceIds: [audit.id] },
    { kind: 'paragraph', text: 'Черновик для проверки специалистом. Завершение карточек не означает нормативное соответствие или доступность объекта. Документ не заменяет полный акт обследования.', sourceIds: [] },
  ];
  const defects = aggregateAuditDefects(audit);
  const zones = Object.values(audit.zones).filter(zone => zone.included).sort((a,b)=>a.code.localeCompare(b.code));
  blocks.push({kind:'heading',level:2,text:'Экспресс-сводка по зонам'}, {kind:'table',sourceIds:zones.map(zone=>zone.id),rows:[['Зона','Завершено карточек','Завершённость','Элементов с замечаниями'],...zones.map(zone=>{
    const ready=zone.elementIds.filter(id=>audit.elements[id]?.readiness==='ready' && audit.elements[id]?.confirmation?.valueRevision===audit.elements[id]?.revision).length;
    return [`${zone.code}. ${zone.title}`,`${ready} из ${zone.elementIds.length}`,`${Math.round(ready / zone.elementIds.length * 100)}%`,String(defects.filter(row=>row.zoneName.startsWith(zone.code+'.')).length)];
  })]});
  blocks.push({kind:'paragraph',text:'Завершённость отражает заполнение карточек. Число замечаний включает факты инспектора и сигналы предварительных профилей, а не установленные юридические нарушения.',sourceIds:[]});
  blocks.push({kind:'heading',level:2,text:'Сводная ведомость нарушений и рекомендаций',pageBreakBefore:true});
  blocks.push({kind:'paragraph',text:'Автоматические отклонения требуют экспертной проверки применимости СП. Замечания без подтверждения обозначены отдельно. Прохождение предварительного профиля не доказывает нормативное соответствие.',sourceIds:[]});
  if (defects.length) blocks.push({kind:'table',sourceIds:[],rows:[['№','Зона и элемент','Выявленное несоответствие','Пункт СП 59.13330','Рекомендуемые мероприятия'],...defects.map((row,index)=>[String(index+1),`${row.zoneName}\n${row.elementName}${row.location ? '\n'+row.location : ''}`,`${row.actualIssue}\nТребование: ${row.normRequirement}`,row.spReference,row.recommendation])]});
  else blocks.push({kind:'paragraph',text:'В записанных данных нет замечаний или отклонений от выбранных профилей. Полноту обследования и нормативное соответствие проверяет эксперт.',sourceIds:[]});
  const photoBlocks: DocumentBlock[] = [];
  const evidence: DocumentSnapshot['evidence'][number][] = [];
  for (const zone of zones) {
    blocks.push({ kind: 'heading', level: 2, text: `${zone.code}. ${zone.title}`, pageBreakBefore: true });
    blocks.push({kind:'table',sourceIds:[...zone.elementIds],rows:[['Элемент и расположение','Параметры и фактические замеры','Статус и комментарий'],...zone.elementIds.map(id=>{
      const element=audit.elements[id]!;
      const values=measurementParametersFor(element.type).map(parameter=>{const value=primaryMeasurement(audit,id,parameter);return `${PARAMETER_LABELS[parameter]}: ${value ? `${value.raw.text} ${units[value.raw.unit] ?? value.raw.unit}` : 'не измерено'}`;}).join('\n');
      return [`${element.name}${element.location ? '\n'+element.location : ''}`,values || 'Числовые параметры не предусмотрены',`${presence[element.presence]}; ${operability[element.operability]}. ${element.readiness==='ready'?'Карточка подтверждена':'Карточка требует подтверждения'}.${element.comment ? '\nКомментарий инспектора: '+element.comment : ''}`];
    })]});
    for (const elementId of zone.elementIds) {
    const element = audit.elements[elementId]!; const confirmed = element.readiness === 'ready' && element.confirmation?.valueRevision === element.revision;
    blocks.push({ kind: 'heading', level: 3, text: element.name }, { kind: 'table', sourceIds: [elementId], rows: [
      ['Сведения об элементе', 'Результат'], ['Расположение', element.location || 'Не указано'],
      ['Применимость', applicability[element.applicability]], ['Наличие', presence[element.presence]], ['Работоспособность', operability[element.operability]],
      ['Запись инспектора', confirmed ? `Подтверждена: ${element.confirmation!.by.name}, ${displayDate(element.confirmation!.at)}` : 'Требует подтверждения'],
      ...(definitionFor(element.type).checks ?? []).map(parameter => [CHECK_LABELS[parameter], presence[element.checks?.[parameter] ?? 'unknown']]),
      ...(element.exclusionReason ? [['Причина неприменимости', element.exclusionReason]] : []),
    ] });
    const rows: string[][] = [['Параметр', 'Исходный замер', 'Приведённый замер']]; const ids: string[] = [elementId];
    for (const parameter of measurementParametersFor(element.type).filter((parameter) => parameter !== 'landingDepth' || element.measurementInputs.landingDepth?.text || primaryMeasurement(audit, elementId, parameter))) {
      const measurement = primaryMeasurement(audit, elementId, parameter); const input = element.measurementInputs[parameter];
      rows.push([PARAMETER_LABELS[parameter], measurement ? `${measurement.raw.text} ${units[measurement.raw.unit] ?? measurement.raw.unit}` : input?.text ? `Незавершённый ввод: ${input.text}` : (element.applicability === 'not_applicable' ? 'Не требуется: не применим' : element.presence === 'absent' ? 'Не требуется: отсутствует' : 'Не измерено'),
        measurement ? `${Number(measurement.normalized.value.toFixed(4))} ${units[measurement.normalized.unit] ?? measurement.normalized.unit}${confirmed ? '' : ' (не подтверждено)'}` : 'Нет замера']);
      if (measurement) ids.push(measurement.id);
    }
    if (rows.length > 1) blocks.push({ kind: 'table', rows, sourceIds: ids });
    for (const finding of Object.values(audit.findings)) if (finding.elementId === elementId && finding.text.trim() && confirmed && finding.confirmation?.valueRevision === element.revision) blocks.push({ kind: 'paragraph', text: `Подтверждённое замечание: ${finding.text}`, sourceIds: [finding.id] });
    if (confirmed && element.comment.trim()) blocks.push({ kind: 'paragraph', text: `Комментарий инспектора: ${element.comment}`, sourceIds: [elementId] });
    if (confirmed) for (const recommendation of Object.values(audit.recommendations)) if (recommendation.elementId === elementId && recommendation.text.trim()) blocks.push({ kind: 'paragraph', text: `Рекомендация инспектора: ${recommendation.text}`, sourceIds: [recommendation.id] });
    for (const photoId of element.photoIds) {
      const photo = photos.find((item) => item.id === photoId);
      if (!photo || photo.auditId !== audit.id || photo.elementId !== elementId) throw new Error('Фотография обследования недоступна. Документ не сформирован.');
      const item = { photoId, label: `Фото ${evidence.length + 1}: ${element.name} – ${Object.values(audit.findings).filter(f=>f.elementId===elementId&&f.text.trim()).map(f=>f.text.trim()).join('; ') || photo.caption || 'Общий вид'}${confirmed ? '' : ' (карточка не подтверждена)'}`, caption: photo.caption, sha256: photo.sha256, width: photo.width, height: photo.height };
      evidence.push(item); photoBlocks.push({ kind: 'photo', photoId, label: item.label, caption: item.caption });
    }
  }
  }
  if (photoBlocks.length) blocks.push({kind:'heading',level:2,text:'Фототаблица',pageBreakBefore:true},...photoBlocks);
  blocks.push({kind:'heading',level:2,text:'Проверка и подписание'}, {kind:'paragraph',text:`Исполнитель: ${audit.author.name}. Подпись: ____________________ Дата: __________.\nОтветственный эксперт: ${audit.responsibleExpert?.name ?? '____________________'}. Подпись: ____________________ Дата: __________.\nПредставитель объекта (ФИО, должность): ____________________. Подпись: ____________________ Дата: __________.`,sourceIds:[]});
  if (missing.length) { blocks.push({ kind: 'heading', level: 2, text: 'Сведения для уточнения' }); for (const text of missing) blocks.push({ kind: 'paragraph', text, sourceIds: [] }); }
  const snapshot: DocumentSnapshot = { id, auditId: audit.id, auditRevision: audit.revision, template: { ...audit.template }, status: audit.reviewed ? 'reviewed' : 'draft', scopeLabel,
    blocks, evidence, missingInformation: missing, createdAt: at, ...(audit.ruleSet ? { ruleSet: { ...audit.ruleSet } } : {}), ...(audit.reviewed ? { expertReview: structuredClone(audit.reviewed) } : {}) };
  validateDocumentSnapshot(snapshot); return structuredClone(snapshot);
}
export function validateDocumentSnapshot(snapshot: DocumentSnapshot): void {
  if (!snapshot || typeof snapshot.scopeLabel !== 'string' || !snapshot.scopeLabel.startsWith('Черновик. Фрагмент обследования: ') || !snapshot.id || !snapshot.auditId || !Number.isSafeInteger(snapshot.auditRevision) || snapshot.auditRevision < 1
    || !Array.isArray(snapshot.blocks) || !Array.isArray(snapshot.evidence) || !Array.isArray(snapshot.missingInformation) || !Number.isFinite(Date.parse(snapshot.createdAt))) throw new Error('Некорректный снимок документа.');
  if (!AUDIT_TEMPLATES.some(template => template.id === snapshot.template?.id && template.version === snapshot.template.version)) throw new Error('Неподдерживаемый шаблон документа.');
  const labels = snapshot.scopeLabel.slice('Черновик. Фрагмент обследования: '.length).split('; ');
  if (new Set(labels).size !== labels.length || !labels.every(label => AUDIT_TEMPLATES.some(template => label === `${template.title} ${template.code}` && template.code !== 'OBJECT'))) throw new Error('Неподдерживаемый объём документа.');
  if (snapshot.template.id === 'urbanaccess-z2' && snapshot.scopeLabel !== SCOPE_LABEL) throw new Error('Документ Z2 содержит другой объём обследования.');
  for (const block of snapshot.blocks) {
    if (block.kind === 'table') { if (!block.rows.length || !block.rows.every((row: readonly string[]) => row.length === block.rows[0]!.length && row.every((text: string) => typeof text === 'string'))) throw new Error('Некорректная таблица документа.'); }
    else if (block.kind === 'photo') { if (!snapshot.evidence.some((item) => item.photoId === block.photoId)) throw new Error('Отсутствует ссылка на фото.'); }
    else if (!['heading', 'paragraph'].includes(block.kind) || typeof block.text !== 'string') throw new Error('Некорректный блок документа.');
  }
}
