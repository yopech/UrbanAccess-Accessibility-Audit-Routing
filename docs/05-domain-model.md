# Domain Model

Версия: 14 сентября 2026. Согласована с [требованиями](03-requirements.md), [словарём](04-domain-glossary.md) и [ERD](06-erd.md). Политика давности использует рабочий вариант из [ADR-001](adr/ADR-001-freshness.md); числовые интервалы ещё предлагаются для проверки в поле.

## 1. Основной поток

Пользователь создаёт Observation с точкой, типом, finding, контекстом и фото. Система сопоставляет его с Barrier. Подтверждённое локальное влияние связывает Barrier и Pedestrian Edge через **Accessibility Impact**. Accessibility Assessment рассчитывает доступность ребра для Mobility Profile, после чего маршрутизатор строит Route.

В документации используется только Accessibility Impact; имя класса — `AccessibilityImpact`, таблица — `accessibility_impacts`.

## 2. Объекты предметной области

| Объект | Назначение | Основные данные |
|---|---|---|
| User | Автор наблюдения, модератор или администратор | id, username, role, created_at |
| Observation | Фиксация конкретного места и времени; состояние обработки отделено от исходных фактов | user_id, barrier_id?, target_barrier_id?, location, position_source, device_location?, device_accuracy_m?, finding, barrier_type, restriction_type?, context_type, place_name?, level_ref?, location_description?, observed_at, created_at, status, moderation_required, supersedes_observation_id? |
| Media | Фотография наблюдения | observation_id, storage_key, mime_type, file_size, upload_status, created_at |
| Measurement | Необязательное измерение или оценка | observation_id, recorded_by, parameter_type, value, unit, source, confidence, created_at |
| Barrier | Идентифицированное ограничение, объединяющее наблюдения | barrier_type, context_type, permanence, status, recheck_reasons, recheck_interval_days, first_observed_at, last_observed_at, last_confirmed_at?, last_verified_at? |
| Verification | Решение модератора с основанием и областью действия | observation_id, moderator_id, target_barrier_id?, decision, scope?, comment, created_at |
| Accessibility Impact | Текущее влияние одного Barrier на один участок | barrier_id, pedestrian_edge_id, impact_type, height_cm?, available_width_cm?, slope_percent?, surface_condition?, penalty_factor?, is_active, last_confirmed_at?, last_verified_at?, recheck_required, recheck_reasons |
| Pedestrian Edge | Физический сегмент импортированной пешеходной сети | id, osm_way_id?, source_node_id, target_node_id, geometry, length_m, forward_allowed, reverse_allowed, routing_attributes, graph_version, context_type, level_ref? |
| Mobility Profile | Независимый набор ограничений пользователя маршрута | code, stairs_allowed, max_curb_height_cm, min_width_cm, max_slope_percent, surface_rules, rules_version |

Знак `?` означает nullable. Полная схема полей и FK приведена в ERD.

Device Location — технические поля Observation, а не отдельная бизнес-сущность. GPS и итоговая пользовательская точка независимы. При отсутствии GPS можно выбрать точку вручную. Метры точности GPS не являются точностью вручную поставленной булавки.

Barrier не имеет обязательной геометрии физического объекта. Его известные положения представлены Observation, а известный охват — Accessibility Impact. Поиск кандидата использует принятые наблюдения, а не вымышленное поле Barrier.geometry.

## 3. Технические сущности для сохранения принятых правил

- **Impact Evidence** связывает конкретное Observation с конкретным Accessibility Impact. Хранит цель PRESENT_CONFIRMATION / ABSENCE_CONFIRMATION, источник решения и признак отзыва. Обеспечивает происхождение данных и локальность подтверждения.
- **Observation Processing Event** хранит результат автоматической обработки: версию правил, причины, выбранный Barrier, разрешённые последствия и ключ идемпотентности. Автоматическое действие не записывается как решение человека.
- **Audit Event** хранит неизменяемую историю before/after, автора, причину и источник события для Observation, Barrier или Accessibility Impact. Исправление не удаляет прошлые события.
- **Pedestrian Node** — технический узел сети, необходимый для FK начальной и конечной точек ребра.

Эти таблицы поддерживают аудит, маршрутизацию и повторную обработку, а не вводят новые пользовательские сценарии.

## 4. Справочники и производные результаты

- Barrier Type: CURB, STAIRS, FENCE, GATE, NARROW_SIDEWALK, BLOCKED_SIDEWALK, ROUGH_SURFACE, OTHER.
- Finding: PRESENT / ABSENT. ABSENT относится к ранее известному ограничению; до проверки цель может храниться в target_barrier_id, а принятая связь barrier_id оставаться NULL.
- Restriction Type: BLOCKED / DIFFICULT / RESTRICTED для PRESENT; NULL для ABSENT. Это описание пользователя, которое не задаёт одинаковую доступность всем профилям.
- Impact Type: BLOCKS / NARROWS / PENALIZES / STAIRS / SURFACE_DEGRADATION. BLOCKS — установленная полная блокировка, STAIRS — наличие лестницы с профильной оценкой.
- Measurement Source: VISUAL_ESTIMATE / MANUAL_MEASUREMENT / MODERATOR_MEASUREMENT; Confidence: LOW / MEDIUM / HIGH.
- Permanence: PERMANENT / TEMPORARY / UNKNOWN. Тип препятствия предлагает значение, модератор может уточнить; FENCE не обязательно временный.
- Context Type: STREET / TRANSIT_STOP / RAILWAY_STATION / METRO_STATION / PLATFORM / UNDERGROUND_PASSAGE.
- Mobility Profile: STANDARD_PEDESTRIAN / WHEELCHAIR / STROLLER.

Accessibility Assessment имеет ALLOWED / PENALIZED / BLOCKED и вычисляется из атрибутов ребра, активных влияний и профиля. Route содержит origin, destination, profile, geometry, distance, duration, considered_barriers, excluded_edges и предупреждения о давности. Отдельные таблицы Route и Accessibility Assessment в MVP не нужны.

## 5. Кардинальности

| Связь | Кардинальность и обязательность |
|---|---|
| User → Observation | 1 → 0..N; у наблюдения ровно один автор |
| Barrier → Observation | 1 → 0..N физически; у Observation 0..1 принятый Barrier; при создании Barrier требуется минимум одно одобренное PRESENT в той же транзакции |
| Observation → Media | 1 → 0..N при загрузке; минимум одно READY фото перед обработкой |
| Observation → Measurement | 1 → 0..N |
| Observation → Verification | 1 → 0..N; каждое решение имеет одного модератора |
| Observation → Observation Processing Event | 1 → 0..N |
| Barrier → Accessibility Impact | 1 → 0..N; подтверждённый объект без найденного ребра допустим |
| Pedestrian Edge → Accessibility Impact | 1 → 0..N |
| Observation ↔ Accessibility Impact | M:N через Impact Evidence; связь с Barrier сама по себе свидетельством влияния не является |
| Pedestrian Node → Pedestrian Edge | 1 → 0..N отдельно по начальному и конечному узлу |

## 6. Автоматическая обработка

| Результат | Когда | Последствия |
|---|---|---|
| LINK_ONLY | Barrier однозначен, но время, пространственная привязка или основание влияния недостаточны; либо есть открытый спор | Установить связь; поставить moderation_required; даты подтверждения и граф не менять |
| CONFIRM | Свежее совместимое PRESENT на существующем активном локальном влиянии | Установить связь, добавить PRESENT Evidence и обновить локальную и сводную даты |
| CONFIRM_AND_EXTEND | Свежее PRESENT, новое однозначное уличное ребро и известное правило влияния | Установить связь, создать один Accessibility Impact, Evidence и обновить даты |

Ноль или несколько кандидатов → PENDING_MODERATION. Первое наблюдение нового Barrier, любое ABSENT, RESOLVED/ARCHIVED, повторное включение неактивного влияния и изменение его подтверждённых параметров требуют модератора.

Начальный радиус кандидатов 5 м измеряется от известных принятых точек. Соседство рёбер не означает автоматического объединения на произвольном расстоянии. В MVP не требуется восстановление всей линии ограждения по одной точке.

CONFIRM и CONFIRM_AND_EXTEND допускаются только при отсутствии открытых споров, пригодном observed_at и достаточных структурированных данных. Фото проверено технически, но его содержание не считается проверенным человеком. AUTO_MATCH является явно обозначенным автоматическим принятием по правилам прототипа.

## 7. Статусы и время

### Observation

| Переход | Причина |
|---|---|
| NEW → LINKED | Уверенное автоматическое связывание; последствия записаны отдельно |
| NEW → PENDING_MODERATION | Нет уверенного результата или нужен человек |
| PENDING_MODERATION → APPROVED | Модератор одобрил создание нового Barrier |
| PENDING_MODERATION → LINKED | Модератор связал с существующим Barrier, подтвердил локальное отсутствие либо возобновление |
| PENDING_MODERATION → REJECTED / NEEDS_CLARIFICATION | Решение модератора с причиной |
| LINKED / APPROVED → PENDING_MODERATION | Повторный разбор; действующие влияния сохраняются до решения |
| NEEDS_CLARIFICATION → PENDING_MODERATION | Получены новые пояснения; исправленные факты оформлены новым Observation |

Позднее отклонение проходит через повторный разбор и отзыв последствий. REJECTED не редактируется в достоверное наблюдение: создаётся исправленная запись. LINKED может иметь moderation_required=true после LINK_ONLY. Статус не подменяет журнал подтверждающих действий.

### Barrier

| Переход | Основание | Влияние на граф |
|---|---|---|
| Создание → VERIFIED | Одобрено первое PRESENT модератором | Влияние появляется только после отдельного пространственного решения |
| VERIFIED → RECHECK_REQUIRED | Просрочка хотя бы одного активного влияния, ожидающее ABSENT либо открытый спор | Существующие активные влияния сохраняются |
| RECHECK_REQUIRED → VERIFIED | Все активные влияния свежие, открытых вопросов нет | Сохраняется; изменяются данные актуальности |
| VERIFIED / RECHECK_REQUIRED → RESOLVED | Модератор подтвердил отсутствие всего известного ограничения | Все активные влияния деактивируются атомарно |
| RESOLVED → ARCHIVED | Решение модератора об архивировании | Влияния уже неактивны |
| RESOLVED / ARCHIVED → VERIFIED или RECHECK_REQUIRED | Модератор установил, что препятствие вновь существует | Включаются только заново подтверждённые локальные влияния |

Частичное устранение не переводит весь Barrier в RESOLVED. Отзыв ошибочного единственного основания приводит к RECHECK_REQUIRED/INVALID_EVIDENCE, а не к утверждению, что объект физически исчез.

`last_confirmed_at` — максимум observed_at действующих принятых PRESENT для соответствующего места. `last_verified_at` — время последнего решения человека. Старое наблюдение, загруженное сегодня, не становится сегодняшним подтверждением. Для автоматических последствий оно также должно быть в пределах интервала проверки и не предшествовать последнему принятому изменению этого места.

Barrier.last_confirmed_at — сводная дата, а не свидетельство свежести всех влияний. Для Barrier без влияний проверяется его собственная дата. Для остальных повторная проверка нужна при любой просроченной активной локальной записи или открытом вопросе.

## 8. Проверка и исправление

Verification: APPROVE_NEW_BARRIER / LINK_TO_EXISTING_BARRIER / CONFIRM_ABSENCE / REACTIVATE_BARRIER / REJECT / NEEDS_CLARIFICATION. Для отсутствия указывается LOCAL или WHOLE_BARRIER. Модератор проверяет фото, текст, совпадение объекта и временные противоречия.

Если AUTO_MATCH был ошибочным, модератор отзывает Evidence, пересчитывает локальные и сводные даты, отменяет только необоснованные влияния и сохраняет историю. Другие независимые основания остаются. Более поздние зависимые решения пересматриваются; система не перезаписывает состояние старым snapshot без проверки.

Исходные location, finding, фотографии и измерения не меняются при изменении Barrier. Уточнение создаёт новую версию Observation. Добавленное модератором измерение имеет своего автора, время и источник.

## 9. Граница уличного графа

Автоматическое расширение разрешено только STREET. Остановка или отдельный подземный переход могут быть вручную связаны с существующим подходящим ребром после проверки контекста и уровня. Элементы метро, ЖД-станций и платформ собираются без уличного Accessibility Impact. Indoor/transit routing в MVP не реализуется.

## 10. Проверка модели перед реализацией

ERD фиксирует PK/FK, nullable, уникальность текущего влияния и источники изменений. Числовые допуски измерений, правила UNKNOWN-значений профилей и веса маршрутизации остаются задачами калибровки; их нельзя молча считать нормативами. Пока конкретное правило не определено, соответствующее автоматическое расширение не выполняется.
