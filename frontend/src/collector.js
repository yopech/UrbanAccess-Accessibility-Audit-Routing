import {
  ALTERNATIVE_ACCESS_LABELS,
  BARRIER_LABELS,
  CONTEXT_LABELS,
  FINDING_LABELS,
  RESTRICTION_LABELS,
  downloadName,
  formatBytes,
  formatObservationDate,
  numberOrNull,
  observationToGeoJSONFeature,
  observationsToCSV,
  toLocalDateTimeInput,
  validateObservation,
} from "./domain.js";
import { saveObservation } from "./db.js";
import { validatePilotObservation, EXPERIENCE_SOURCES } from "./pilot.js";
import {
  LOCATION_CONFIG,
  locationQuality,
  normalizeGeolocationPosition,
  pickMoreAccurateSample,
} from "./location.js";

let hooks;
const byId = (id) => document.getElementById(id);
const form = byId("observation-form");
const DEFAULT_MAP_CENTER = { latitude: 55.7558, longitude: 37.6176 };
const state = {
  photos: [],
  previewUrls: [],
  listUrls: [],
  editingRecord: null,
  mapZoom: 18,
  locationBest: null,
  locationSettleTimer: null,
  locationTimeout: null,
  locationWatchId: null,
  toastTimer: null,
};

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message) { hooks.notify(message); }



function showView(viewId) { hooks.showView(viewId); }

function revokeUrls(urls) {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.length = 0;
}

function setFindingVisibility() {
  const finding = form.elements.finding.value;
  const restriction = byId("restriction-field");
  const alternative = byId("alternative-field");
  restriction.hidden = finding !== "PRESENT";
  alternative.hidden = finding !== "PRESENT";
  byId("alternative-description").closest("label").hidden = finding !== "PRESENT";
  if (finding !== "PRESENT") {
    document.querySelectorAll('input[name="restrictionType"]').forEach((input) => { input.checked = false; });
    document.querySelectorAll('input[name="alternativeAccess"]').forEach((input) => { input.checked = false; });
  }
}

function stopLocationSearch() {
  if (state.locationWatchId !== null) navigator.geolocation?.clearWatch(state.locationWatchId);
  clearTimeout(state.locationSettleTimer);
  clearTimeout(state.locationTimeout);
  state.locationWatchId = null;
  state.locationSettleTimer = null;
  state.locationTimeout = null;
  const button = byId("locate-button");
  button.disabled = false;
  button.innerHTML = '<span aria-hidden="true">◎</span> Определить моё место';
}

export function resetForm() {
  stopLocationSearch();
  revokeUrls(state.previewUrls);
  state.photos = [];
  state.editingRecord = null;
  state.previousObservationId = null;
  state.mapZoom = 18;
  form.reset();
  const project = hooks.getProject();
  byId("collector-project").textContent = project ? `${project.title} · ${project.targetRequirements}` : "Сначала создайте или выберите маршрут";
  const part = byId("route-part"); part.replaceChildren(new Option("Выберите часть", ""), ...(project?.parts || []).map((p) => new Option(p.label, p.id)));
  byId("reporter-alias").value = localStorage.getItem("urbanaccess-reporter") || "";
  byId("recheck-hint").hidden = true;
  byId("finding-absent").disabled = true;
  byId("collector-demo").hidden = !project?.isDemo;
  byId("record-id").value = "";
  byId("observed-at").value = toLocalDateTimeInput();
  byId("context-type").value = "STREET";
  document.querySelector('input[name="finding"][value="PRESENT"]').checked = true;
  byId("device-latitude").value = "";
  byId("device-longitude").value = "";
  byId("device-accuracy").value = "";
  byId("position-source").value = "MANUAL";
  byId("location-status").textContent = "Координаты ещё не получены";
  byId("form-mode-hint").textContent = "Сохраните черновик или отметьте запись готовой к проверке.";
  byId("collector-title").textContent = "Новое наблюдение";
  byId("photo-input").value = "";
  byId("form-errors").hidden = true;
  document.querySelectorAll(".field-error").forEach((element) => element.classList.remove("field-error"));
  setFindingVisibility();
  renderPhotos();
  renderMap();
}

function readObservation() {
  const finding = form.elements.finding.value;
  return {
    id: state.editingRecord?.status === "DRAFT" ? state.editingRecord.id : makeId(),
    auditProjectId: hooks.getProject()?.id,
    routePartId: byId("route-part").value,
    reporterAlias: byId("reporter-alias").value.trim(),
    experienceSource: byId("experience-source").value,
    alternativeDescription: byId("alternative-description").value.trim(),
    previousObservationId: state.previousObservationId || null,
    isDemo: Boolean(hooks.getProject()?.isDemo),
    reviewStatus: "UNREVIEWED",
    status: "DRAFT",
    observedAt: byId("observed-at").value ? new Date(byId("observed-at").value).toISOString() : "",
    latitude: numberOrNull(byId("latitude").value),
    longitude: numberOrNull(byId("longitude").value),
    positionSource: byId("position-source").value || "MANUAL",
    deviceLatitude: numberOrNull(byId("device-latitude").value),
    deviceLongitude: numberOrNull(byId("device-longitude").value),
    deviceAccuracyM: numberOrNull(byId("device-accuracy").value),
    contextType: byId("context-type").value,
    barrierType: byId("barrier-type").value || null,
    finding,
    restrictionType: finding === "PRESENT" ? form.elements.restrictionType.value || null : null,
    alternativeAccess: finding === "PRESENT" ? form.elements.alternativeAccess.value || null : null,
    placeName: byId("place-name").value.trim(),
    levelRef: byId("level-ref").value.trim(),
    locationDescription: byId("location-description").value.trim(),
    measurements: {
      heightCm: numberOrNull(byId("height-cm").value),
      availableWidthCm: numberOrNull(byId("width-cm").value),
      slopePercent: numberOrNull(byId("slope-percent").value),
    },
    comment: byId("comment").value.trim(),
    photoCount: state.photos.length,
  };
}

function displayErrors(errors) {
  document.querySelectorAll(".field-error").forEach((element) => element.classList.remove("field-error"));
  const mapping = {
    observedAt: [byId("observed-at")],
    location: [byId("latitude"), byId("longitude")],
    contextType: [byId("context-type")],
    restrictionType: [...document.querySelectorAll('input[name="restrictionType"]')].map((input) => input.nextElementSibling),
    alternativeAccess: [...document.querySelectorAll('input[name="alternativeAccess"]')].map((input) => input.nextElementSibling),
    photos: [document.querySelector(".photo-button")],
    heightCm: [byId("height-cm")],
    availableWidthCm: [byId("width-cm")],
    slopePercent: [byId("slope-percent")],
  };
  for (const key of Object.keys(errors)) {
    for (const element of mapping[key] || []) element?.classList.add("field-error");
  }
  const summary = byId("form-errors");
  const messages = [...new Set(Object.values(errors))];
  summary.innerHTML = "";
  const title = document.createElement("b");
  title.textContent = "Проверьте запись:";
  const list = document.createElement("ul");
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  }
  summary.append(title, list);
  summary.hidden = false;
  summary.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function persistObservation(ready) {
  const observation = readObservation();
  const errors = validatePilotObservation(observation, state.photos.length, ready, hooks.getProject());
  if (Object.keys(errors).length) {
    displayErrors(errors);
    return;
  }

  const button = ready ? byId("save-ready") : byId("save-draft");
  button.disabled = true;
  try {
    const now = new Date().toISOString();
    observation.status = ready ? "READY" : "DRAFT";
    observation.createdAt = state.editingRecord?.status === "DRAFT" ? state.editingRecord.createdAt : now;
    observation.updatedAt = now;
    observation.photoCount = state.photos.length;
    await saveObservation(observation, state.photos.map(({ previewUrl, ...photo }) => photo));
    showToast(ready ? "Наблюдение готово к проверке" : "Черновик сохранён");
    resetForm();
    localStorage.setItem("urbanaccess-reporter", observation.reporterAlias);
    await hooks.onSaved();
    showView("records-view");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Не удалось сохранить. Проверьте свободное место.");
  } finally {
    button.disabled = false;
  }
}

function renderPhotos() {
  revokeUrls(state.previewUrls);
  const list = byId("photo-list");
  list.innerHTML = "";
  let totalSize = 0;
  for (const photo of state.photos) {
    totalSize += photo.size || photo.blob?.size || 0;
    const url = URL.createObjectURL(photo.blob);
    state.previewUrls.push(url);
    const item = document.createElement("div");
    item.className = "photo-item";
    const image = document.createElement("img");
    image.src = url;
    image.alt = photo.name || "Фотография наблюдения";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", "Удалить фотографию");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.photos = state.photos.filter((candidate) => candidate.id !== photo.id);
      renderPhotos();
    });
    item.append(image, remove);
    list.append(item);
  }
  byId("photo-size").textContent = state.photos.length ? `${state.photos.length} фото · ${formatBytes(totalSize)}` : "";
}

async function addPhotos(files) {
  const selectedCount = files.length;
  const allowed = [...files].filter((file) => /^(image\/(jpeg|png|webp|gif|avif|svg\+xml))$/.test(file.type) && file.size <= 20 * 1024 * 1024);
  for (const file of allowed) {
    state.photos.push({
      id: makeId(),
      name: file.name || `photo-${Date.now()}.jpg`,
      type: file.type || "image/jpeg",
      size: file.size,
      lastModified: file.lastModified || Date.now(),
      blob: file,
    });
  }
  byId("photo-input").value = "";
  renderPhotos();
  if (allowed.length !== selectedCount) showToast("Некоторые файлы не были изображениями");
}

function rememberDeviceLocation(sample) {
  byId("device-latitude").value = sample.latitude;
  byId("device-longitude").value = sample.longitude;
  byId("device-accuracy").value = sample.accuracy;
}

function selectDeviceLocation(sample) {
  rememberDeviceLocation(sample);
  byId("latitude").value = sample.latitude.toFixed(7);
  byId("longitude").value = sample.longitude.toFixed(7);
  byId("position-source").value = "GPS";
  const suffix = locationQuality(sample.accuracy) === "PRECISE"
    ? "точку можно поправить"
    : "проверьте точку на карте";
  byId("location-status").textContent = `GPS ±${Math.round(sample.accuracy)} м · ${suffix}`;
  renderMap();
}

function finishLocationSearch() {
  const best = state.locationBest;
  stopLocationSearch();
  if (!best) {
    byId("location-status").textContent = "Не удалось получить свежую геопозицию";
    showToast("Можно поставить точку на карте вручную");
    return;
  }
  if (locationQuality(best.accuracy) === "POOR") {
    rememberDeviceLocation(best);
    byId("location-status").textContent = `GPS слишком неточный: ±${Math.round(best.accuracy)} м · точку не изменили`;
    showToast("Включите точное местоположение или поставьте точку на карте");
    return;
  }
  selectDeviceLocation(best);
}

function requestLocation() {
  const button = byId("locate-button");
  if (!navigator.geolocation) {
    showToast("Этот браузер не поддерживает геолокацию");
    return;
  }
  stopLocationSearch();
  state.locationBest = null;
  button.disabled = true;
  button.textContent = "Уточняем местоположение…";
  byId("location-status").textContent = "Ищем свежий и точный сигнал…";
  state.locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const sample = normalizeGeolocationPosition(position);
      if (!sample) {
        byId("location-status").textContent = "Отбрасываем устаревшую геопозицию…";
        return;
      }
      state.locationBest = pickMoreAccurateSample(state.locationBest, sample);
      rememberDeviceLocation(state.locationBest);
      byId("location-status").textContent = `Уточняем: сейчас ±${Math.round(state.locationBest.accuracy)} м…`;
      const quality = locationQuality(state.locationBest.accuracy);
      if (quality === "PRECISE") {
        finishLocationSearch();
      } else if (quality === "ACCEPTABLE" && state.locationSettleTimer === null) {
        state.locationSettleTimer = setTimeout(finishLocationSearch, LOCATION_CONFIG.settleTimeMs);
      }
    },
    (error) => {
      const messages = {
        1: "Доступ к геолокации запрещён",
        2: "Не удалось определить положение",
        3: "GPS не ответил вовремя",
      };
      if (error.code === 1) {
        stopLocationSearch();
        byId("location-status").textContent = messages[error.code];
        showToast("Разрешите геолокацию для этого сайта или поставьте точку вручную");
      } else if (!state.locationBest) {
        byId("location-status").textContent = `${messages[error.code] || "Ошибка геолокации"} · продолжаем искать…`;
      }
    },
    { enableHighAccuracy: true, timeout: LOCATION_CONFIG.searchTimeMs, maximumAge: LOCATION_CONFIG.maxSampleAgeMs },
  );
  state.locationTimeout = setTimeout(finishLocationSearch, LOCATION_CONFIG.searchTimeMs);
}

function lonToTileX(longitude, zoom) {
  return ((longitude + 180) / 360) * 2 ** zoom;
}

function latToTileY(latitude, zoom) {
  const radians = latitude * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom;
}

function tileXToLon(x, zoom) {
  return x / 2 ** zoom * 360 - 180;
}

function tileYToLat(y, zoom) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** zoom))) * 180 / Math.PI;
}

export function renderMap() {
  const map = byId("map");
  map.querySelectorAll(".map-tile").forEach((tile) => tile.remove());
  const selectedLatitude = numberOrNull(byId("latitude").value);
  const selectedLongitude = numberOrNull(byId("longitude").value);
  const empty = byId("map-empty");
  const hasSelectedPoint = Number.isFinite(selectedLatitude) && selectedLatitude >= -85 && selectedLatitude <= 85 &&
    Number.isFinite(selectedLongitude) && selectedLongitude >= -180 && selectedLongitude <= 180;
  const latitude = hasSelectedPoint ? selectedLatitude : DEFAULT_MAP_CENTER.latitude;
  const longitude = hasSelectedPoint ? selectedLongitude : DEFAULT_MAP_CENTER.longitude;
  empty.hidden = true;
  map.classList.toggle("has-selected-point", hasSelectedPoint);
  if (map.clientWidth === 0) return;

  const zoom = state.mapZoom;
  map.classList.toggle("schematic-map", Boolean(hooks.getProject()?.isDemo));
  if (hooks.getProject()?.isDemo) return;
  const n = 2 ** zoom;
  const centerX = lonToTileX(longitude, zoom);
  const centerY = latToTileY(latitude, zoom);
  const columns = Math.ceil(map.clientWidth / 256) + 2;
  const rows = Math.ceil(map.clientHeight / 256) + 2;
  const startX = Math.floor(centerX - columns / 2);
  const startY = Math.floor(centerY - rows / 2);

  for (let x = startX; x <= startX + columns; x += 1) {
    for (let y = startY; y <= startY + rows; y += 1) {
      if (y < 0 || y >= n) continue;
      const tile = document.createElement("img");
      const wrappedX = ((x % n) + n) % n;
      tile.className = "map-tile";
      tile.alt = "";
      tile.loading = "lazy";
      tile.draggable = false;
      tile.src = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
      tile.style.left = `${map.clientWidth / 2 + (x - centerX) * 256}px`;
      tile.style.top = `${map.clientHeight / 2 + (y - centerY) * 256}px`;
      map.insertBefore(tile, empty);
    }
  }
}

function movePointFromMap(event) {
  stopLocationSearch();
  const map = byId("map");
  const rect = map.getBoundingClientRect();
  const selectedLatitude = numberOrNull(byId("latitude").value);
  const selectedLongitude = numberOrNull(byId("longitude").value);
  const hasSelectedPoint = Number.isFinite(selectedLatitude) && selectedLatitude >= -85 && selectedLatitude <= 85 &&
    Number.isFinite(selectedLongitude) && selectedLongitude >= -180 && selectedLongitude <= 180;
  const latitude = hasSelectedPoint ? selectedLatitude : DEFAULT_MAP_CENTER.latitude;
  const longitude = hasSelectedPoint ? selectedLongitude : DEFAULT_MAP_CENTER.longitude;
  const centerX = lonToTileX(longitude, state.mapZoom);
  const centerY = latToTileY(latitude, state.mapZoom);
  const clickedX = centerX + (event.clientX - rect.left - rect.width / 2) / 256;
  const clickedY = centerY + (event.clientY - rect.top - rect.height / 2) / 256;
  byId("latitude").value = tileYToLat(clickedY, state.mapZoom).toFixed(7);
  byId("longitude").value = tileXToLon(clickedX, state.mapZoom).toFixed(7);
  byId("position-source").value = "MANUAL";
  const accuracy = numberOrNull(byId("device-accuracy").value);
  byId("location-status").textContent = accuracy === null ? "Точка указана вручную" : `Точка поправлена вручную · исходный GPS ±${Math.round(accuracy)} м сохранён`;
  renderMap();
}

export function fillForm(record, photos, recheck = false) {
  resetForm();
  state.editingRecord = recheck ? null : record;
  state.previousObservationId = recheck || record.status === "READY" ? record.id : record.previousObservationId;
  byId("finding-absent").disabled = !state.previousObservationId;
  byId("route-part").value = record.routePartId || "";
  byId("reporter-alias").value = recheck ? (localStorage.getItem("urbanaccess-reporter") || "") : (record.reporterAlias || "");
  byId("experience-source").value = recheck ? "" : (record.experienceSource || "");
  byId("alternative-description").value = record.alternativeDescription || "";
  byId("recheck-hint").hidden = !state.previousObservationId;
  byId("recheck-hint").textContent = recheck ? "Повторный осмотр: сделайте новое фото и укажите текущее состояние. Прежняя запись сохранится до решения координатора." : "Исправление создаст новую запись. Прежняя оценка и история сохранятся.";
  state.photos = recheck ? [] : photos.map((photo) => ({ ...photo, id: makeId() }));
  byId("record-id").value = record.id;
  byId("observed-at").value = toLocalDateTimeInput(recheck ? new Date() : new Date(record.observedAt));
  byId("latitude").value = record.latitude ?? "";
  byId("longitude").value = record.longitude ?? "";
  byId("position-source").value = record.positionSource || "MANUAL";
  byId("device-latitude").value = record.deviceLatitude ?? "";
  byId("device-longitude").value = record.deviceLongitude ?? "";
  byId("device-accuracy").value = record.deviceAccuracyM ?? "";
  byId("context-type").value = record.contextType || "STREET";
  byId("barrier-type").value = record.barrierType || "";
  const finding = document.querySelector(`input[name="finding"][value="${record.finding || "PRESENT"}"]`);
  if (finding) finding.checked = true;
  const restriction = document.querySelector(`input[name="restrictionType"][value="${record.restrictionType}"]`);
  if (restriction) restriction.checked = true;
  const alternative = document.querySelector(`input[name="alternativeAccess"][value="${record.alternativeAccess}"]`);
  if (alternative) alternative.checked = true;
  byId("place-name").value = record.placeName || "";
  byId("level-ref").value = record.levelRef || "";
  byId("location-description").value = record.locationDescription || "";
  byId("height-cm").value = record.measurements?.heightCm ?? "";
  byId("width-cm").value = record.measurements?.availableWidthCm ?? "";
  byId("slope-percent").value = record.measurements?.slopePercent ?? "";
  byId("comment").value = record.comment || "";
  byId("collector-title").textContent = recheck ? "Повторная проверка" : "Редактирование наблюдения";
  byId("form-mode-hint").textContent = record.status === "READY" ? "Запись готова к проверке. Изменения сохранят новую локальную версию." : "Это сохранённый черновик.";
  const accuracy = numberOrNull(record.deviceAccuracyM);
  byId("location-status").textContent = record.positionSource === "GPS" && accuracy !== null
    ? `GPS ±${Math.round(accuracy)} м · точку можно поправить`
    : "Точка указана вручную";
  setFindingVisibility();
  renderPhotos();
  showView("collector-view");
}

export function initCollector(config) {
  hooks = config;
  document.querySelectorAll('input[name="finding"]').forEach((input) => input.addEventListener("change", setFindingVisibility));
  byId("locate-button").addEventListener("click", requestLocation);
  byId("photo-input").addEventListener("change", (event) => addPhotos(event.target.files));
  byId("save-draft").addEventListener("click", () => persistObservation(false));
  form.addEventListener("submit", (event) => { event.preventDefault(); persistObservation(true); });
  byId("reset-form").addEventListener("click", () => { if (confirm("Очистить несохранённую форму?")) resetForm(); });
  byId("map").addEventListener("click", movePointFromMap);
  byId("zoom-in").addEventListener("click", () => { state.mapZoom = Math.min(20, state.mapZoom + 1); renderMap(); });
  byId("zoom-out").addEventListener("click", () => { state.mapZoom = Math.max(6, state.mapZoom - 1); renderMap(); });
  [byId("latitude"), byId("longitude")].forEach((input) => input.addEventListener("change", () => {
    stopLocationSearch(); byId("position-source").value = "MANUAL";
    byId("location-status").textContent = "Точка указана вручную"; renderMap();
  }));
  window.addEventListener("resize", () => requestAnimationFrame(renderMap));
  resetForm();
}
