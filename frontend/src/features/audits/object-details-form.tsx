import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { registerNavigationGuard } from '../../app/navigation-guards.js';
import { Button } from '../../components/ui/button.js';
import { validLocalDate, type Audit, type ObjectDetails } from '../../domain/audit-model.js';
import { updateParticipants } from '../../pwa/update-participants.js';
import { pwaUpdates } from '../../pwa/pwa-update-controller.js';
export interface ObjectDetailsValues { object: ObjectDetails; inspectedOn: string; authorName: string; purpose: string; }
export function ObjectDetailsForm({ initial, onSubmit, onCancel, onSubmitted, standalone = false }: {
  initial?: Audit; onSubmit: (value: ObjectDetailsValues) => Promise<void>; onCancel: () => void; onSubmitted?: () => void; standalone?: boolean;
}) {
  const [name, setName] = useState(initial?.object.name ?? '');
  const [address, setAddress] = useState(initial?.object.address ?? '');
  const [date, setDate] = useState(initial?.inspectedOn ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`);
  const [author, setAuthor] = useState(initial?.author.name ?? '');
  const [purpose, setPurpose] = useState(initial?.scope.purpose ?? 'Обследование доступности входной группы');
  const [scope, setScope] = useState(Boolean(initial));
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const dirty = useRef(false); const saving = useRef(false);
  const pwa = useSyncExternalStore(pwaUpdates.subscribe, pwaUpdates.getSnapshot, pwaUpdates.getSnapshot);
  useEffect(() => updateParticipants.add({ prepareUpdate: async () => !dirty.current && !saving.current, releaseUpdate() {} }), []);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty.current || saving.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
  useEffect(() => registerNavigationGuard(() => !saving.current && (!dirty.current || confirm('Реквизиты ещё не сохранены. Покинуть форму и отменить изменения?'))), []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Введите название объекта.'; if (!address.trim()) next.address = 'Введите адрес.';
    if (!validLocalDate(date)) next.date = 'Выберите корректную дату.'; if (!author.trim()) next.author = 'Укажите исполнителя.';
    if (!purpose.trim()) next.purpose = 'Укажите цель обследования.'; if (!scope) next.scope = 'Подтвердите объём обследования.';
    setErrors(next); if (Object.keys(next).length) return;
    setBusy(true); saving.current = true; let succeeded = false;
    try { await onSubmit({ object: { ...initial?.object, name: name.trim(), address: address.trim() }, inspectedOn: date, authorName: author.trim(), purpose: purpose.trim() }); dirty.current = false; succeeded = true; }
    catch (error) { dirty.current = true; setErrors({ submit: error instanceof Error ? error.message : 'Не удалось сохранить объект.' }); }
    finally { setBusy(false); saving.current = false; }
    if (succeeded) onSubmitted?.();
  };
  const fields = [{ key: 'name', label: 'Название объекта', value: name, change: setName }, { key: 'address', label: 'Адрес', value: address, change: setAddress },
    { key: 'date', label: 'Дата обследования', value: date, change: setDate }, { key: 'author', label: 'Исполнитель', value: author, change: setAuthor },
    { key: 'purpose', label: 'Цель обследования', value: purpose, change: setPurpose }];
  return <form className="surface details-form" onSubmit={(event) => { void submit(event); }} onChange={() => { dirty.current = true; }}>
    {!standalone && <div className="details-form-heading"><h2>{initial ? 'Реквизиты объекта' : 'Новое обследование'}</h2></div>}
    <fieldset disabled={busy || pwa.status === 'preparing'}>
      <div className="details-fields">{fields.map((field) => <label className={`field details-field-${field.key}`} key={field.key} htmlFor={`object-${field.key}`}><span>{field.label}</span>
        <input id={`object-${field.key}`} type={field.key === 'date' ? 'date' : 'text'} value={field.value} onChange={(event) => field.change(event.target.value)}
          aria-invalid={Boolean(errors[field.key])} aria-describedby={errors[field.key] ? `error-${field.key}` : undefined} required />
        {errors[field.key] && <span className="field-error" id={`error-${field.key}`}>{errors[field.key]}</span>}
      </label>)}</div>
      <label className="check-field"><input type="checkbox" checked={scope} onChange={(event) => setScope(event.target.checked)} />
        <span>{initial && initial.scope.includedZones.length > 1 ? `Проверяем зоны ${initial.scope.includedZones.join(', ')}` : 'Проверяем только входную группу Z2'}</span></label>
      <p className="secondary-text">Новые обследования начинаются с входной группы Z2. Территорию, внутренние пути и санузел можно добавить переключателем зон в редакторе. В документ входят только созданные зоны.</p>
      {errors.scope && <p role="alert" className="field-error">{errors.scope}</p>}
      {errors.submit && <p role="alert" className="field-error">{errors.submit}</p>}
      <div className={standalone ? 'create-audit-dock' : 'action-row'}><Button type="submit" variant="primary">{busy ? 'Сохраняем' : initial ? 'Сохранить реквизиты' : 'Создать обследование'}</Button>
        {!standalone && <Button onClick={onCancel}>Отмена</Button>}</div>
    </fieldset>
  </form>;
}
