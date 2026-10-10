import type { NormParameter } from '../norms/types.js';
export interface MeasurementPattern { readonly parameter: NormParameter; readonly elementType: string; readonly triggers: readonly string[]; readonly defaultUnit: 'cm' | '%'; }
export const MEASUREMENT_PATTERNS: readonly MeasurementPattern[] = [
  { parameter:'doorWidth',elementType:'door',triggers:['ширина проема','ширина полотна','ширина','проем','дверь'],defaultUnit:'cm' },
  { parameter:'thresholdHeight',elementType:'door',triggers:['высота порога','порог','перепад'],defaultUnit:'cm' },
  { parameter:'rampSlope',elementType:'ramp',triggers:['процент уклона','уклон','градус','градуса','градусов'],defaultUnit:'%' },
  { parameter:'rampWidth',elementType:'ramp',triggers:['ширина пандуса','ширина марша','проход','ширина'],defaultUnit:'cm' },
  { parameter:'landingDepth',elementType:'platform',triggers:['глубина площадки','глубина','площадка'],defaultUnit:'cm' },
];
export function speechUnit(word: string | undefined): 'mm' | 'cm' | 'm' | '%' | 'deg' | undefined {
  if (!word) return undefined;
  if (/^(см|сантиметр(?:а|ов|ы)?)$/.test(word)) return 'cm';
  if (/^(мм|миллиметр(?:а|ов|ы)?)$/.test(word)) return 'mm';
  if (/^(м|метр(?:а|ов|ы)?)$/.test(word)) return 'm';
  if (/^(%|процент(?:а|ов|ы)?)$/.test(word)) return '%';
  if (/^(°|градус(?:а|ов|ы)?)$/.test(word)) return 'deg';
  return undefined;
}
