import type { Unit, BasicParameter, ElementType } from '../audit-model.js';
export type NormStatus = 'ok' | 'warn' | 'fail';
export type NormParameter = Exclude<BasicParameter, 'handrailHeight'>;
export type NormUnit = 'cm' | '%';
export interface NormMeasurement { readonly value: number; readonly unit: Unit; }
export interface NormSource {
  readonly document: 'СП 59.13330.2020'; readonly clauses: readonly string[];
  readonly url: string; readonly edition: string;
}
/** Warn is a product triage band, never a normative tolerance. */
export interface NormRule {
  readonly id: string; readonly version: string; readonly parameter: NormParameter;
  readonly label: string; readonly comparison: 'min' | 'max' | 'range';
  readonly elementTypes?: readonly ElementType[]; readonly upperLimit?: number; readonly upperWarnBoundary?: number; readonly unit: NormUnit;
  readonly limit: number; readonly warnBoundary: number;
  readonly source: NormSource; readonly applicability: string;
  readonly action: string; readonly mode: 'preliminary';
}
export interface NormEvaluationResult {
  readonly status: NormStatus; readonly ruleId: string; readonly ruleVersion: string;
  readonly parameter: NormParameter; readonly value: number; readonly limit: number;
  /** Nonnegative deviation outside the accepted profile; zero for ok. Slope uses percentage points. */
  readonly delta: number; readonly unit: NormUnit; readonly source: NormSource;
  readonly mode: 'preliminary'; readonly message: string; readonly recommendation: string;
}
