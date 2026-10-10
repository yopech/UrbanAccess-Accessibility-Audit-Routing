import type { AuditTemplate } from './types.js';
export const Z4_TEMPLATE = {
  "id": "urbanaccess-z4",
  "version": "1.0.0",
  "code": "Z4",
  "title": "Санитарно-гигиенические помещения",
  "elements": [
    {
      "type": "accessibleToilet",
      "name": "Универсальная кабина санузла",
      "required": true,
      "parameters": [
        "roomWidth",
        "roomDepth",
        "toiletHeight"
      ],
      "checks": [
        "grabBarsFixed",
        "grabBarsFolding",
        "alarmButton",
        "alarmVisualSignal",
        "alarmAudibleSignal"
      ]
    }
  ]
} as const satisfies AuditTemplate;
