import type { AuditTemplate } from './types.js';
export const Z3_TEMPLATE = {
  "id": "urbanaccess-z3",
  "version": "1.0.0",
  "code": "Z3",
  "title": "Пути движения внутри здания",
  "elements": [
    {
      "type": "corridor",
      "name": "Внутренний коридор",
      "required": true,
      "parameters": [
        "corridorWidth",
        "heightClearance"
      ]
    },
    {
      "type": "internalDoor",
      "name": "Межкомнатная дверь",
      "required": true,
      "parameters": [
        "doorWidth",
        "thresholdHeight"
      ]
    },
    {
      "type": "elevator",
      "name": "Лифт или подъёмник",
      "required": true,
      "parameters": [
        "cabinWidth",
        "cabinDepth",
        "doorWidth"
      ]
    }
  ]
} as const satisfies AuditTemplate;
