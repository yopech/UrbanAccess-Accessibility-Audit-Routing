import type { NormRule, NormParameter } from './types.js';
import type { ElementType } from '../audit-model.js';
import { isSlopeParameter } from '../measurements.js';
import { PARAMETER_LABELS } from '../measurements.js';
import { SP59_SOURCE_URL } from './rules-z2.js';
export function preliminaryRule(zone: string, parameter: NormParameter, elementType: ElementType, comparison: 'min' | 'max' | 'range', limit: number, warnBoundary: number, clauses: readonly string[], applicability: string, action: string, range?: { upperLimit: number; upperWarnBoundary: number }): NormRule {
  return Object.freeze({ id: `${zone}-${elementType}-${parameter}`, version: '0.1.0', parameter, label: PARAMETER_LABELS[parameter], elementTypes: Object.freeze([elementType]), comparison, limit, warnBoundary, ...range,
    unit: isSlopeParameter(parameter) ? '%' : 'cm', mode: 'preliminary', applicability, action,
    source: Object.freeze({ document: 'СП 59.13330.2020', clauses: Object.freeze([...clauses]), url: SP59_SOURCE_URL, edition: 'Официальное издание 2020; предварительный профиль UrbanAccess 0.1.0' }) });
}
