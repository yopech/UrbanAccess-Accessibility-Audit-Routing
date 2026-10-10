import type { BasicParameter, ElementType, Presence } from '../audit-model.js';
export type CheckParameter = 'parkingMarking' | 'tactileGroundIndicators' | 'grabBarsFixed' | 'grabBarsFolding' | 'alarmButton' | 'alarmVisualSignal' | 'alarmAudibleSignal';
export interface ElementDefinition { type: ElementType; name: string; required: boolean; parameters: readonly BasicParameter[]; checks?: readonly CheckParameter[]; }
export interface AuditTemplate { id: string; version: string; code: string; title: string; elements: readonly ElementDefinition[]; }
export type ElementChecks = Partial<Record<CheckParameter, Presence>>;
export const CHECK_LABELS: Record<CheckParameter, string> = { parkingMarking: 'Разметка и знак места для МГН', tactileGroundIndicators: 'Тактильные полосы', grabBarsFixed: 'Фиксированный опорный поручень', grabBarsFolding: 'Откидной опорный поручень', alarmButton: 'Кнопка вызова помощи', alarmVisualSignal: 'Световое оповещение вызова', alarmAudibleSignal: 'Звуковое оповещение вызова' };
