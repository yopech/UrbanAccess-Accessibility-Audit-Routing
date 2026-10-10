import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { evaluateMeasurementNorm as evaluate } from '../../src/domain/norms/norm-engine.js';
import { Z2_NORM_RULES } from '../../src/domain/norms/rules-z2.js';
import { createZ2Audit, applyAuditCommands, validateAuditReadiness } from '../../src/domain/audit-model.js';
import type { BasicParameter, Unit } from '../../src/domain/audit-model.js';
import { Z2_TEMPLATE } from '../../src/templates/z2-template.js';
import { buildActDraft } from '../../src/documents/act-draft.js';
const test = (parameter: BasicParameter, value: number, unit: Unit = 'cm') => evaluate(parameter, { value, unit })!;
describe('Z2 preliminary norm profile', () => {
  it.each(['doorWidth', 'rampWidth'] as const)('%s lower limits and warning boundary', (parameter) => {
    expect(test(parameter, 90).status).toBe('ok'); expect(test(parameter, 89.9).status).toBe('warn');
    expect(test(parameter, 85).status).toBe('warn'); expect(test(parameter, 84.999).status).toBe('fail');
    expect(test(parameter, 95).delta).toBe(0); expect(test(parameter, 80).delta).toBe(10);
  });
  it('threshold continuous warning band has no rounding gaps', () => {
    expect(test('thresholdHeight', 1.4).status).toBe('ok'); expect(test('thresholdHeight', 1.45).status).toBe('warn');
    expect(test('thresholdHeight', 1.5).status).toBe('warn'); expect(test('thresholdHeight', 2).status).toBe('warn');
    expect(test('thresholdHeight', 2.001).status).toBe('fail'); expect(test('thresholdHeight', 2.1).delta).toBe(.7);
  });
  it('slope upper bound, intermediate values and percentage-point delta', () => {
    expect(test('rampSlope', 5, '%').status).toBe('ok'); expect(test('rampSlope', 5.05, '%').status).toBe('warn');
    expect(test('rampSlope', 5.1, '%').status).toBe('warn'); expect(test('rampSlope', 8, '%').status).toBe('warn');
    expect(test('rampSlope', 8.001, '%').status).toBe('fail'); expect(test('rampSlope', 9, '%').delta).toBe(4);
    expect(test('rampSlope', 9, '%').message).toContain('4 п.п.');
  });
  it('landing lower bound and warning band', () => {
    expect(test('landingDepth', 150).status).toBe('ok'); expect(test('landingDepth', 149.9).status).toBe('warn');
    expect(test('landingDepth', 120).status).toBe('warn'); expect(test('landingDepth', 119.9).status).toBe('fail');
    expect(test('landingDepth', 100).delta).toBe(50);
  });
  it.each([[900, 'mm'], [.9, 'm'], [90, 'cm']] as const)('normalizes %s %s without false threshold failure', (value, unit) => {
    expect(test('doorWidth', value, unit)).toMatchObject({ value: 90, delta: 0, status: 'ok', unit: 'cm' });
  });
  it('normalizes degree slope to percent, including the exact boundary', () => {
    expect(test('rampSlope', Math.atan(.05) * 180 / Math.PI, 'deg')).toMatchObject({ value: 5, status: 'ok' });
    expect(test('rampSlope', Math.atan(.09) * 180 / Math.PI, 'deg')).toMatchObject({ value: 9, delta: 4, status: 'fail' });
  });
  it('zero is valid; missing or unsupported measurement gives no fabricated ok', () => {
    expect(test('thresholdHeight', 0).status).toBe('ok'); expect(test('doorWidth', 0).status).toBe('fail');
    expect(evaluate('doorWidth', undefined)).toBeUndefined(); expect(evaluate('handrailHeight', {value:90,unit:'cm'})).toBeUndefined();
  });
  it.each([NaN, Infinity, -1])('rejects invalid value %s', (value) => expect(() => test('doorWidth', value)).toThrow());
  it('rejects dimension mismatch and impossible angles', () => {
    expect(() => test('doorWidth', 90, '%')).toThrow(); expect(() => test('rampSlope', 5, 'cm')).toThrow();
    expect(() => test('rampSlope', 90, 'deg')).toThrow(); expect(() => test('doorWidth', 90, 'custom')).toThrow();
    expect(() => test('doorWidth', Number.MAX_VALUE, 'm')).toThrow();
  });
  it('rejects inverted profile warning boundaries', () => {
    expect(() => evaluate('doorWidth', {value:80,unit:'cm'}, [{...Z2_NORM_RULES[0]!,warnBoundary:95}])).toThrow();
  });
  it('supplies actual delta and correct citation without asserting a legal violation', () => {
    const result = test('doorWidth', 80);
    expect(result.source.clauses).toEqual(['6.1.5']); expect(result.ruleVersion).toBe('0.1.0');
    expect(result.recommendation).toContain('10 см'); expect(result.recommendation).toContain('90 см');
    expect(result.recommendation).toContain('Применимость нормы'); expect(result.mode).toBe('preliminary');
    expect(test('landingDepth', 100).source.clauses).toEqual(['5.1.16','6.2.9']);
    expect(test('thresholdHeight', 3).source.clauses).toEqual(['6.2.4']);
    expect(test('doorWidth', 90).recommendation).toBe('');
  });
  it('is deterministic and leaves inputs and rule definitions untouched', () => {
    const input = Object.freeze({value:80,unit:'cm' as const});
    expect(evaluate('doorWidth',input)).toEqual(evaluate('doorWidth',input)); expect(input.value).toBe(80);
    expect(Object.isFrozen(Z2_NORM_RULES)).toBe(true);
  });
  it('optional landing measurement persists and exports without adding mandatory readiness gaps', () => {
    const actor = { id:randomUUID(), name:'Инспектор' }; const at = '2026-10-10T10:00:00.000Z';
    const audit = createZ2Audit({object:{name:'Объект',address:'Адрес'},author:actor,inspectedOn:'2026-10-10',purpose:'Z2'}, {auditId:randomUUID(),objectId:randomUUID(),zoneId:randomUUID(),elementIds:Z2_TEMPLATE.elements.map(()=>randomUUID())},at);
    const element = Object.values(audit.elements).find(e=>e.type==='platform')!;
    const next = applyAuditCommands(audit,[{type:'recordMeasurement',id:randomUUID(),elementId:element.id,parameter:'landingDepth',text:'1,2',unit:'m'}],{auditId:audit.id,actor,transactionId:randomUUID(),revision:2,committedAt:at});
    expect(Object.values(next.measurements)[0]?.normalized.value).toBe(120);
    expect(validateAuditReadiness(next).filter(q=>q.field==='landingDepth')).toHaveLength(0);
    const doc = buildActDraft(next, [], [], randomUUID(), at);
    expect(JSON.stringify(doc)).toContain('Глубина горизонтальной площадки пандуса');
    expect(validateAuditReadiness(audit).filter(q=>q.field==='landingDepth')).toHaveLength(0);
  });
});
