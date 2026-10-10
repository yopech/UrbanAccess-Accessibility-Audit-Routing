import type { BasicParameter, ElementType } from '../audit-model.js';
import { NORM_RULES } from './registry.js';
import type { NormEvaluationResult, NormMeasurement, NormRule } from './types.js';
const clean = (value: number) => Number(value.toPrecision(14));
const format = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 14, useGrouping: false });
export function evaluateMeasurementNorm(parameter: BasicParameter, measurement: NormMeasurement | undefined, rules: readonly NormRule[] = NORM_RULES, elementType?: ElementType): NormEvaluationResult | undefined {
  const rule = rules.find((candidate) => candidate.parameter === parameter && (!elementType || !candidate.elementTypes || candidate.elementTypes.includes(elementType)));
  if (!measurement || !rule) return undefined;
  if (!Number.isFinite(measurement.value) || measurement.value < 0) throw new Error('Нормативная проверка требует конечного неотрицательного замера.');
  if (!Number.isFinite(rule.limit) || !Number.isFinite(rule.warnBoundary) || rule.limit < 0 || rule.warnBoundary < 0 || (rule.comparison !== 'max' ? rule.warnBoundary > rule.limit : rule.warnBoundary < rule.limit)) throw new Error('Некорректные границы нормативного профиля.');
  if (rule.comparison === 'range' && (!Number.isFinite(rule.upperLimit) || !Number.isFinite(rule.upperWarnBoundary) || rule.upperLimit! < rule.limit || rule.upperWarnBoundary! < rule.upperLimit!)) throw new Error('Некорректный диапазон нормативного профиля.');
  let value: number;
  if (rule.unit === '%') {
    if (measurement.unit !== '%' && measurement.unit !== 'deg') throw new Error('Для уклона используйте проценты или градусы.');
    if (measurement.unit === 'deg' && measurement.value >= 90) throw new Error('Угол должен быть меньше 90 градусов.');
    value = measurement.unit === 'deg' ? Math.tan(measurement.value * Math.PI / 180) * 100 : measurement.value;
  } else {
    if (measurement.unit !== 'mm' && measurement.unit !== 'cm' && measurement.unit !== 'm') throw new Error('Для длины используйте мм, см или м.');
    value = measurement.value * (measurement.unit === 'mm' ? .1 : measurement.unit === 'm' ? 100 : 1);
  }
  if (!Number.isFinite(value)) throw new Error('Приведённый замер слишком большой.');
  value = clean(value);
  const delta = clean(Math.max(0, rule.comparison === 'range' ? Math.max(rule.limit - value, value - rule.upperLimit!) : rule.comparison === 'min' ? rule.limit - value : value - rule.limit));
  const status = delta === 0 ? 'ok' : (rule.comparison === 'range' ? value >= rule.warnBoundary && value <= rule.upperWarnBoundary! : rule.comparison === 'min' ? value >= rule.warnBoundary : value <= rule.warnBoundary) ? 'warn' : 'fail';
  const unit = rule.unit === 'cm' ? 'см' : '%'; const deltaUnit = rule.unit === 'cm' ? 'см' : 'п.п.';
  const reference = `${rule.source.document}, п. ${rule.source.clauses.join(', ')}`;
  const target = rule.comparison === 'range' ? `от ${format(rule.limit)} до ${format(rule.upperLimit!)} ${unit}` : `${rule.comparison === 'min' ? 'не менее' : 'не более'} ${format(rule.limit)} ${unit}`;
  const message = delta === 0 ? '' : `Предварительный профиль: ${(rule.comparison === 'min' || (rule.comparison === 'range' && value < rule.limit)) ? 'меньше' : 'больше'} порога на ${format(delta)} ${deltaUnit}. Ориентир: ${target}. ${reference}. ${rule.applicability}`;
  const recommendation = delta === 0 ? '' : `Предварительная рекомендация по замеру «${rule.label}»: ${format(value)} ${unit}, отклонение от профиля ${format(delta)} ${deltaUnit}. ${rule.action} до значения ${target}. Основание для экспертной проверки: ${reference}. ${rule.applicability} Применимость нормы и способ адаптации необходимо подтвердить ответственному эксперту.`;
  return { status, ruleId: rule.id, ruleVersion: rule.version, parameter: rule.parameter, value, limit: rule.limit, delta, unit: rule.unit, source: rule.source, mode: 'preliminary', message, recommendation };
}
