import { elementQuestions, primaryMeasurement, type Audit, type Element } from '../../domain/audit-model.js';
import { definitionFor, measurementParametersFor } from '../../domain/templates/index.js';
import { evaluateMeasurementNorm } from '../../domain/norms/norm-engine.js';

export type ElementVisualStatus = 'neutral' | 'danger' | 'warning' | 'success';
/** Green means completed inspection, not normative compliance. Does not change saved data. */
export function elementVisualStatus(audit: Audit, element: Element): ElementVisualStatus {
  if (element.readiness === 'ready' && element.confirmation?.valueRevision === element.revision
    && elementQuestions(audit, element).length === 0) return 'success';
  const findings = Object.values(audit.findings).some(item => item.elementId === element.id && Boolean(item.text.trim()));
  const applicable = element.applicability !== 'not_applicable';
  const norms = applicable && element.presence !== 'absent' ? measurementParametersFor(element.type).flatMap(parameter => {
    const measurement = primaryMeasurement(audit, element.id, parameter);
    const input = element.measurementInputs[parameter];
    if (!measurement || (input && (input.text !== measurement.raw.text || input.unit !== measurement.raw.unit))) return [];
    const result = evaluateMeasurementNorm(parameter, measurement.normalized, undefined, element.type);
    return result ? [result.status] : [];
  }) : [];
  if (findings || (applicable && (norms.includes('fail') || element.operability === 'defective' || element.operability === 'not_working'
    || (element.presence === 'absent' && definitionFor(element.type).required)
    || Object.values(element.checks ?? {}).includes('absent')))) return 'danger';
  if (element.applicability === 'not_applicable') return 'neutral';
  const started = element.readiness !== 'not_started' || element.applicability !== 'unknown' || element.presence !== 'unknown'
    || element.operability !== 'unknown' || element.comment.trim() || element.photoIds.length > 0
    || Object.values(element.measurementInputs).some(input => input?.text.trim())
    || Object.values(audit.measurements).some(item => item.elementId === element.id)
    || Object.values(element.checks ?? {}).some(value => value !== 'unknown');
  return started ? 'warning' : 'neutral';
}
