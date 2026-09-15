import {
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
import {
  deleteObservation,
  getAllObservations,
  getObservation,
  getObservationPhotos,
  openDatabase,
  saveObservation,
} from "./db.js";

const byId = (id) => document.getElementById(id);
const form = byId("observation-form");
const state = {
  photos: [],
  previewUrls: [],
  listUrls: [],
  editingRecord: null,
  mapZoom: 18,
  toastTimer: null,
};

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function updateConnectionBadge() {
  const badge = byId("connection-badge");
  badge.textContent = navigator.onLine ? "Онлайн" : "Без сети";
  badge.classList.toggle("is-offline", !navigator.onLine);
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== viewId; });
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === viewId));
  if (viewId === "records-view") renderRecords();
  if (viewId === "collector-view") requestAnimationFrame(renderMap);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function revokeUrls(urls) {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.length = 0;
}

function setFindingVisibility() {
  const finding = form.elements.finding.value;
  const restriction = byId("restriction-field");
  restriction.hidden = finding === "ABSENT";
  if (finding === "ABSENT") {
    document.querySelectorAll('input[name="restrictionType"]').forEach((input) => { input.checked = false; });
  }
}

function resetForm() {
  revokeUrls(state.previewUrls);
  state.photos = [];
  state.editingRecord = null;
  state.mapZoom = 18;
  form.reset();
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
    id: byId("record-id").value || makeId(),
    status: "DRAFT",
    observedAt: byId("observed-at").value ? new Date(byId("observed-at").value).toISOString() : "",
    latitude: numberOrNull(byId("latitude").value),
    longitude: numberOrNull(byId("longitude").value),
    positionSource: byId("position-source").value || "MANUAL",
    deviceLatitude: numberOrNull(byId("device-latitude").value),
    deviceLongitude: numberOrNull(byId("device-longitude").value),
    deviceAccuracyM: numberOrNull(byId("device-accuracy").value),
    contextType: byId("context-type").value,
    barrierType: byId("barrier-type").value,
    finding,
    restrictionType: finding === "PRESENT" ? form.elements.restrictionType.value || null : null,
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
    barrierType: [byId("barrier-type")],
    restrictionType: [...document.querySelectorAll('input[name="restrictionType"]')].map((input) => input.nextElementSibling),
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
  const errors = validateObservation(observation, state.photos.length, ready);
  if (Object.keys(errors).length) {
    displayErrors(errors);
    return;
  }

  const button = ready ? byId("save-ready") : byId("save-draft");
  button.disabled = true;
  try {
    const now = new Date().toISOString();
    observation.status = ready ? "READY" : "DRAFT";
    observation.createdAt = state.editingRecord?.createdAt || now;
    observation.updatedAt = now;
    observation.photoCount = state.photos.length;
    await saveObservation(observation, state.photos.map(({ previewUrl, ...photo }) => photo));
    showToast(ready ? "Наблюдение готово к проверке" : "Черновик сохранён");
    resetForm();
    await refreshCount();
    showView("records-view");
  } catch (error) {
    console.error(error);
    showToast("Не удалось сохранить. Проверьте свободное место.");
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
  const allowed = [...files].filter((file) => file.type.startsWith("image/"));
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

function requestLocation() {
  const button = byId("locate-button");
  if (!navigator.geolocation) {
    showToast("Этот браузер не поддерживает геолокацию");
    return;
  }
  button.disabled = true;
  byId("location-status").textContent = "Получаем точные координаты…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      byId("latitude").value = latitude.toFixed(7);
      byId("longitude").value = longitude.toFixed(7);
      byId("device-latitude").value = latitude;
      byId("device-longitude").value = longitude;
      byId("device-accuracy").value = accuracy;
      byId("position-source").value = "GPS";
      byId("location-status").textContent = `GPS ±${Math.round(accuracy)} м · точку можно поправить`;
      button.disabled = false;
      renderMap();
    },
    (error) => {
      const messages = {
        1: "Доступ к геолокации запрещён",
        2: "Не удалось определить положение",
        3: "GPS не ответил вовремя",
      };
      byId("location-status").textContent = messages[error.code] || "Ошибка геолокации";
      button.disabled = false;
      showToast("Можно ввести координаты вручную");
    },
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
  );
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

function renderMap() {
  const map = byId("map");
  map.querySelectorAll(".map-tile").forEach((tile) => tile.remove());
  const latitude = numberOrNull(byId("latitude").value);
  const longitude = numberOrNull(byId("longitude").value);
  const empty = byId("map-empty");
  const valid = Number.isFinite(latitude) && latitude >= -85 && latitude <= 85 && Number.isFinite(longitude);
  empty.hidden = valid;
  if (!valid || map.clientWidth === 0) return;

  const zoom = state.mapZoom;
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
  if (byId("map-empty").hidden === false) return;
  const map = byId("map");
  const rect = map.getBoundingClientRect();
  const latitude = Number(byId("latitude").value);
  const longitude = Number(byId("longitude").value);
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

function fillForm(record, photos) {
  resetForm();
  state.editingRecord = record;
  state.photos = photos.map((photo) => ({ ...photo }));
  byId("record-id").value = record.id;
  byId("observed-at").value = toLocalDateTimeInput(new Date(record.observedAt));
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
  byId("place-name").value = record.placeName || "";
  byId("level-ref").value = record.levelRef || "";
  byId("location-description").value = record.locationDescription || "";
  byId("height-cm").value = record.measurements?.heightCm ?? "";
  byId("width-cm").value = record.measurements?.availableWidthCm ?? "";
  byId("slope-percent").value = record.measurements?.slopePercent ?? "";
  byId("comment").value = record.comment || "";
  byId("collector-title").textContent = "Редактирование наблюдения";
  byId("form-mode-hint").textContent = record.status === "READY" ? "Запись готова к проверке. Изменения сохранят новую локальную версию." : "Это сохранённый черновик.";
  const accuracy = numberOrNull(record.deviceAccuracyM);
  byId("location-status").textContent = record.positionSource === "GPS" && accuracy !== null
    ? `GPS ±${Math.round(accuracy)} м · точку можно поправить`
    : "Точка указана вручную";
  setFindingVisibility();
  renderPhotos();
  showView("collector-view");
}

async function editRecord(id) {
  const [record, photos] = await Promise.all([getObservation(id), getObservationPhotos(id)]);
  if (!record) return;
  fillForm(record, photos);
}

function createRecordCard(record, photos) {
  const card = document.createElement("article");
  card.className = "record-card";
  const photo = document.createElement("div");
  photo.className = "record-photo";
  if (photos[0]?.blob) {
    const url = URL.createObjectURL(photos[0].blob);
    state.listUrls.push(url);
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    photo.append(image);
  } else {
    const placeholder = document.createElement("span");
    placeholder.textContent = "□";
    photo.append(placeholder);
  }

  const body = document.createElement("div");
  body.className = "record-body";
  const top = document.createElement("div");
  top.className = "record-top";
  const heading = document.createElement("h3");
  heading.textContent = BARRIER_LABELS[record.barrierType] || "Черновик без типа";
  const status = document.createElement("em");
  status.className = `record-status ${record.status === "READY" ? "ready" : ""}`;
  status.textContent = record.status === "READY" ? "Готово" : "Черновик";
  top.append(heading, status);

  const meta = document.createElement("p");
  meta.className = "record-meta";
  const context = CONTEXT_LABELS[record.contextType] || "Контекст не указан";
  const finding = FINDING_LABELS[record.finding] || "Состояние не указано";
  meta.textContent = `${formatObservationDate(record.observedAt)} · ${context} · ${finding}`;

  const actions = document.createElement("div");
  actions.className = "record-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Открыть";
  edit.addEventListener("click", () => editRecord(record.id));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.textContent = "Удалить";
  remove.addEventListener("click", async () => {
    if (!window.confirm("Удалить это наблюдение и его фотографии с устройства?")) return;
    await deleteObservation(record.id);
    showToast("Наблюдение удалено");
    await renderRecords();
    await refreshCount();
  });
  actions.append(edit, remove);
  body.append(top, meta, actions);
  card.append(photo, body);
  return card;
}

async function renderRecords() {
  revokeUrls(state.listUrls);
  const records = await getAllObservations();
  const list = byId("records-list");
  list.innerHTML = "";
  let appBytes = new Blob([JSON.stringify(records)]).size;
  for (const record of records) {
    const photos = await getObservationPhotos(record.id);
    appBytes += photos.reduce((total, photo) => total + (photo.size || photo.blob?.size || 0), 0);
    list.append(createRecordCard(record, photos));
  }
  byId("records-empty").hidden = records.length > 0;
  byId("record-count").textContent = `${records.length} ${pluralizeRecords(records.length)}`;
  byId("storage-estimate").textContent = `Данные приложения: ${formatBytes(appBytes)}`;
}

function pluralizeRecords(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "наблюдение";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "наблюдения";
  return "наблюдений";
}

async function refreshCount() {
  const records = await getAllObservations();
  byId("nav-count").textContent = records.length;
  return records;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  const [header, encoded] = dataURL.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || "application/octet-stream";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function exportBackup() {
  const button = byId("export-backup");
  button.disabled = true;
  button.textContent = "Готовим копию…";
  try {
    const records = await getAllObservations();
    const observations = [];
    for (const record of records) {
      const photos = await getObservationPhotos(record.id);
      observations.push({
        record,
        photos: await Promise.all(photos.map(async ({ blob, ...photo }) => ({ ...photo, dataURL: await blobToDataURL(blob) }))),
      });
    }
    const backup = { schema: "urban-accessibility-field-backup", version: 1, exportedAt: new Date().toISOString(), observations };
    downloadBlob(new Blob([JSON.stringify(backup)], { type: "application/json" }), downloadName("urbanaccess-backup", "json"));
    showToast("Полная резервная копия скачана");
  } catch (error) {
    console.error(error);
    showToast("Не удалось подготовить резервную копию");
  } finally {
    button.disabled = false;
    button.textContent = "Скачать полную копию";
  }
}

async function exportGeoJSON() {
  const records = await getAllObservations();
  const features = records.map(observationToGeoJSONFeature).filter(Boolean);
  const collection = { type: "FeatureCollection", features };
  downloadBlob(new Blob([JSON.stringify(collection, null, 2)], { type: "application/geo+json" }), downloadName("urbanaccess-observations", "geojson"));
  showToast(`Экспортировано точек: ${features.length}`);
}

async function exportCSV() {
  const records = await getAllObservations();
  const csv = `\uFEFF${observationsToCSV(records)}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), downloadName("urbanaccess-observations", "csv"));
  showToast(`Экспортировано строк: ${records.length}`);
}

async function importBackup(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (backup.schema !== "urban-accessibility-field-backup" || backup.version !== 1 || !Array.isArray(backup.observations)) {
      throw new Error("Неподдерживаемый формат");
    }
    if (!window.confirm(`Восстановить ${backup.observations.length} наблюдений? Записи с одинаковыми ID будут заменены.`)) return;
    for (const item of backup.observations) {
      if (!item.record?.id) throw new Error("В записи отсутствует ID");
      const photos = (item.photos || []).map(({ dataURL, ...photo }) => {
        const blob = dataURLToBlob(dataURL);
        return { ...photo, blob, size: blob.size, observationId: item.record.id };
      });
      await saveObservation({ ...item.record, photoCount: photos.length }, photos);
    }
    await refreshCount();
    await renderRecords();
    showToast("Резервная копия восстановлена");
  } catch (error) {
    console.error(error);
    showToast("Файл не похож на резервную копию UrbanAccess");
  } finally {
    byId("import-backup").value = "";
  }
}

function bindEvents() {
  window.addEventListener("online", updateConnectionBadge);
  window.addEventListener("offline", updateConnectionBadge);
  window.addEventListener("resize", () => requestAnimationFrame(renderMap));
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelectorAll('input[name="finding"]').forEach((input) => input.addEventListener("change", setFindingVisibility));
  byId("locate-button").addEventListener("click", requestLocation);
  byId("photo-input").addEventListener("change", (event) => addPhotos(event.target.files));
  byId("save-draft").addEventListener("click", () => persistObservation(false));
  form.addEventListener("submit", (event) => { event.preventDefault(); persistObservation(true); });
  byId("reset-form").addEventListener("click", resetForm);
  byId("new-record").addEventListener("click", () => { resetForm(); showView("collector-view"); });
  byId("map").addEventListener("click", movePointFromMap);
  byId("zoom-in").addEventListener("click", () => { state.mapZoom = Math.min(20, state.mapZoom + 1); renderMap(); });
  byId("zoom-out").addEventListener("click", () => { state.mapZoom = Math.max(14, state.mapZoom - 1); renderMap(); });
  [byId("latitude"), byId("longitude")].forEach((input) => input.addEventListener("change", () => {
    byId("position-source").value = "MANUAL";
    byId("location-status").textContent = "Точка указана вручную";
    renderMap();
  }));
  byId("export-backup").addEventListener("click", exportBackup);
  byId("export-geojson").addEventListener("click", exportGeoJSON);
  byId("export-csv").addEventListener("click", exportCSV);
  byId("import-backup").addEventListener("change", (event) => event.target.files[0] && importBackup(event.target.files[0]));
}

async function initialize() {
  updateConnectionBadge();
  bindEvents();
  resetForm();
  try {
    await openDatabase();
    await refreshCount();
  } catch (error) {
    console.error(error);
    showToast("Локальное хранилище недоступно в этом браузере");
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service worker:", error));
  }
}

initialize();
