import { AlertTriangle, AlertCircle } from 'lucide-react';
import type { NormEvaluationResult } from '../../domain/norms/types.js';
import { evaluateMeasurementNorm } from '../../domain/norms/norm-engine.js';
import { useState } from 'react';
import { PARAMETER_LABELS, isSlopeParameter, parseMeasurement } from '../../domain/measurements.js';
import { primaryMeasurement, type Audit, type AuditCommand, type BasicParameter, type Element, type MeasurementInput, type Unit } from '../../domain/audit-model.js';
import type { EditorController } from './editor-controller.js';
export function MeasurementField({ element, parameter, controller }: { audit: Readonly<Audit>; element: Element; parameter: BasicParameter; controller: EditorController<Audit, AuditCommand> }) {
  const [error, setError] = useState(''); const input: MeasurementInput = element.measurementInputs[parameter] ?? { text: '', unit: isSlopeParameter(parameter) ? '%' : 'cm' };
  const fixedUnit: Unit = isSlopeParameter(parameter) ? '%' : 'cm';
  let displayText = input.text;
  if (input.unit !== fixedUnit) { try { const parsed = parseMeasurement(parameter, input.text, input.unit); if (parsed) displayText = parsed.normalized.value.toLocaleString('ru-RU', { useGrouping: false, maximumFractionDigits: 12 }); } catch { /* Preserve incomplete legacy input until the inspector edits it. */ } }
  let normHint: NormEvaluationResult | undefined;
  try { const parsed = parseMeasurement(parameter, input.text, input.unit); normHint = evaluateMeasurementNorm(parameter, parsed?.normalized, undefined, element.type); } catch { /* Invalid or unfinished input is handled by the existing field validation. */ }
  const id = `measurement-${element.id}-${parameter}`;
  const change = (text: string, unit: Unit) => { setError(''); controller.enqueue({ type: 'setMeasurementInput', elementId: element.id, parameter, input: { text, unit } }); };
  const record = async () => {
    try {
      const fresh = controller.getSnapshot().value.elements[element.id]!.measurementInputs[parameter] ?? input;
      const parsed = parseMeasurement(parameter, fresh.text, fresh.unit);
      const existing = primaryMeasurement(controller.getSnapshot().value, element.id, parameter);
      if (parsed && !(existing?.raw.text === fresh.text && existing.raw.unit === fresh.unit)) controller.enqueue({ type: 'recordMeasurement', id: crypto.randomUUID(), elementId: element.id, parameter, text: fresh.text, unit: fresh.unit });
      await controller.flush();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Проверьте замер.'); await controller.flush(); }
  };
  return <div className="measurement-field"><div className="measurement-number-card"><label htmlFor={id}>{PARAMETER_LABELS[parameter]}</label>
    <div className="measurement-row"><input data-audit-field={parameter} id={id} inputMode="decimal" type="text" value={displayText} placeholder="–" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-help` : normHint && normHint.status !== 'ok' ? `${id}-norm` : undefined} className="min-h-[52px] text-[16px] tabular-nums font-medium tracking-tight"
      onChange={(event) => change(event.target.value, fixedUnit)} onBlur={() => { void record(); }} />
      <span className="measurement-fixed-unit" aria-hidden>{fixedUnit === 'cm' ? 'см' : '%'}</span></div></div>
    {!error && normHint && normHint.status !== 'ok' && <div className="measurement-norm-group">
      <p id={`${id}-norm`} data-norm-status={normHint.status} className={`norm-banner norm-banner-${normHint.status}`}>{normHint.status === 'warn' ? <AlertTriangle size={18} aria-hidden /> : <AlertCircle size={18} aria-hidden />}<span>{PARAMETER_LABELS[parameter]}: {normHint.value.toLocaleString('ru-RU')} {normHint.unit === 'cm' ? 'см' : '%'}. Ориентир: {normHint.message.match(/Ориентир: (.*?)\. СП/)?.[1] ?? `${normHint.limit} ${normHint.unit === 'cm' ? 'см' : '%'}`}. Отклонение от предварительного профиля: {normHint.delta.toLocaleString('ru-RU')} {normHint.unit === 'cm' ? 'см' : 'п.п.'}.</span></p>
      <details className="norm-legal-reference"><summary>Основание по СП 59</summary><p>{normHint.message}</p><a href={normHint.source.url} target="_blank" rel="noreferrer">{normHint.source.document}, п. {normHint.source.clauses.join(', ')}</a></details>
    </div>}
    {error && <p id={`${id}-help`} className="field-error">{error}</p>}
  </div>;
}
