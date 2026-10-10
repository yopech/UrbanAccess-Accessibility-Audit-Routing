import type { AuditTemplate } from './types.js';
export const Z1_TEMPLATE = {
  "id": "urbanaccess-z1",
  "version": "1.0.0",
  "code": "Z1",
  "title": "Прилегающая территория",
  "elements": [
    {
      "type": "accessibleParking",
      "name": "Машино-место для МГН",
      "required": true,
      "parameters": [
        "parkingWidth"
      ],
      "checks": [
        "parkingMarking"
      ]
    },
    {
      "type": "pedestrianPath",
      "name": "Пешеходный путь",
      "required": true,
      "parameters": [
        "pathWidth",
        "pathSlope",
        "pathCrossSlope"
      ]
    },
    {
      "type": "outdoorStairs",
      "name": "Наружная лестница",
      "required": true,
      "parameters": [
        "stepHeight",
        "stepWidth"
      ],
      "checks": [
        "tactileGroundIndicators"
      ]
    }
  ]
} as const satisfies AuditTemplate;
