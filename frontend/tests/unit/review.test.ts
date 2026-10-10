import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createZ2Audit, applyAuditCommands, validateAuditReadiness, type Audit, type AuditCommand } from '../../src/domain/audit-model.js';
import { Z2_TEMPLATE } from '../../src/templates/z2-template.js';
import { buildActDraft, SCOPE_LABEL } from '../../src/documents/act-draft.js';
import { fitImage, renderPrintHtml } from '../../src/documents/act-export.js';
const actor = { id: randomUUID(), name: 'Инспектор' }; const at = '2026-10-10T12:00:00.000Z';
function fresh() { return createZ2Audit({ object: { name: 'Школа', address: 'Москва' }, inspectedOn: '2026-10-10', author: actor, purpose: 'Проверка' }, { auditId: randomUUID(), objectId: randomUUID(), zoneId: randomUUID(), elementIds: Z2_TEMPLATE.elements.map(() => randomUUID()) }, at); }
function apply(audit: Audit, commands: AuditCommand[]) { return applyAuditCommands(audit, commands, { auditId: audit.id, actor, transactionId: randomUUID(), revision: audit.revision + 1, committedAt: at }); }
function complete() { let audit = fresh(); for (const element of Object.values(audit.elements)) audit = apply(audit, [{ type: 'updateElement', elementId: element.id, patch: { applicability: 'not_applicable', exclusionReason: 'Другой проверяемый вход' } }, { type: 'confirmElement', elementId: element.id }]); return audit; }
describe('Readiness and document snapshots', () => {
  it('requires current confirmations and returns addressable gaps', () => { const audit = fresh(); expect(validateAuditReadiness(audit, Z2_TEMPLATE).some((q) => q.field === 'readiness')).toBe(true); expect(validateAuditReadiness(complete(), Z2_TEMPLATE)).toEqual([]); });
  it('AC-23: expert review captures author, revision and date; later edit invalidates review', () => {
    const expert = { id: randomUUID(), name: 'Эксперт' }; const audit = apply(complete(), [{ type: 'reviewAudit', expert }]); expect(audit.reviewed).toEqual({ auditRevision: audit.revision, by: expert, at });
    for (const command of [{ type: 'updateObjectDetails', object: { ...audit.object, name: 'Исправленный объект' }, inspectedOn: audit.inspectedOn, author: actor }, { type: 'updateElement', elementId: Object.keys(audit.elements)[0]!, patch: { comment: 'Исправление' } }] as AuditCommand[]) { const changed = apply(audit, [command]); expect(changed.reviewed).toBeUndefined(); expect(changed.status).toBe('in_progress'); } expect(audit.reviewed).toBeDefined();
  });
  it('incomplete cards cannot be marked reviewed', () => { expect(() => apply(fresh(), [{ type: 'reviewAudit', expert: actor }])).toThrow(); });
  it('AC-22: immutable snapshot keeps original text and explicit Z2 fragment marking', () => {
    const audit = complete(); const snapshot = buildActDraft(audit, [], []); const before = JSON.stringify(snapshot); audit.object.name = 'Изменён'; audit.template.version = '99'; expect(JSON.stringify(snapshot)).toBe(before); expect(snapshot.scopeLabel).toBe(SCOPE_LABEL); expect(snapshot.missingInformation).toEqual([]);
    expect(buildActDraft(fresh(), [], []).missingInformation.length).toBeGreaterThan(0);
  });
  it('print HTML escapes inspector input and uses local A4 layout', () => { const audit = fresh(); audit.object.name = '<script>alert(1)</script>'; const html = renderPrintHtml(buildActDraft(audit, [], []), new Map()); expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain('size: A4; margin: 15mm'); });
  it('photo fit preserves proportions without upscaling', () => { expect(fitImage(200,100)).toEqual({width:200,height:100}); expect(fitImage(1200,800)).toEqual({width:610,height:407}); expect(fitImage(800,1600)).toEqual({width:210,height:420}); });
});
