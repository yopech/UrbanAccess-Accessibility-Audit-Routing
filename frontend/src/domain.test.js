import { observationToGeoJSONFeature, observationsToCSV, validateObservation } from "./domain.js";
import { locationQuality, normalizeGeolocationPosition, pickMoreAccurateSample } from "./location.js";

const tests = [];
const test = (name, run) => tests.push({ name, run });
const assert = (condition, message = "Условие не выполнено") => { if (!condition) throw new Error(message); };

function completeObservation(overrides = {}) {
  return {
    id: "obs-1",
    observedAt: "2026-09-15T09:00:00.000Z",
    latitude: 55.7558,
    longitude: 37.6176,
    contextType: "STREET",
    barrierType: "CURB",
    finding: "PRESENT",
    restrictionType: "RESTRICTED",
    measurements: { heightCm: 12, availableWidthCm: null, slopePercent: null },
    ...overrides,
  };
}

test("готовая PRESENT-запись проходит проверку", () => {
  const errors = validateObservation(completeObservation(), 1, true, new Date("2026-09-15T12:00:00.000Z"));
  assert(Object.keys(errors).length === 0, JSON.stringify(errors));
});

test("готовая запись требует координаты и фотографию", () => {
  const errors = validateObservation(completeObservation({ latitude: null, longitude: null }), 0, true, new Date("2026-09-15T12:00:00.000Z"));
  assert(Boolean(errors.location));
  assert(Boolean(errors.photos));
});

test("PRESENT требует характер ограничения", () => {
  const errors = validateObservation(completeObservation({ restrictionType: null }), 1, true, new Date("2026-09-15T12:00:00.000Z"));
  assert(Boolean(errors.restrictionType));
});

test("ABSENT не требует характер ограничения", () => {
  const errors = validateObservation(completeObservation({ finding: "ABSENT", restrictionType: null }), 1, true, new Date("2026-09-15T12:00:00.000Z"));
  assert(!errors.restrictionType);
});

test("черновик можно сохранить без фото и координат", () => {
  const errors = validateObservation(completeObservation({ latitude: null, longitude: null, barrierType: "" }), 0, false, new Date("2026-09-15T12:00:00.000Z"));
  assert(Object.keys(errors).length === 0, JSON.stringify(errors));
});

test("время из будущего отклоняется", () => {
  const errors = validateObservation(completeObservation({ observedAt: "2026-09-16T09:00:00.000Z" }), 1, true, new Date("2026-09-15T12:00:00.000Z"));
  assert(Boolean(errors.observedAt));
});

test("GeoJSON использует порядок долгота, широта", () => {
  const feature = observationToGeoJSONFeature(completeObservation());
  assert(feature.geometry.coordinates[0] === 37.6176);
  assert(feature.geometry.coordinates[1] === 55.7558);
  assert(feature.id === "obs-1");
});

test("CSV экранирует кавычки и переносит измерения в столбцы", () => {
  const csv = observationsToCSV([completeObservation({ comment: 'Пандус "слева"' })]);
  assert(csv.includes('"Пандус ""слева"""'));
  assert(csv.includes('"12"'));
});

test("устаревшая геопозиция не принимается", () => {
  const position = { coords: { latitude: 55.75, longitude: 37.61, accuracy: 15 }, timestamp: 1_000 };
  assert(normalizeGeolocationPosition(position, 32_000) === null);
});

test("из нескольких геопозиций выбирается самая точная", () => {
  const rough = { latitude: 55.75, longitude: 37.61, accuracy: 900, timestamp: 1_000 };
  const precise = { latitude: 55.76, longitude: 37.62, accuracy: 12, timestamp: 2_000 };
  assert(pickMoreAccurateSample(rough, precise) === precise);
  assert(pickMoreAccurateSample(precise, rough) === precise);
});

test("неточная геопозиция не считается пригодной", () => {
  assert(locationQuality(12) === "PRECISE");
  assert(locationQuality(70) === "ACCEPTABLE");
  assert(locationQuality(500) === "POOR");
});

const results = document.getElementById("results");
let passed = 0;
for (const item of tests) {
  const row = document.createElement("li");
  try {
    item.run();
    passed += 1;
    row.className = "pass";
    row.textContent = `✓ ${item.name}`;
  } catch (error) {
    row.className = "fail";
    row.textContent = `✗ ${item.name}: ${error.message}`;
  }
  results.append(row);
}
const summary = document.getElementById("summary");
summary.textContent = `${passed} из ${tests.length} проверок пройдено`;
summary.className = passed === tests.length ? "pass" : "fail";
document.documentElement.dataset.testStatus = passed === tests.length ? "passed" : "failed";
