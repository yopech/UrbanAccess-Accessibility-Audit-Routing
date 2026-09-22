# ERD текущего пилота

Это логическая схема локального хранилища, не схема SQL/PostGIS. Вложенные массивы показаны отдельными сущностями для объяснения связей.

```mermaid
erDiagram
  AUDIT_PROJECT ||--|{ ROUTE_PART : contains
  AUDIT_PROJECT o|--o{ OBSERVATION : groups
  ROUTE_PART o|--o{ OBSERVATION : locates
  OBSERVATION ||--o{ PHOTO : has
  OBSERVATION ||--o{ REVIEW_DECISION : keeps
  OBSERVATION o|--o{ OBSERVATION : previous_observation
  AUDIT_PROJECT ||--o{ PAIR_RESOLUTION : records
  AUDIT_PROJECT ||--o{ CONCLUSION_HISTORY : records
  AUDIT_PROJECT {
    string id PK
    string title
    string partnerName
    string coordinator
    string originDescription
    string destinationDescription
    string targetRequirements
    string objective
    string status
    boolean isDemo
    boolean coverageConfirmed
    string conclusion
    string conclusionFingerprint
    date nextCheckAt
  }
  ROUTE_PART {
    string id PK
    string label
    string coverage
    datetime checkedAt
    string checkedBy
    string coverageNote
  }
  OBSERVATION {
    string id PK
    string auditProjectId FK "nullable for legacy"
    string routePartId FK "nullable for draft or legacy"
    string previousObservationId FK "nullable"
    string supersededById FK "nullable"
    string conflictOfId FK "nullable"
    string status
    string reviewStatus
    string reporterAlias
    string experienceSource
    string finding
    string restrictionType
    string alternativeAccess
    string alternativeDescription
    number latitude
    number longitude
    datetime observedAt
    boolean isDemo
  }
  PHOTO {
    string id PK
    string observationId FK
    blob blob
    string name
    string type
  }
  REVIEW_DECISION {
    string id PK
    string status
    string reviewer
    string comment
    datetime at
  }
  PAIR_RESOLUTION {
    string key
    string signature
    string reviewer
    string note
    datetime at
  }
  CONCLUSION_HISTORY {
    string conclusion
    string reviewer
    string note
    datetime at
  }
```

IndexedDB `urban-accessibility-field-v1`, версия 2. Название базы оставлено прежним для миграции. Физические object stores: projects, observations, photos. Route Part, Pair Resolution и Conclusion History вложены в проект, Review Decision — в наблюдение.

В базе нет FK-ограничений: принадлежность проверяют функции приложения и импорт. Импорт сначала строит полный проверенный план, затем записывает его одной транзакцией. Фото принадлежат одному наблюдению; ID фотографии включает ID наблюдения, чтобы участники не перезаписывали чужие фото.

История готовых записей не удаляется через интерфейс. Можно удалить черновик вместе с его фото. Версия базы 1 обновляется добавлением projects, без очистки старых stores; обратное открытие старым приложением не поддерживается. Для восстановления служат JSON-копии.

[Прежняя SQL-модель Barrier / Accessibility Impact / графа](archive/06-erd.md) — архив, не реализованная БД приложения.
