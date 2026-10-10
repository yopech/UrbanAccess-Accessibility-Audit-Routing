import type { ElementType, ZoneCode } from '../audit-model.js';
import type { AuditTemplate, ElementDefinition } from './types.js';
import { Z1_TEMPLATE } from './z1-template.js';
import { Z2_TEMPLATE } from './z2-template.js';
import { Z3_TEMPLATE } from './z3-template.js';
import { Z4_TEMPLATE } from './z4-template.js';
export { Z1_TEMPLATE, Z2_TEMPLATE, Z3_TEMPLATE, Z4_TEMPLATE };
export * from './types.js';
export type SupportedZoneCode = 'Z1' | 'Z2' | 'Z3' | 'Z4';
export const ZONE_TEMPLATES: readonly AuditTemplate[] = [Z1_TEMPLATE, Z2_TEMPLATE, Z3_TEMPLATE, Z4_TEMPLATE];
export const OBJECT_TEMPLATE = { id: 'urbanaccess-object', version: '1.0.0', code: 'OBJECT', title: 'Обследование объекта', elements: ZONE_TEMPLATES.flatMap(zone => zone.elements) } satisfies AuditTemplate;
export const AUDIT_TEMPLATES = [...ZONE_TEMPLATES, OBJECT_TEMPLATE];
export function templateForZone(code: ZoneCode): AuditTemplate {
  const template = ZONE_TEMPLATES.find(zone => zone.code === code);
  if (!template) throw new Error('Зона не входит в поддерживаемый объём обследования.');
  return template;
}
export function definitionFor(type: ElementType): ElementDefinition {
  const definition = OBJECT_TEMPLATE.elements.find(element => element.type === type);
  if (!definition) throw new Error('Тип элемента не входит в шаблоны обследования.');
  return definition;
}
export function measurementParametersFor(type: ElementType) {
  const required = definitionFor(type).parameters;
  return type === 'platform' ? [...required, 'landingDepth' as const] : required;
}
