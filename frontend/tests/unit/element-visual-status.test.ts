import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { applyAuditCommands, createZ2Audit } from '../../src/domain/audit-model.js';
import { Z2_TEMPLATE } from '../../src/templates/z2-template.js';
import { elementVisualStatus } from '../../src/features/editor/element-visual-status.js';
function fixture(width?: string) {
  const actor = { id: randomUUID(), name: 'Инспектор' }; const at = '2026-10-10T12:00:00Z';
  let audit = createZ2Audit({ object: { name: 'Объект', address: 'Адрес' }, inspectedOn: '2026-10-10', author: actor, purpose: 'Проверка' },
    { auditId: randomUUID(), objectId: randomUUID(), zoneId: randomUUID(), elementIds: Z2_TEMPLATE.elements.map(() => randomUUID()) }, at);
  const id = Object.values(audit.elements).find(element => element.type === 'door')!.id;
  if (width !== undefined) audit = applyAuditCommands(audit, [
    { type: 'updateElement', elementId: id, patch: { applicability: 'applicable', presence: 'present', operability: 'working' } },
    { type: 'recordMeasurement', id: randomUUID(), elementId: id, parameter: 'doorWidth', text: width, unit: 'cm' },
    { type: 'recordMeasurement', id: randomUUID(), elementId: id, parameter: 'thresholdHeight', text: '0', unit: 'cm' },
    { type: 'confirmElement', elementId: id },
  ], { auditId: audit.id, actor, transactionId: randomUUID(), revision: 1, committedAt: at });
  return { audit, element: audit.elements[id]! };
}
describe('element visual status (presentation only)', () => {
  it('uses gray for untouched elements and amber after input', () => {
    const { audit, element } = fixture(); expect(elementVisualStatus(audit, element)).toBe('neutral');
    element.measurementInputs.doorWidth = { text: '0', unit: 'cm' };
    expect(elementVisualStatus(audit, element)).toBe('warning');
  });
  it('uses green for completed current revision, including without photos', () => {
    const { audit, element } = fixture('90'); expect(element.readiness).toBe('ready');
    expect(elementVisualStatus(audit, element)).toBe('success'); element.photoIds.push(randomUUID());
    expect(elementVisualStatus(audit, element)).toBe('success');
    delete element.confirmation; expect(elementVisualStatus(audit, element)).toBe('warning');
  });
  it('uses green for confirmed violations while retaining red or amber before confirmation', () => {
    for (const [width, expected] of [['80', 'danger'], ['85', 'warning']] as const) {
      const { audit, element } = fixture(width); element.photoIds.push(randomUUID());
      expect(elementVisualStatus(audit, element)).toBe('success');
      delete element.confirmation; element.readiness = 'needs_clarification';
      expect(elementVisualStatus(audit, element)).toBe(expected);
    }
  });
  it('gives findings and defective or missing mandatory elements priority', () => {
    const { audit, element } = fixture('90'); element.photoIds.push(randomUUID()); delete element.confirmation;
    element.operability = 'defective'; expect(elementVisualStatus(audit, element)).toBe('danger');
    element.operability = 'not_working'; expect(elementVisualStatus(audit, element)).toBe('danger');
    element.operability = 'unknown'; element.presence = 'absent'; expect(elementVisualStatus(audit, element)).toBe('danger');
    element.presence = 'present'; element.operability = 'working';
    const id = randomUUID(); audit.findings[id] = { id, elementId: element.id, type: 'observation', text: 'Замечание', measurementIds: [], photoIds: [] };
    expect(elementVisualStatus(audit, element)).toBe('danger');
  });
  it('does not show an obsolete measurement as a current failure', () => {
    const { audit, element } = fixture('80'); element.measurementInputs.doorWidth = { text: '90', unit: 'cm' };
    element.readiness = 'in_progress'; expect(elementVisualStatus(audit, element)).toBe('warning');
  });
  it('recalculates red to green after correcting a measurement and confirming the current revision', () => {
    let { audit, element } = fixture('80'); const photoId = randomUUID(); element.photoIds.push(photoId); audit.photoIds.push(photoId);
    expect(elementVisualStatus(audit, element)).toBe('success');
    audit = applyAuditCommands(audit, [{ type: 'setElementReadiness', elementId: element.id, readiness: 'needs_clarification' }],
      { auditId: audit.id, actor: audit.author, transactionId: randomUUID(), revision: audit.revision + 1, committedAt: audit.updatedAt });
    expect(elementVisualStatus(audit, audit.elements[element.id]!)).toBe('danger');
    audit = applyAuditCommands(audit, [
      { type: 'setElementReadiness', elementId: element.id, readiness: 'needs_clarification' },
      { type: 'recordMeasurement', id: randomUUID(), elementId: element.id, parameter: 'doorWidth', text: '95', unit: 'cm' },
      { type: 'confirmElement', elementId: element.id },
    ], { auditId: audit.id, actor: audit.author, transactionId: randomUUID(), revision: audit.revision + 1, committedAt: audit.updatedAt });
    element = audit.elements[element.id]!;
    expect(element.readiness).toBe('ready');
    expect(elementVisualStatus(audit, element)).toBe('success');
    expect(Object.values(audit.measurements).some(item => item.raw.text === '80' && !item.primary)).toBe(true);
  });

  it('turns a documented defect green on confirmation without deleting its finding', () => {
    const initial = fixture(); let audit = initial.audit; const id = initial.element.id; const findingId = randomUUID();
    const context = { auditId: audit.id, actor: audit.author, transactionId: randomUUID(), revision: 1, committedAt: audit.updatedAt };
    audit = applyAuditCommands(audit, [
      { type: 'updateElement', elementId: id, patch: { applicability: 'applicable', presence: 'absent' } },
      { type: 'addFinding', finding: { id: findingId, elementId: id, type: 'absence', text: 'Дверь отсутствует', measurementIds: [], photoIds: [] } },
      { type: 'setElementReadiness', elementId: id, readiness: 'needs_clarification' },
    ], context);
    expect(elementVisualStatus(audit, audit.elements[id]!)).toBe('danger');
    audit = applyAuditCommands(audit, [{ type: 'confirmElement', elementId: id }], { ...context, revision: 2, transactionId: randomUUID() });
    expect(elementVisualStatus(audit, audit.elements[id]!)).toBe('success');
    expect(audit.findings[findingId]?.text).toBe('Дверь отсутствует');
    audit = applyAuditCommands(audit, [{ type: 'updateFinding', id: findingId, text: 'Уточнённое замечание', findingType: 'absence' }], { ...context, revision: 3, transactionId: randomUUID() });
    expect(elementVisualStatus(audit, audit.elements[id]!)).toBe('danger');
  });

});
