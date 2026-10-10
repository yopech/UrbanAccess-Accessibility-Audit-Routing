import type { ElementDefinition } from './types.js';
export const Z2_TEMPLATE = {
  id: 'urbanaccess-z2', version: '1.0.0', code: 'Z2', title: 'Входная группа',
  elements: [
    { type: 'door', name: 'Входная дверь', required: true, parameters: ['doorWidth', 'thresholdHeight'] },
    { type: 'ramp', name: 'Пандус', required: true, parameters: ['rampSlope', 'rampWidth'] },
    { type: 'handrail', name: 'Поручни', required: true, parameters: ['handrailHeight'] },
    { type: 'platform', name: 'Входная площадка', required: true, parameters: [] },
    { type: 'call_button', name: 'Кнопка вызова', required: true, parameters: [] },
  ] satisfies ElementDefinition[],
} as const;
