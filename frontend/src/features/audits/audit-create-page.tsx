import { useRef } from 'react';
import { createZ2Audit } from '../../domain/audit-model.js';
import { Z2_TEMPLATE } from '../../templates/z2-template.js';
import { audits } from './audit-service.js';
import { AuditNavigationRow } from './audit-header.js';
import { ObjectDetailsForm, type ObjectDetailsValues } from './object-details-form.js';

export function AuditCreatePage({ navigate }: { navigate: (hash: string) => void }) {
  const createdId = useRef('');
  const back = () => navigate('#/audits');
  const create = async (values: ObjectDetailsValues) => {
    const actor = { id: crypto.randomUUID(), name: values.authorName }; const id = crypto.randomUUID();
    const audit = createZ2Audit({ object: values.object, inspectedOn: values.inspectedOn, author: actor, purpose: values.purpose },
      { auditId: id, objectId: crypto.randomUUID(), zoneId: crypto.randomUUID(), elementIds: Z2_TEMPLATE.elements.map(() => crypto.randomUUID()) }, new Date().toISOString());
    const result = await audits.commit({ auditId: id, actor, expectedRevision: 0, transactionId: crypto.randomUUID(), commands: [{ type: 'createAudit', audit }] });
    if (result.kind !== 'committed') throw new Error('Обследование не сохранено. Повторите создание.');
    createdId.current = id;
  };
  return <main className="audit-main audit-create-page" data-page-ready="true">
    <header className="audit-header"><AuditNavigationRow name="Новое обследование" backLabel="Все обследования" onBack={back} /></header>
    <div className="workspace-content"><ObjectDetailsForm standalone onSubmit={create} onSubmitted={() => navigate(`#/audits/${createdId.current}`)} onCancel={back} /></div>
  </main>;
}
