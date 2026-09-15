# UrbanAccess — Accessibility Audit & Routing

Документация MVP для сбора наблюдений о городской доступности, их модерации и применения к пешеходному графу.

## Зафиксированные решения

- Единая сущность влияния на участок называется **Accessibility Impact** (`AccessibilityImpact`, `accessibility_impacts`).
- Автоматически сопоставленное PRESENT Observation может выполнить `LINK_ONLY`, `CONFIRM` или `CONFIRM_AND_EXTEND`. Последний вариант ограничен одним однозначным локальным уличным ребром.
- Содержание фотографии, свободного текста и смысловые противоречия проверяет модератор.
- `RECHECK_REQUIRED` не отключает влияние на граф. Устранение подтверждает модератор по принятому ABSENT Observation; для протяжённого Barrier различаются `LOCAL` и `WHOLE_BARRIER`.
- Дата свежести хранится для каждого Accessibility Impact. Подтверждение одного участка не обновляет остальные.

## Документы

1. [Постановка проблемы](docs/01-problem-statement.md)
2. [Границы MVP](docs/02-scope.md)
3. [Требования](docs/03-requirements.md)
4. [Словарь предметной области](docs/04-domain-glossary.md)
5. [Предметная модель](docs/05-domain-model.md)
6. [ERD](docs/06-erd.md)
7. [Проверка согласованности](docs/07-consistency-review.md)
8. [ADR-001: свежесть и повторная проверка](docs/adr/ADR-001-freshness.md)

Числовые интервалы повторной проверки в ADR-001 остаются гипотезой для полевого теста. Следующий технический этап — миграции и сквозной сценарий Observation → модерация → Barrier → Accessibility Impact.
