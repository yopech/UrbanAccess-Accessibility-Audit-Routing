import type { BasicParameter, Measurement, Unit } from './audit-model.js';
export const PARAMETER_LABELS: Record<BasicParameter, string> = {
  doorWidth: 'Ширина дверного проёма в свету', thresholdHeight: 'Высота порога',
  rampSlope: 'Уклон пандуса', rampWidth: 'Ширина пандуса', handrailHeight: 'Высота поручня', landingDepth: 'Глубина горизонтальной площадки пандуса',
  parkingWidth: 'Ширина машино-места', pathWidth: 'Ширина пешеходного пути', pathSlope: 'Продольный уклон пути', pathCrossSlope: 'Поперечный уклон пути', stepHeight: 'Высота ступени', stepWidth: 'Ширина проступи', corridorWidth: 'Ширина коридора', heightClearance: 'Свободная высота прохода', cabinWidth: 'Ширина кабины', cabinDepth: 'Глубина кабины', roomWidth: 'Ширина санузла', roomDepth: 'Глубина санузла', toiletHeight: 'Высота сиденья унитаза',
};
export function isSlopeParameter(parameter: string): boolean { return ['rampSlope', 'pathSlope', 'pathCrossSlope'].includes(parameter); }
export function parseMeasurement(parameter: BasicParameter, text: string, unit: Unit): Pick<Measurement, 'raw' | 'normalized'> | undefined {
  if (!text.trim()) return undefined;
  if (!/^\d+(?:[.,]\d+)?$/.test(text.trim())) throw new Error('Введите неотрицательное число. Дробную часть отделите точкой или запятой.');
  const value = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(value)) throw new Error('Значение слишком большое.');
  let normalized: Measurement['normalized'];
  if (isSlopeParameter(parameter)) {
    if (unit !== '%' && unit !== 'deg') throw new Error('Для уклона используйте проценты или градусы.');
    if (unit === 'deg' && value >= 90) throw new Error('Угол должен быть меньше 90 градусов.');
    normalized = { value: unit === 'deg' ? Math.tan(value * Math.PI / 180) * 100 : value, unit: '%' };
  } else {
    if (unit !== 'mm' && unit !== 'cm' && unit !== 'm') throw new Error('Для длины используйте мм, см или м.');
    normalized = { value: value * (unit === 'mm' ? 0.1 : unit === 'm' ? 100 : 1), unit: 'cm' };
  }
  if (!Number.isFinite(normalized.value)) throw new Error('Значение слишком большое.');
  return { raw: { text, value, unit }, normalized };
}
