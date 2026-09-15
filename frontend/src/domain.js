export const BARRIER_LABELS = {
  CURB: "Бордюр",
  STAIRS: "Лестница",
  FENCE: "Ограждение",
  GATE: "Ворота или калитка",
  NARROW_SIDEWALK: "Узкий тротуар",
  BLOCKED_SIDEWALK: "Перекрытый тротуар",
  ROUGH_SURFACE: "Плохое покрытие",
  OTHER: "Другое",
};

export const CONTEXT_LABELS = {
  STREET: "Улица",
  TRANSIT_STOP: "Остановка",
  UNDERGROUND_PASSAGE: "Подземный переход",
  METRO_STATION: "Станция метро",
  RAILWAY_STATION: "Железнодорожная станция",
  PLATFORM: "Платформа",
};

export const RESTRICTION_LABELS = {
  BLOCKED: "Прохода нет",
  DIFFICULT: "Проход затруднён",
  RESTRICTED: "Подходит не всем",
};

export const FINDING_LABELS = {
  PRESENT: "Присутствует",
  ABSENT: "Уже отсутствует",
};

export function toLocalDateTimeInput(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateObservation(observation, photoCount, ready, now = new Date()) {
  const errors = {};

  if (!observation.observedAt || Number.isNaN(new Date(observation.observedAt).getTime())) {
    errors.observedAt = "Укажите время наблюдения.";
  } else if (new Date(observation.observedAt).getTime() > now.getTime() + 5 * 60_000) {
    errors.observedAt = "Время наблюдения не может быть в будущем.";
  }

  if (ready) {
    if (!Number.isFinite(observation.latitude) || observation.latitude < -90 || observation.latitude > 90 ||
        !Number.isFinite(observation.longitude) || observation.longitude < -180 || observation.longitude > 180) {
      errors.location = "Получите GPS или укажите корректные координаты.";
    }
    if (!BARRIER_LABELS[observation.barrierType]) {
      errors.barrierType = "Выберите тип препятствия.";
    }
    if (!CONTEXT_LABELS[observation.contextType]) {
      errors.contextType = "Выберите контекст.";
    }
    if (!FINDING_LABELS[observation.finding]) {
      errors.finding = "Укажите состояние препятствия.";
    }
    if (observation.finding === "PRESENT" && !RESTRICTION_LABELS[observation.restrictionType]) {
      errors.restrictionType = "Укажите, как препятствие влияет на проход.";
    }
    if (photoCount < 1) {
      errors.photos = "Добавьте хотя бы одну фотографию.";
    }
  }

  for (const [key, value] of Object.entries(observation.measurements || {})) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      errors[key] = "Измерение должно быть неотрицательным числом.";
    }
  }

  return errors;
}

export function observationToGeoJSONFeature(observation) {
  if (!Number.isFinite(observation.latitude) || !Number.isFinite(observation.longitude)) return null;
  const properties = { ...observation };
  delete properties.latitude;
  delete properties.longitude;
  delete properties.deviceLatitude;
  delete properties.deviceLongitude;

  return {
    type: "Feature",
    id: observation.id,
    geometry: {
      type: "Point",
      coordinates: [observation.longitude, observation.latitude],
    },
    properties,
  };
}

export function observationsToCSV(observations) {
  const columns = [
    "id", "status", "observedAt", "latitude", "longitude", "positionSource", "deviceAccuracyM",
    "contextType", "barrierType", "finding", "restrictionType", "placeName", "levelRef",
    "locationDescription", "heightCm", "availableWidthCm", "slopePercent", "comment", "photoCount",
  ];
  const rows = observations.map((item) => ({
    ...item,
    heightCm: item.measurements?.heightCm ?? "",
    availableWidthCm: item.measurements?.availableWidthCm ?? "",
    slopePercent: item.measurements?.slopePercent ?? "",
  }));
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n");
}

export function formatObservationDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Время не указано";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

export function downloadName(prefix, extension, date = new Date()) {
  const stamp = date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return `${prefix}-${stamp}.${extension}`;
}
