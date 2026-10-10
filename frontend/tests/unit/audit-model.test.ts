import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { applyAuditCommands, createZ2Audit, primaryMeasurement, validateAudit, elementQuestions, type Audit, type AuditCommand } from '../../src/domain/audit-model.js';
import { parseMeasurement } from '../../src/domain/measurements.js';
import { Z2_TEMPLATE } from '../../src/templates/z2-template.js';
const actor = { id: randomUUID(), name: 'Инспектор' };
const at = '2026-10-10T10:00:00.000Z';
function initial() { return createZ2Audit({ object: { name: 'Школа', address: 'Москва, улица 1' }, inspectedOn: '2026-10-10', author: actor, purpose: 'Проверка входа' },
  { auditId: randomUUID(), objectId: randomUUID(), zoneId: randomUUID(), elementIds: Z2_TEMPLATE.elements.map(() => randomUUID()) }, at); }
function reduce(audit: Audit, ...commands: AuditCommand[]) { return applyAuditCommands(audit, commands, { auditId: audit.id, actor, transactionId: randomUUID(), revision: audit.revision + 1, committedAt: at }); }
describe('M1 Z2', () => {
  it('AC-01: serializable object, explicit scope and versioned template survive restoration', () => {
    const audit = initial(); const restored = JSON.parse(JSON.stringify(audit)); validateAudit(restored);
    expect(restored).toEqual(audit); expect(restored.scope.includedZones).toEqual(['Z2']); expect(Object.values(restored.elements)).toHaveLength(5);
  });
  it('AC-02: two doors retain independent measurements without mutating the input', () => {
    const base = initial(); const door = Object.values(base.elements).find((e) => e.type === 'door')!; const id = randomUUID();
    const result = reduce(base, { type: 'addElement', id, zoneId: door.zoneId, elementType: 'door', name: 'Вторая дверь' },
      { type: 'recordMeasurement', id: randomUUID(), elementId: door.id, parameter: 'doorWidth', text: '900', unit: 'mm' },
      { type: 'recordMeasurement', id: randomUUID(), elementId: id, parameter: 'doorWidth', text: '1,2', unit: 'm' });
    expect(primaryMeasurement(result, door.id, 'doorWidth')?.normalized.value).toBe(90);
    expect(primaryMeasurement(result, id, 'doorWidth')?.normalized.value).toBe(120);
    expect(base.measurements).toEqual({}); expect(base.elements[id]).toBeUndefined();
  });
  it('AC-03: absent mandatory handrail can be confirmed only with an absence finding', () => {
    let audit = initial(); const handrail = Object.values(audit.elements).find((e) => e.type === 'handrail')!;
    audit = reduce(audit, { type: 'updateElement', elementId: handrail.id, patch: { applicability: 'applicable', presence: 'absent' } });
    expect(() => reduce(audit, { type: 'confirmElement', elementId: handrail.id })).toThrow('отсутствии');
    audit = reduce(audit, { type: 'addFinding', finding: { id: randomUUID(), elementId: handrail.id, type: 'absence', text: 'Поручень отсутствует', measurementIds: [], photoIds: [] } }, { type: 'confirmElement', elementId: handrail.id });
    expect(audit.elements[handrail.id]?.readiness).toBe('ready'); expect(audit.elements[handrail.id]?.presence).toBe('absent');
    expect(Object.values(audit.findings)[0]?.confirmation?.by).toEqual(actor); expect(audit.status).toBe('in_progress');
  });
  it('AC-04: zero is a measurement; empty retires it without destroying history', () => {
    let audit = initial(); const door = Object.values(audit.elements).find((e) => e.type === 'door')!;
    audit = reduce(audit, { type: 'recordMeasurement', id: randomUUID(), elementId: door.id, parameter: 'thresholdHeight', text: '0', unit: 'cm' });
    expect(primaryMeasurement(audit, door.id, 'thresholdHeight')?.normalized.value).toBe(0);
    audit = reduce(audit, { type: 'setMeasurementInput', elementId: door.id, parameter: 'thresholdHeight', input: { text: '', unit: 'cm' } });
    expect(primaryMeasurement(audit, door.id, 'thresholdHeight')).toBeUndefined(); expect(Object.values(audit.measurements)[0]?.raw.value).toBe(0);
    expect(parseMeasurement('thresholdHeight', '', 'cm')).toBeUndefined();
  });
  it('rejects absent + working without changing the previous audit', () => {
    const audit = initial(); const element = Object.values(audit.elements)[0]!;
    expect(() => reduce(audit, { type: 'updateElement', elementId: element.id, patch: { presence: 'absent', operability: 'working' } })).toThrow('работоспособным');
    expect(audit.elements[element.id]?.presence).toBe('unknown');
  });
  it('keeps all four statuses independent and preserves unfinished raw input', () => {
    const audit = initial(); const door = Object.values(audit.elements)[0]!;
    const result = reduce(audit, { type: 'setMeasurementInput', elementId: door.id, parameter: 'doorWidth', input: { text: '1,', unit: 'm' } });
    expect(result.elements[door.id]?.measurementInputs.doorWidth?.text).toBe('1,');
    expect(result.elements[door.id]?.presence).toBe('unknown'); expect(result.elements[door.id]?.operability).toBe('unknown');
    expect(() => parseMeasurement('doorWidth', '1,', 'm')).toThrow();
  });
  it('versions new measurements and invalidates confirmation after edits', () => {
    let audit = initial(); const door = Object.values(audit.elements)[0]!; const first = randomUUID(); const second = randomUUID();
    audit = reduce(audit, { type: 'updateElement', elementId: door.id, patch: { applicability: 'applicable', presence: 'present', operability: 'working' } },
      { type: 'recordMeasurement', id: first, elementId: door.id, parameter: 'doorWidth', text: '90', unit: 'cm' },
      { type: 'recordMeasurement', id: randomUUID(), elementId: door.id, parameter: 'thresholdHeight', text: '0', unit: 'cm' }, { type: 'confirmElement', elementId: door.id });
    expect(audit.elements[door.id]?.readiness).toBe('ready');
    audit = reduce(audit, { type: 'recordMeasurement', id: second, elementId: door.id, parameter: 'doorWidth', text: '95', unit: 'cm' });
    expect(audit.measurements[first]?.primary).toBe(false); expect(audit.measurements[second]?.supersedesId).toBe(first);
    expect(audit.measurements[second]?.revision).toBe(2); expect(audit.elements[door.id]?.confirmation).toBeUndefined();
  });
  it('requires a reason for not applicable, and reports addressable questions', () => {
    let audit = initial(); const door = Object.values(audit.elements)[0]!;
    audit = reduce(audit, { type: 'updateElement', elementId: door.id, patch: { applicability: 'not_applicable' } });
    expect(elementQuestions(audit, audit.elements[door.id]!)[0]).toMatchObject({ elementId: door.id, field: 'exclusionReason' });
    audit = reduce(audit, { type: 'updateElement', elementId: door.id, patch: { exclusionReason: 'Открытый проход без двери' } }, { type: 'confirmElement', elementId: door.id });
    expect(audit.elements[door.id]?.readiness).toBe('ready');
  });
  it('archives without deleting facts and prevents further edits', () => {
    const audit = reduce(initial(), { type: 'archiveAudit' }); expect(audit.archivedAt).toBe(at);
    expect(() => reduce(audit, { type: 'setScope', includedZones: ['Z2'], purpose: 'Другая цель' })).toThrow('Архивное');
  });
  it('rejects wrong units, malformed numbers and invalid dates', () => {
    for (const value of ['-1', 'NaN', 'Infinity', '1 000', '1e2']) expect(() => parseMeasurement('doorWidth', value, 'cm')).toThrow();
    expect(() => parseMeasurement('doorWidth', '10', '%')).toThrow(); expect(() => parseMeasurement('rampSlope', '90', 'deg')).toThrow();
    const audit = initial(); audit.inspectedOn = '2026-02-30'; expect(() => validateAudit(audit)).toThrow('дату');
  });
  it('converts degrees to slope percent and retains the exact source text', () => {
    const parsed = parseMeasurement('rampSlope', ' 5,0 ', 'deg')!;
    expect(parsed.normalized.value).toBeCloseTo(8.748866); expect(parsed.normalized.unit).toBe('%'); expect(parsed.raw.text).toBe(' 5,0 ');
  });
});
