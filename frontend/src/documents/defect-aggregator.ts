import { primaryMeasurement, type Audit } from '../domain/audit-model.js';
import { definitionFor, measurementParametersFor } from '../domain/templates/index.js';
import { NORM_RULES } from '../domain/norms/registry.js';
import { evaluateMeasurementNorm } from '../domain/norms/norm-engine.js';
export interface AuditDefect {
  zoneName: string; elementName: string; location: string; actualIssue: string;
  normRequirement: string; spReference: string; recommendation: string; photoIds: string[];
}
/** Aggregates recorded facts and preliminary profile signals, not legally established violations. */
export function aggregateAuditDefects(audit: Readonly<Audit>): AuditDefect[] {
  const rows: AuditDefect[] = [];
  for (const zone of Object.values(audit.zones).filter(zone => zone.included).sort((a,b)=>a.code.localeCompare(b.code))) {
    for (const id of zone.elementIds) {
      const element = audit.elements[id]!;
      if (element.applicability === 'not_applicable') continue;
      const issues: string[] = []; const requirements: string[] = []; const references: string[] = []; const suggestions: string[] = [];
      if (element.presence === 'absent' && definitionFor(element.type).required) issues.push('Обязательный элемент отсутствует.');
      if (element.presence !== 'absent' && ['defective','not_working'].includes(element.operability)) issues.push(element.operability === 'defective' ? 'Зафиксирован дефект элемента.' : 'Элемент не работает.');
      if (element.presence !== 'absent') for (const parameter of measurementParametersFor(element.type)) {
        const measurement = primaryMeasurement(audit,id,parameter); const input = element.measurementInputs[parameter];
        if (!measurement || (input && (input.text !== measurement.raw.text || input.unit !== measurement.raw.unit))) continue;
        const result = evaluateMeasurementNorm(parameter,measurement.normalized,undefined,element.type);
        if (!result || result.status === 'ok') continue;
        const rule=NORM_RULES.find(rule=>rule.id===result.ruleId)!;
        const format=(value:number)=>value.toLocaleString('ru-RU',{maximumFractionDigits:4}); const unit=result.unit==='cm'?'см':'%';
        const target=rule.comparison==='range'?`${format(rule.limit)}–${format(rule.upperLimit!)} ${unit}`:`${rule.comparison==='min'?'не менее':'не более'} ${format(rule.limit)} ${unit}`;
        issues.push(`${rule.label}: ${format(result.value)} ${unit}. Отклонение от предварительного профиля ${format(result.delta)} ${result.unit==='cm'?'см':'п.п.'} (${result.status==='warn'?'уточнение':'отклонение'}).`);
        requirements.push(`${rule.label}: ${target}. ${rule.applicability}`);
        references.push(`${result.source.document}, п. ${result.source.clauses.join(', ')}`);
        suggestions.push(`${rule.action}. Ориентир предварительного профиля: ${target}; применимость и способ адаптации подтверждает эксперт.`);
      }
      for (const finding of Object.values(audit.findings).filter(f=>f.elementId===id&&f.text.trim())) {
        const confirmed = finding.confirmation?.valueRevision === element.revision && element.confirmation?.valueRevision === element.revision && element.readiness === 'ready';
        issues.push(`${confirmed ? 'Замечание инспектора' : 'Замечание для подтверждения'}: ${finding.text.trim()}`);
      }
      if (!issues.length) continue;
      for (const recommendation of Object.values(audit.recommendations).filter(r=>r.elementId===id&&r.text.trim())) suggestions.push(`Предложение инспектора: ${recommendation.text.trim()}`);
      const unique = (values: string[]) => [...new Set(values)].join('\n');
      rows.push({ zoneName:`${zone.code}. ${zone.title}`, elementName:element.name, location:element.location,
        actualIssue: unique(issues), normRequirement: unique(requirements) || 'Применимые требования определяет эксперт по характеру замечания.',
        spReference: unique(references) || 'Пункт СП требует экспертного определения.',
        recommendation: unique(suggestions) || 'Уточнить причину, применимые требования и мероприятия с ответственным экспертом.', photoIds:[...element.photoIds] });
    }
  }
  return rows;
}
