import { AlertTriangle, AlertCircle } from 'lucide-react';
import type { NormEvaluationResult } from '../../domain/norms/types.js';
import { evaluateMeasurementNorm } from '../../domain/norms/norm-engine.js';
import { useState } from 'react';
import { PARAMETER_LABELS, isSlopeParameter, parseMeasurement } from '../../domain/measurements.js';
import { primaryMeasurement, type Audit, type AuditCommand, type BasicParameter, type Element, type MeasurementInput, type Unit } from '../../domain/audit-model.js';
import type { EditorController } from './editor-controller.js';
export function MeasurementField({ element, parameter, controller }: { audit: Readonly<Audit>; element: Element; parameter: BasicParameter; controller: EditorController<Audit, AuditCommand> }) {
  const [error, setError] = useState(''); const input: MeasurementInput = element.measurementInputs[parameter] ?? { text: '', unit: isSlopeParameter(parameter) ? '%' : 'cm' };
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
  return <div className="measurement-field"><label htmlFor={id}>{PARAMETER_LABELS[parameter]}</label>
    <div className="measurement-row"><input data-audit-field={parameter} id={id} inputMode="decimal" type="text" value={input.text} placeholder="Не измерено" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-help` : normHint && normHint.status !== 'ok' ? `${id}-norm` : undefined} className="min-h-[52px] text-[16px] tabular-nums font-medium tracking-tight"
      onChange={(event) => change(event.target.value, input.unit)} onBlur={() => { void record(); }} />
      <select className="measurement-unit-select cursor-pointer min-h-[52px]" aria-label={`Единица: ${PARAMETER_LABELS[parameter]}`} value={input.unit}
        onChange={(event) => { change(input.text, event.target.value as Unit); void record(); }}>
        {(isSlopeParameter(parameter) ? ['%', 'deg'] : ['mm', 'cm', 'm']).map((unit) => <option key={unit} value={unit}>{({ mm: 'мм', cm: 'см', m: 'м', '%': '%', deg: '°' } as Record<string, string>)[unit]}</option>)}
      </select></div>
    {!error && normHint && normHint.status !== 'ok' && <p id={`${id}-norm`} data-norm-status={normHint.status} className={normHint.status === 'fail' ? 'field-error' : 'measurement-norm-warning'}>{normHint.status === 'warn' ? <AlertTriangle size={14} aria-hidden /> : <AlertCircle size={14} aria-hidden />}<span>{normHint.message}</span></p>}
    {error && <p id={`${id}-help`} className="field-error">{error}</p>}
  </div>;
}
