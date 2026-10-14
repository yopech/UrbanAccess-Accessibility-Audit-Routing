import type { Actor, Confirmation, ISODateTime, LocalDate, Revision, UUID, VersionRef } from './contracts.js';
import type { ReductionContext } from '../storage/audit-store.js';
import { Z2_TEMPLATE, definitionFor, measurementParametersFor, type AuditTemplate } from '../templates/z2-template.js';
import { validatePhoto, type Photo } from '../media/photo-contract.js';
import { OBJECT_TEMPLATE, templateForZone, CHECK_LABELS } from './templates/index.js';
import type { SupportedZoneCode, ElementChecks, CheckParameter } from './templates/index.js';
import { isSlopeParameter, parseMeasurement } from './measurements.js';
export type ZoneCode = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | 'Z6';
export type Applicability = 'unknown' | 'applicable' | 'not_applicable';
export type Presence = 'unknown' | 'present' | 'absent';
export type Operability = 'unknown' | 'working' | 'defective' | 'not_working' | 'not_applicable';
export type Readiness = 'not_started' | 'in_progress' | 'needs_clarification' | 'ready';
export type AuditStatus = 'draft' | 'in_progress' | 'ready_for_review' | 'needs_clarification' | 'reviewed';
export type ElementType = 'door' | 'ramp' | 'handrail' | 'stairs' | 'platform' | 'call_button' | 'custom' | 'accessibleParking' | 'pedestrianPath' | 'outdoorStairs' | 'corridor' | 'internalDoor' | 'elevator' | 'accessibleToilet';
export type BasicParameter = 'doorWidth' | 'thresholdHeight' | 'rampSlope' | 'rampWidth' | 'handrailHeight' | 'landingDepth' | 'parkingWidth' | 'pathWidth' | 'pathSlope' | 'pathCrossSlope' | 'stepHeight' | 'stepWidth' | 'corridorWidth' | 'heightClearance' | 'cabinWidth' | 'cabinDepth' | 'roomWidth' | 'roomDepth' | 'toiletHeight';
export type LengthUnit = 'mm' | 'cm' | 'm';
export type Unit = LengthUnit | '%' | 'deg' | 'lx' | 'custom';
export interface Measurement {
  id: UUID; elementId: UUID; parameter: BasicParameter | 'custom'; customLabel?: string;
  raw: { text: string; value: number; unit: Unit }; normalized: { value: number; unit: Unit };
  qualifier: 'exact' | 'approximate' | 'minimum' | 'maximum'; position?: string;
  method: 'manual' | 'voice'; revision: Revision; primary: boolean; supersedesId?: UUID; confirmation?: Confirmation;
}
export interface Finding {
  id: UUID; elementId: UUID; type: 'absence' | 'defect' | 'observation' | 'not_checked'; text: string;
  measurementIds: UUID[]; photoIds: UUID[]; confirmation?: Confirmation;
}
export interface Recommendation {
  id: UUID; elementId: UUID; findingIds: UUID[]; text: string; confirmation?: Confirmation;
}
export interface MeasurementInput { text: string; unit: Unit; notMeasuredReason?: string; }
export interface Element {
  id: UUID; zoneId: UUID; parentElementId?: UUID; type: ElementType; name: string; location: string;
  applicability: Applicability; exclusionReason?: string; presence: Presence; operability: Operability;
  comment: string; readiness: Readiness; revision: Revision; confirmation?: Confirmation;
  photoIds: UUID[];
  checks?: ElementChecks;
  measurementInputs: Partial<Record<BasicParameter, MeasurementInput>>;
}
export interface Zone { id: UUID; code: ZoneCode; title: string; included: boolean; exclusionReason?: string; elementIds: UUID[]; }
export interface ObjectDetails { name: string; address: string; building?: string; entrance?: string; }
export interface Audit {
  id: UUID; objectId: UUID; schemaVersion: number; revision: Revision; status: AuditStatus;
  object: ObjectDetails; inspectedOn: LocalDate; author: Actor; responsibleExpert?: Actor;
  scope: { purpose: string; includedZones: ZoneCode[] }; template: VersionRef; ruleSet?: VersionRef;
  zones: Record<UUID, Zone>; elements: Record<UUID, Element>; measurements: Record<UUID, Measurement>;
  findings: Record<UUID, Finding>; recommendations: Record<UUID, Recommendation>; photoIds: UUID[];
  reviewed?: { auditRevision: Revision; by: Actor; at: ISODateTime };
  createdAt: ISODateTime; updatedAt: ISODateTime; archivedAt?: ISODateTime;
}
export type ElementPatch = Partial<Pick<Element, 'name' | 'location' | 'applicability' | 'exclusionReason' | 'presence' | 'operability' | 'comment'>>;
export type AuditCommand =
  | { type: 'createAudit'; audit: Audit }
  | { type: 'updateObjectDetails'; object: ObjectDetails; inspectedOn: LocalDate; author: Actor }
  | { type: 'setScope'; includedZones: ZoneCode[]; purpose: string }
  | { type: 'initializeZone'; code: SupportedZoneCode; id: UUID; elementIds: readonly UUID[] }
  | { type: 'setElementCheck'; elementId: UUID; parameter: CheckParameter; value: Presence }
  | { type: 'addElement'; id: UUID; zoneId: UUID; elementType: ElementType; name: string }
  | { type: 'updateElement'; elementId: UUID; patch: ElementPatch }
  | { type: 'setMeasurementInput'; elementId: UUID; parameter: BasicParameter; input: MeasurementInput }
  | { type: 'recordMeasurement'; id: UUID; elementId: UUID; parameter: BasicParameter; text: string; unit: Unit }
  | { type: 'clearMeasurement'; elementId: UUID; parameter: BasicParameter }
  | { type: 'addFinding'; finding: Finding }
  | { type: 'updateFinding'; id: UUID; text: string; findingType: Finding['type'] }
  | { type: 'updateRecommendation'; recommendation: Recommendation }
  | { type: 'applyVoiceDraft'; draftId: UUID; draftVersion: number; elementId: UUID; mode: 'comment' | 'recommendation'; text: string; recommendationId: UUID }
  | { type: 'confirmElement'; elementId: UUID }
  | { type: 'setElementReadiness'; elementId: UUID; readiness: Exclude<Readiness, 'ready'> }
  | { type: 'attachPhoto'; photo: Photo }
  | { type: 'updatePhoto'; photoId: UUID; elementId: UUID; caption: string; measurementIds: UUID[]; findingIds: UUID[] }
  | { type: 'detachPhoto'; photoId: UUID; elementId: UUID }
  | { type: 'restorePhoto'; photo: Photo }
  | { type: 'reviewAudit'; expert: Actor }
  | { type: 'archiveAudit' }
  | { type: 'unarchiveAudit' };
export interface ReadinessQuestion { elementId: UUID; field: string; message: string; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function text(value: unknown): value is string { return typeof value === 'string'; }
function oneOf(value: unknown, values: readonly string[]): boolean { return text(value) && values.includes(value); }
export function validLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function checkConfirmation(confirmation: Confirmation | undefined): void {
  if (!confirmation) return;
  checkActor(confirmation.by);
  check(typeof confirmation.at === 'string' && Number.isFinite(Date.parse(confirmation.at)) && Number.isSafeInteger(confirmation.valueRevision) && confirmation.valueRevision >= 1, 'Некорректное подтверждение.');
}
function checkActor(actor: Actor): void { check(actor && uuid.test(actor.id) && text(actor.name) && actor.name.trim(), 'Укажите исполнителя.'); }
export function createZ2Audit(details: { object: ObjectDetails; inspectedOn: LocalDate; author: Actor; purpose: string }, ids: { auditId: UUID; objectId: UUID; zoneId: UUID; elementIds: readonly UUID[] }, at: ISODateTime): Audit {
  check(ids.elementIds.length === Z2_TEMPLATE.elements.length, 'Нужен идентификатор каждого элемента.');
  const elements: Record<UUID, Element> = {};
  Z2_TEMPLATE.elements.forEach((definition, index) => {
    const id = ids.elementIds[index]!;
    elements[id] = { id, zoneId: ids.zoneId, type: definition.type, name: definition.name, location: '',
      applicability: 'unknown', presence: 'unknown', operability: 'unknown', comment: '', readiness: 'not_started', revision: 1, photoIds: [], measurementInputs: {} };
  });
  const audit: Audit = { id: ids.auditId, objectId: ids.objectId, schemaVersion: 1, revision: 1, status: 'draft',
    object: { ...details.object }, inspectedOn: details.inspectedOn, author: { ...details.author },
    scope: { purpose: details.purpose, includedZones: ['Z2'] }, template: { id: Z2_TEMPLATE.id, version: Z2_TEMPLATE.version },
    zones: { [ids.zoneId]: { id: ids.zoneId, code: 'Z2', title: Z2_TEMPLATE.title, included: true, elementIds: [...ids.elementIds] } },
    elements, measurements: {}, findings: {}, recommendations: {}, photoIds: [], createdAt: at, updatedAt: at };
  validateAudit(audit); return audit;
}
export function primaryMeasurement(audit: Audit, elementId: UUID, parameter: BasicParameter): Measurement | undefined {
  return Object.values(audit.measurements).find((measurement) => measurement.elementId === elementId && measurement.parameter === parameter && measurement.primary);
}
export function elementQuestions(audit: Audit, element: Element): ReadinessQuestion[] {
  const questions: ReadinessQuestion[] = [];
  const add = (field: string, message: string) => questions.push({ elementId: element.id, field, message });
  if (!element.name.trim()) add('name', 'Укажите название элемента.');
  if (element.applicability === 'unknown') add('applicability', 'Укажите, применим ли элемент к этому объекту.');
  if (element.applicability === 'not_applicable') {
    if (!element.exclusionReason?.trim()) add('exclusionReason', 'Объясните, почему элемент не применим.');
    return questions;
  }
  if (element.presence === 'unknown') add('presence', 'Укажите наличие элемента.');
  if (element.presence === 'absent') {
    if (definitionFor(element.type).required && !Object.values(audit.findings).some((finding) => finding.elementId === element.id && finding.type === 'absence' && finding.text.trim())) add('finding', 'Зафиксируйте замечание об отсутствии элемента.');
  } else if (element.presence === 'present') {
    if (element.operability === 'unknown') add('operability', 'Зафиксируйте работоспособность или её неприменимость.');
    if (element.operability === 'defective' || element.operability === 'not_working') {
      if (!Object.values(audit.findings).some((finding) => finding.elementId === element.id && finding.text.trim())) add('finding', 'Опишите выявленную неисправность.');
    }
    for (const parameter of definitionFor(element.type).checks ?? []) if (!element.checks?.[parameter] || element.checks[parameter] === 'unknown') add(parameter, 'Проверьте наличие: ' + CHECK_LABELS[parameter] + '.');
    for (const parameter of definitionFor(element.type).parameters) {
      if (!primaryMeasurement(audit, element.id, parameter)) add(parameter, 'Зафиксируйте замер или оставьте карточку на уточнение.');
    }
  }
  return questions;
}
export function validateAuditReadiness(audit: Audit, template?: AuditTemplate): ReadinessQuestion[] {
  const questions = Object.values(audit.elements).flatMap((element) => {
    const result = elementQuestions(audit, element);
    if (element.readiness !== 'ready' || element.confirmation?.valueRevision !== element.revision) result.push({ elementId: element.id, field: 'readiness', message: 'Подтвердите завершение карточки.' });
    for (const finding of Object.values(audit.findings)) if (finding.elementId === element.id && finding.text.trim() && finding.confirmation?.valueRevision !== element.revision) result.push({ elementId: element.id, field: 'finding', message: 'Подтвердите замечание инспектора.' });
    return result;
  });
  for (const zone of Object.values(audit.zones)) for (const definition of templateForZone(zone.code).elements) {
    if (definition.required && !zone.elementIds.some(id => audit.elements[id]?.type === definition.type)) questions.push({ elementId: '', field: 'template', message: `Добавьте обязательный элемент ${zone.code}: ${definition.name}.` });
  }
  if (template ? (audit.template.id !== template.id || audit.template.version !== template.version) : ![Z2_TEMPLATE, OBJECT_TEMPLATE].some(candidate => candidate.id === audit.template.id && candidate.version === audit.template.version)) questions.push({ elementId: '', field: 'template', message: 'Версия шаблона обследования не совпадает с проверяемой формой.' });
  return questions;
}
export function validateAudit(audit: Audit): void {
  check(audit && uuid.test(audit.id) && uuid.test(audit.objectId), 'Некорректные идентификаторы обследования.');
  check(audit.schemaVersion === 1 && Number.isSafeInteger(audit.revision) && audit.revision >= 1, 'Несовместимая версия обследования.');
  check(oneOf(audit.status, ['draft', 'in_progress', 'ready_for_review', 'needs_clarification', 'reviewed']), 'Некорректный статус обследования.');
  check(audit.object && text(audit.object.name) && audit.object.name.trim() && text(audit.object.address) && audit.object.address.trim(), 'Укажите название и адрес объекта.');
  check(typeof audit.createdAt === 'string' && Number.isFinite(Date.parse(audit.createdAt)) && typeof audit.updatedAt === 'string' && Number.isFinite(Date.parse(audit.updatedAt)), 'Некорректные даты записи.');
  if (audit.reviewed) { checkActor(audit.reviewed.by); check(audit.reviewed.auditRevision === audit.revision && audit.status === 'reviewed' && Number.isFinite(Date.parse(audit.reviewed.at)), 'Проверка эксперта относится к другой редакции.'); }
  check(audit.status !== 'reviewed' || audit.reviewed, 'Для проверенного обследования требуется запись эксперта.');
  check(validLocalDate(audit.inspectedOn), 'Укажите корректную дату обследования.'); checkActor(audit.author);
  check([Z2_TEMPLATE, OBJECT_TEMPLATE].some(template => audit.template.id === template.id && audit.template.version === template.version), 'Неподдерживаемая версия формы.');
  check(Array.isArray(audit.scope.includedZones) && audit.scope.includedZones.length > 0 && new Set(audit.scope.includedZones).size === audit.scope.includedZones.length && audit.scope.purpose.trim(), 'Выберите объём и цель обследования.');
  check(Array.isArray(audit.photoIds) && audit.photoIds.every((id) => uuid.test(id)) && new Set(audit.photoIds).size === audit.photoIds.length, 'Некорректные ссылки на фотографии.');
  const zones = Object.values(audit.zones);
  check(zones.length === audit.scope.includedZones.length && new Set(zones.map(zone => zone.code)).size === zones.length && zones.every(zone => zone.included && audit.scope.includedZones.includes(zone.code)), 'Объём обследования не совпадает с созданными зонами.');
  check(audit.template.id !== Z2_TEMPLATE.id || (zones.length === 1 && zones[0]?.code === 'Z2'), 'Шаблон Z2 содержит только входную группу.');
  const seen = new Set<string>();
  for (const [id, zone] of Object.entries(audit.zones)) {
    check(uuid.test(id) && zone.id === id && Array.isArray(zone.elementIds), 'Некорректная зона.');
    const template = templateForZone(zone.code);
    check(template.elements.filter(definition => definition.required).every(definition => zone.elementIds.some(elementId => audit.elements[elementId]?.type === definition.type)), 'В зоне отсутствует обязательный тип элемента.');
    for (const elementId of zone.elementIds) { check(!seen.has(elementId) && audit.elements[elementId]?.zoneId === id, 'Нарушена связь элемента с зоной.'); seen.add(elementId); }
  }
  check(seen.size === Object.keys(audit.elements).length, 'Есть элемент без зоны.');
  for (const [id, element] of Object.entries(audit.elements)) {
    check(uuid.test(id) && element.id === id && text(element.name), 'Некорректное название элемента.'); definitionFor(element.type);
    check(templateForZone(audit.zones[element.zoneId]!.code).elements.some(definition => definition.type === element.type), 'Тип элемента не относится к зоне.');
    check(element.checks === undefined || (element.checks !== null && typeof element.checks === 'object' && !Array.isArray(element.checks)), 'Некорректный перечень проверок наличия.');
    if (element.checks) for (const [parameter, value] of Object.entries(element.checks)) check((definitionFor(element.type).checks ?? []).includes(parameter as CheckParameter) && oneOf(value, ['unknown', 'present', 'absent']), 'Некорректная проверка наличия.');
    check(Number.isSafeInteger(element.revision) && element.revision >= 1 && text(element.location) && text(element.comment), 'Некорректная карточка элемента.');
    check(oneOf(element.applicability, ['unknown', 'applicable', 'not_applicable']) && oneOf(element.presence, ['unknown', 'present', 'absent'])
      && oneOf(element.operability, ['unknown', 'working', 'defective', 'not_working', 'not_applicable'])
      && oneOf(element.readiness, ['not_started', 'in_progress', 'needs_clarification', 'ready']), 'Некорректное состояние элемента.');
    check(!(element.presence === 'absent' && element.operability === 'working'), 'Отсутствующий элемент не может быть работоспособным.');
    check(Array.isArray(element.photoIds) && element.photoIds.every((photoId) => audit.photoIds.includes(photoId)), 'Некорректные фото элемента.');
    checkConfirmation(element.confirmation);
    for (const [parameter, input] of Object.entries(element.measurementInputs)) {
      check(measurementParametersFor(element.type).includes(parameter as BasicParameter) && input && text(input.text)
        && oneOf(input.unit, isSlopeParameter(parameter) ? ['%', 'deg'] : ['mm', 'cm', 'm']), 'Некорректный черновик замера.');
    }
    if (element.readiness === 'ready') {
      check(elementQuestions(audit, element).length === 0 && element.confirmation?.valueRevision === element.revision, 'Карточка ещё не готова.');
      if (element.presence === 'absent' && element.applicability === 'applicable') check(Object.values(audit.findings).some((finding) => finding.elementId === id && finding.type === 'absence' && finding.text.trim() && finding.confirmation), 'Подтвердите замечание об отсутствии.');
    }
  }
  const linked = Object.values(audit.elements).flatMap((element) => element.photoIds);
  check(new Set(linked).size === linked.length && linked.length === audit.photoIds.length && linked.every((id) => audit.photoIds.includes(id)), 'Нарушена связь фотографии с карточкой.');
  const primary = new Set<string>();
  for (const [id, measurement] of Object.entries(audit.measurements)) {
    check(uuid.test(id) && measurement.id === id && audit.elements[measurement.elementId], 'Некорректная связь замера.');
    check(measurement.parameter !== 'custom' && measurementParametersFor(audit.elements[measurement.elementId]!.type).includes(measurement.parameter), 'Параметр не относится к элементу.');
    const parsed = parseMeasurement(measurement.parameter, measurement.raw.text, measurement.raw.unit);
    check(parsed && parsed.raw.value === measurement.raw.value && parsed.normalized.unit === measurement.normalized.unit
      && Math.abs(parsed.normalized.value - measurement.normalized.value) <= Math.max(1, parsed.normalized.value) * 1e-12, 'Некорректный нормализованный замер.');
    check(Number.isSafeInteger(measurement.revision) && measurement.revision >= 1 && typeof measurement.primary === 'boolean' && measurement.method === 'manual'
      && oneOf(measurement.qualifier, ['exact', 'approximate', 'minimum', 'maximum']), 'Некорректные свойства замера.');
    checkConfirmation(measurement.confirmation);
    if (measurement.primary) { const key = `${measurement.elementId}:${measurement.parameter}`; check(!primary.has(key), 'Несколько текущих замеров одного параметра.'); primary.add(key); }
    if (measurement.supersedesId) check(audit.measurements[measurement.supersedesId]?.elementId === measurement.elementId
      && audit.measurements[measurement.supersedesId]?.parameter === measurement.parameter && audit.measurements[measurement.supersedesId]!.revision < measurement.revision, 'Нарушена история замера.');
  }
  for (const [id, finding] of Object.entries(audit.findings)) {
    check(uuid.test(id) && finding.id === id && audit.elements[finding.elementId] && text(finding.text)
      && oneOf(finding.type, ['absence', 'defect', 'observation', 'not_checked']) && Array.isArray(finding.measurementIds)
      && Array.isArray(finding.photoIds) && finding.photoIds.every((id) => audit.elements[finding.elementId]!.photoIds.includes(id)), 'Некорректное замечание.');
    checkConfirmation(finding.confirmation);
    for (const measurementId of finding.measurementIds) check(audit.measurements[measurementId]?.elementId === finding.elementId, 'Замер замечания относится к другому элементу.');
  }
  for (const [id, recommendation] of Object.entries(audit.recommendations)) {
    check(uuid.test(id) && recommendation.id === id && audit.elements[recommendation.elementId] && text(recommendation.text) && Array.isArray(recommendation.findingIds), 'Некорректная рекомендация.');
    checkConfirmation(recommendation.confirmation);
    for (const findingId of recommendation.findingIds) check(audit.findings[findingId]?.elementId === recommendation.elementId, 'Рекомендация ссылается на другой элемент.');
  }
}
function touch(element: Element): void { element.revision++; delete element.confirmation; if (element.readiness !== 'needs_clarification') element.readiness = 'in_progress'; }
function getElement(audit: Audit, id: UUID): Element { const element = audit.elements[id]; check(element, 'Элемент не найден.'); return element; }
function clearPrimary(audit: Audit, elementId: UUID, parameter: BasicParameter): void {
  for (const measurement of Object.values(audit.measurements)) if (measurement.elementId === elementId && measurement.parameter === parameter) measurement.primary = false;
}
export function applyAuditCommands(current: Readonly<Audit> | undefined, commands: readonly AuditCommand[], context: ReductionContext): Audit {
  let audit: Audit | undefined = current ? structuredClone(current) : undefined;
  for (const command of commands) {
    if (command.type === 'createAudit') {
      check(!audit && command.audit.id === context.auditId, 'Обследование уже существует или имеет другой ID.');
      audit = structuredClone(command.audit); validateAudit(audit); continue;
    }
    check(audit, 'Сначала создайте обследование.');
    if (command.type === 'unarchiveAudit') {
      check(audit.archivedAt, 'Обследование уже находится в основном списке.');
      delete audit.archivedAt; continue;
    }
    check(!audit.archivedAt, 'Архивное обследование доступно только для чтения.');
    if (command.type === 'reviewAudit') {
      checkActor(command.expert); check(validateAuditReadiness(audit).length === 0, 'Сначала подтвердите карточки и заполните обязательные сведения.');
      audit.responsibleExpert = { ...command.expert }; audit.status = 'reviewed';
      audit.reviewed = { auditRevision: context.revision, by: { ...command.expert }, at: context.committedAt }; continue;
    }
    delete audit.reviewed; audit.status = 'in_progress';
    switch (command.type) {
      case 'updateObjectDetails': audit.object = { ...command.object }; audit.inspectedOn = command.inspectedOn; audit.author = { ...command.author }; break;
      case 'setScope': audit.scope = { includedZones: [...command.includedZones], purpose: command.purpose }; break;
      case 'initializeZone': {
        const template = templateForZone(command.code);
        check(!Object.values(audit.zones).some(zone => zone.code === command.code) && !audit.zones[command.id] && !audit.elements[command.id] && uuid.test(command.id), 'Зона уже существует или имеет неверный ID.');
        const existingElements = audit.elements;
        check(command.elementIds.length === template.elements.length && new Set(command.elementIds).size === command.elementIds.length && command.elementIds.every(id => uuid.test(id) && id !== command.id && !existingElements[id]), 'Нужны уникальные идентификаторы элементов новой зоны.');
        audit.zones[command.id] = { id: command.id, code: command.code, title: template.title, included: true, elementIds: [...command.elementIds] };
        for (const [index, definition] of template.elements.entries()) {
          const id = command.elementIds[index]!;
          audit.elements[id] = { id, zoneId: command.id, type: definition.type, name: definition.name, location: '', applicability: 'unknown', presence: 'unknown', operability: 'unknown', comment: '', readiness: 'not_started', revision: 1, photoIds: [], measurementInputs: {} };
        }
        audit.scope.includedZones.push(command.code); audit.template = { id: OBJECT_TEMPLATE.id, version: OBJECT_TEMPLATE.version }; break;
      }
      case 'setElementCheck': {
        const element = getElement(audit, command.elementId);
        check((definitionFor(element.type).checks ?? []).includes(command.parameter), 'Проверка не относится к элементу.');
        element.checks = { ...element.checks, [command.parameter]: command.value }; touch(element); break;
      }
      case 'addElement': {
        const definition = definitionFor(command.elementType); const zone = audit.zones[command.zoneId];
        check(zone && !audit.elements[command.id] && uuid.test(command.id), 'Не удалось добавить элемент.');
        audit.elements[command.id] = { id: command.id, zoneId: zone.id, type: definition.type, name: command.name, location: '',
          applicability: 'unknown', presence: 'unknown', operability: 'unknown', comment: '', readiness: 'not_started', revision: 1, photoIds: [], measurementInputs: {} };
        zone.elementIds.push(command.id); break;
      }
      case 'updateElement': { const element = getElement(audit, command.elementId); Object.assign(element, command.patch); touch(element); break; }
      case 'setMeasurementInput': {
        const element = getElement(audit, command.elementId); element.measurementInputs[command.parameter] = { ...command.input };
        clearPrimary(audit, element.id, command.parameter); touch(element); break;
      }
      case 'clearMeasurement': {
        const element = getElement(audit, command.elementId); clearPrimary(audit, element.id, command.parameter);
        element.measurementInputs[command.parameter] = { text: '', unit: isSlopeParameter(command.parameter) ? '%' : 'cm' }; touch(element); break;
      }
      case 'recordMeasurement': {
        const element = getElement(audit, command.elementId); check(!audit.measurements[command.id], 'ID замера уже используется.');
        const parsed = parseMeasurement(command.parameter, command.text, command.unit); check(parsed, 'Пустое поле не является замером.');
        const previous = Object.values(audit.measurements).filter((m) => m.elementId === element.id && m.parameter === command.parameter).sort((a, b) => b.revision - a.revision)[0];
        clearPrimary(audit, element.id, command.parameter);
        audit.measurements[command.id] = { id: command.id, elementId: element.id, parameter: command.parameter, ...parsed,
          qualifier: 'exact', method: 'manual', primary: true, revision: (previous?.revision ?? 0) + 1,
          ...(previous ? { supersedesId: previous.id } : {}) };
        element.measurementInputs[command.parameter] = { text: command.text, unit: command.unit }; touch(element); break;
      }
      case 'addFinding': check(!audit.findings[command.finding.id], 'Замечание уже существует.'); audit.findings[command.finding.id] = structuredClone(command.finding); touch(getElement(audit, command.finding.elementId)); break;
      case 'updateFinding': { const finding = audit.findings[command.id]; check(finding, 'Замечание не найдено.'); finding.text = command.text; finding.type = command.findingType; delete finding.confirmation; touch(getElement(audit, finding.elementId)); break; }
      case 'updateRecommendation': {
        const previous = audit.recommendations[command.recommendation.id]; check(!previous || previous.elementId === command.recommendation.elementId, 'Нельзя перепривязать рекомендацию.');
        audit.recommendations[command.recommendation.id] = structuredClone(command.recommendation); delete audit.recommendations[command.recommendation.id]!.confirmation;
        touch(getElement(audit, command.recommendation.elementId)); break;
      }
      case 'applyVoiceDraft': {
        const element = getElement(audit, command.elementId);
        check(uuid.test(command.draftId) && Number.isSafeInteger(command.draftVersion) && command.draftVersion >= 1 && text(command.text) && command.text.trim(), 'Проверьте текст диктовки.');
        const append = (original: string) => original ? `${original}\n${command.text}` : command.text;
        if (command.mode === 'comment') element.comment = append(element.comment);
        else {
          check(command.mode === 'recommendation' && uuid.test(command.recommendationId), 'Неверный режим диктовки.');
          const existing = Object.values(audit.recommendations).find((item) => item.elementId === element.id);
          if (existing) { existing.text = append(existing.text); delete existing.confirmation; }
          else { check(!audit.recommendations[command.recommendationId], 'ID рекомендации уже используется.');
            audit.recommendations[command.recommendationId] = { id: command.recommendationId, elementId: element.id,
              findingIds: Object.values(audit.findings).filter((item) => item.elementId === element.id).map((item) => item.id), text: command.text };
          }
        }
        touch(element); break;
      }
      case 'setElementReadiness': { const element = getElement(audit, command.elementId); touch(element); element.readiness = command.readiness; break; }
      case 'confirmElement': {
        const element = getElement(audit, command.elementId); const questions = elementQuestions(audit, element);
        check(!questions.length, questions.map((question) => question.message).join(' '));
        element.readiness = 'ready'; element.confirmation = { by: { ...context.actor }, at: context.committedAt, valueRevision: element.revision };
        for (const finding of Object.values(audit.findings)) if (finding.elementId === element.id && finding.text.trim()) finding.confirmation = { by: { ...context.actor }, at: context.committedAt, valueRevision: element.revision };
        break;
      }
      case 'attachPhoto':
      case 'restorePhoto': {
        const photo = command.photo; validatePhoto(photo); const element = getElement(audit, photo.elementId);
        check(photo.auditId === audit.id && !audit.photoIds.includes(photo.id), 'Фотография уже связана или относится к другому обследованию.');
        checkPhotoLinks(audit, photo.elementId, photo.measurementIds, photo.findingIds);
        audit.photoIds.push(photo.id); element.photoIds.push(photo.id);
        for (const id of photo.findingIds) audit.findings[id]!.photoIds.push(photo.id);
        touch(element); break;
      }
      case 'updatePhoto': {
        const element = getElement(audit, command.elementId); check(element.photoIds.includes(command.photoId) && typeof command.caption === 'string', 'Фото не связано с элементом.');
        checkPhotoLinks(audit, element.id, command.measurementIds, command.findingIds);
        for (const finding of Object.values(audit.findings)) finding.photoIds = finding.photoIds.filter((id) => id !== command.photoId);
        for (const id of command.findingIds) audit.findings[id]!.photoIds.push(command.photoId);
        touch(element); break;
      }
      case 'detachPhoto': {
        const element = getElement(audit, command.elementId); check(element.photoIds.includes(command.photoId), 'Фото не связано с элементом.');
        element.photoIds = element.photoIds.filter((id) => id !== command.photoId); audit.photoIds = audit.photoIds.filter((id) => id !== command.photoId);
        for (const finding of Object.values(audit.findings)) finding.photoIds = finding.photoIds.filter((id) => id !== command.photoId);
        touch(element); break;
      }
      case 'archiveAudit': audit.archivedAt = context.committedAt; break;
    }
  }
  check(audit, 'Пустое обследование.'); audit.revision = context.revision; audit.updatedAt = context.committedAt;
  validateAudit(audit); return audit;
}

function checkPhotoLinks(audit: Audit, elementId: UUID, measurementIds: UUID[], findingIds: UUID[]): void {
  check(Array.isArray(measurementIds) && new Set(measurementIds).size === measurementIds.length && measurementIds.every((id) => audit.measurements[id]?.elementId === elementId), 'Замер фотографии относится к другому элементу.');
  check(Array.isArray(findingIds) && new Set(findingIds).size === findingIds.length && findingIds.every((id) => audit.findings[id]?.elementId === elementId), 'Замечание фотографии относится к другому элементу.');
}
export function normalizeAudit(audit: Audit): Audit {
  const value = structuredClone(audit);
  for (const element of Object.values(value.elements)) element.photoIds ??= [];
  return value;
}
