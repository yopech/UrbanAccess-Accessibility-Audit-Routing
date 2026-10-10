import type { NormRule, NormParameter } from './types.js';
// Fixed edition reference. These thresholds do not cover all object-specific exceptions.
export const SP59_SOURCE_URL = 'https://farvater.gumrf.ru/pluginfile.php/333916/mod_resource/content/1/SP-59-13330-2020%20%D0%94%D0%BE%D1%81%D1%82%D1%83%D0%BF%D0%BD%D0%BE%D1%81%D1%82%D1%8C%20%D0%B7%D0%B4%D0%B0%D0%BD%D0%B8%D0%B9%20%D0%B8%20%D1%81%D0%BE%D0%BE%D1%80%D1%83%D0%B6%D0%B5%D0%BD%D0%B8%D0%B9.pdf';
const rule = (parameter: NormParameter, label: string, comparison: 'min' | 'max', limit: number, warnBoundary: number, clauses: readonly string[], applicability: string, action: string): NormRule => Object.freeze({
  id: `z2-${parameter}`, version: '0.1.0', parameter, label, comparison, limit, warnBoundary,
  elementTypes: parameter === 'doorWidth' ? ['door'] as const : parameter === 'thresholdHeight' ? ['door', 'internalDoor'] as const : parameter === 'landingDepth' ? ['platform'] as const : ['ramp'] as const,
  unit: parameter === 'rampSlope' ? '%' : 'cm', mode: 'preliminary', applicability, action,
  source: Object.freeze({ document: 'СП 59.13330.2020', edition: 'Официальное издание 2020; предварительный профиль UrbanAccess 0.1.0', clauses: Object.freeze([...clauses]), url: SP59_SOURCE_URL }),
});
export const Z2_NORM_RULES: readonly NormRule[] = Object.freeze([
  rule('doorWidth', 'Ширина дверного проёма в свету', 'min', 90, 85, ['6.1.5'], 'Доступный дверной проём; эксперт проверяет условия реконструкции и требования эвакуации.', 'Рассмотреть увеличение ширины проёма'),
  rule('thresholdHeight', 'Высота порога', 'max', 1.4, 2, ['6.2.4'], 'Порог, необходимый по условиям объекта; общее требование предусматривает отсутствие порогов. Применимость подтверждает эксперт.', 'Рассмотреть устранение или уменьшение порога'),
  rule('rampSlope', 'Уклон пандуса', 'max', 5, 8, ['6.2.9', '6.1.2', '5.1.14'], 'Базовый профиль уклона; для наружного пандуса нужны длина марша, перепад высот и условия использования.', 'Рассмотреть уменьшение продольного уклона пандуса'),
  rule('rampWidth', 'Ширина пандуса между поручнями', 'min', 90, 85, ['6.2.9'], 'Пандус с односторонним движением; проверка только нижней границы, без оценки верхней границы и встречного движения.', 'Рассмотреть увеличение свободной ширины между поручнями'),
  rule('landingDepth', 'Глубина горизонтальной площадки пандуса', 'min', 150, 120, ['5.1.16', '6.2.9'], 'Горизонтальная площадка пандуса по ходу движения. Общая входная площадка проверяется отдельно по 6.1.4.', 'Рассмотреть увеличение глубины горизонтальной площадки пандуса'),
]);
