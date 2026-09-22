import { canonical, validateProject, validatePilotObservation, REVIEW_STATUSES, EXPERIENCE_SOURCES } from "./pilot.js";
const SCHEMA = "urban-accessibility-field-backup";
const MAX_BYTES = 100 * 1024 * 1024;
export function blobToDataURL(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); }); }
function imageBlob(dataURL) {
  if (typeof dataURL !== "string" || dataURL.length > 35 * 1024 * 1024) throw new Error("Слишком большой или некорректный файл фотографии.");
  const match = dataURL.match(/^data:(image\/(?:jpeg|png|webp|gif|avif|svg\+xml));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error("Фотография должна быть изображением в поддерживаемом формате.");
  let bytes; try { bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)); } catch { throw new Error("Не удалось прочитать фотографию."); }
  return new Blob([bytes], { type: match[1] });
}
export async function createBundle(snapshot, projectId = null, assignment = false) {
  const projects = snapshot.projects.filter((p) => !projectId || p.id === projectId).map((p) => assignment ? {
    ...p, status: "FIELDWORK", parts: p.parts.map((part) => ({ ...part, coverage: "UNCHECKED", checkedAt: null, coverageNote: "", checkedBy: "" })),
    conclusion: "UNKNOWN", conclusionNote: "", conclusionAt: null, conclusionHistory: [], conclusionFingerprint: null, coverageConfirmed: false, importVariants: [], pairResolutions: [],
  } : p);
  const rows = assignment ? [] : snapshot.observations.filter((r) => !projectId || r.auditProjectId === projectId);
  const observations = await Promise.all(rows.map(async (record) => ({ record, photos: await Promise.all(snapshot.photos.filter((p) => p.observationId === record.id).map(async ({ blob, ...photo }) => ({ ...photo, dataURL: await blobToDataURL(blob) }))) })));
  return { schema: SCHEMA, version: 2, kind: assignment ? "ASSIGNMENT" : projectId ? "RESULTS" : "BACKUP", exportedAt: new Date().toISOString(), projects, observations };
}
async function hash(value) { const bytes = new TextEncoder().encode(canonical(value)); return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function safeId(value) { return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\u0000-\u001f]/.test(value); }
function recordContent(record) { const { importReceipts, importedAt, conflictOfId, ...content } = record; return content; }
function definition(p) { return { title: p.title, partner: p.partnerName, coordinator: p.coordinator, origin: p.originDescription, destination: p.destinationDescription, requirements: p.targetRequirements, objective: p.objective, instructions: p.instructions, fieldworkDate: p.fieldworkDate, parts: p.parts.map(({ id, label }) => ({ id, label })), isDemo: Boolean(p.isDemo) }; }

export async function prepareImport(bundle, snapshot) {
  if (!bundle || bundle.schema !== SCHEMA || ![1, 2].includes(bundle.version) || !Array.isArray(bundle.observations) || bundle.observations.length > 3000) throw new Error("Это не поддерживаемая копия UrbanAccess (версия 1 или 2).");
  if (bundle.version === 2 && !Array.isArray(bundle.projects)) throw new Error("В файле нет списка проектов.");
  if (canonical(bundle).length > MAX_BYTES) throw new Error("Размер копии превышает 100 МБ. Передайте результаты отдельного маршрута.");
  const plan = { projects: [], observations: [], skipped: 0, conflicts: 0, warnings: [] };
  const projectMap = new Map(snapshot.projects.map((p) => [p.id, p]));
  const incomingIds = new Set();
  for (const source of bundle.projects || []) {
    if (!source || !safeId(source.id) || incomingIds.has(source.id) || validateProject(source).length) throw new Error("В файле некорректный или повторяющийся проект.");
    incomingIds.add(source.id);
    const old = projectMap.get(source.id);
    if (!old) { plan.projects.push(source); projectMap.set(source.id, source); }
    else if (canonical(definition(old)) !== canonical(definition(source))) {
      const fingerprint = await hash(definition(source));
      const variants = old.importVariants || [];
      const updated = variants.some((v) => v.fingerprint === fingerprint) ? old : { ...old, importVariants: [...variants, { fingerprint, project: source }], updatedAt: new Date().toISOString() };
      if (updated !== old) plan.projects.push(updated);
      projectMap.set(source.id, updated);
      plan.warnings.push(`«${old.title}»: описание в файле отличается. Текущая версия сохранена, входящая доступна в деталях проекта.`);
    }
  }
  const records = new Map(snapshot.observations.map((r) => [r.id, r]));
  const rowIds = new Set();
  for (const item of bundle.observations) {
    const source = item?.record;
    if (!source || !safeId(source.id) || rowIds.has(source.id) || !Array.isArray(item.photos)) throw new Error("Некорректная или повторяющаяся запись наблюдения.");
    rowIds.add(source.id);
    if (!["DRAFT", "READY"].includes(source.status) || !["PRESENT", "ABSENT", "CLEAR_PASSAGE"].includes(source.finding)) throw new Error("Неизвестное состояние наблюдения.");
    if (source.latitude != null && (!Number.isFinite(source.latitude) || Math.abs(source.latitude) > 90) || source.longitude != null && (!Number.isFinite(source.longitude) || Math.abs(source.longitude) > 180)) throw new Error("В файле недопустимые координаты.");
    if (source.auditProjectId && !projectMap.has(source.auditProjectId)) throw new Error("Наблюдение ссылается на отсутствующий проект. Передайте полную копию маршрута.");
    const project = projectMap.get(source.auditProjectId);
    if (!Number.isFinite(Date.parse(source.observedAt))) throw new Error("У наблюдения некорректная дата.");
    if (source.reviewStatus && !REVIEW_STATUSES[source.reviewStatus] || source.experienceSource && !EXPERIENCE_SOURCES[source.experienceSource]) throw new Error("Неизвестный источник оценки или решение координатора.");
    if (project && Boolean(source.isDemo) !== Boolean(project.isDemo)) throw new Error("Реальные и учебные записи нельзя смешивать в одном маршруте.");
    for (const key of ["reviewHistory", "importReceipts"]) if (source[key] && !Array.isArray(source[key])) throw new Error("Некорректная история наблюдения.");
    if (source.reviewHistory?.some((entry) => !entry || typeof entry !== "object" || !Object.hasOwn(REVIEW_STATUSES, entry.status) || typeof entry.comment !== "string" || typeof entry.reviewer !== "string" || !Number.isFinite(Date.parse(entry.at)))) throw new Error("Повреждена история решений наблюдения.");
    if (source.importReceipts?.some((receipt) => typeof receipt !== "string")) throw new Error("Повреждена история загрузки записи.");
    if (source.routePartId && project && !project.parts.some((p) => p.id === source.routePartId)) throw new Error("Части маршрута в файле отличаются. Сначала согласуйте одинаковое задание.");
    const photos = item.photos.map((photo) => { const blob = imageBlob(photo.dataURL); return { name: String(photo.name || "Фото"), blob, type: blob.type, size: blob.size }; });
    if (source.reviewStatus === "ACCEPTED" && (!project || source.experienceSource === "ASSUMPTION" || Object.keys(validatePilotObservation(source, photos.length, true, project)).length)) throw new Error("Принятая запись не содержит обязательных доказательств. Уточните исходный файл.");
    const payload = { record: recordContent(source), photos: item.photos.map((p) => p.dataURL) };
    const fingerprint = await hash(payload), old = records.get(source.id);
    if (old?.importReceipts?.includes(fingerprint)) { plan.skipped++; continue; }
    if (old) {
      const oldPhotos = snapshot.photos.filter((p) => p.observationId === old.id);
      const previousHash = await hash({ record: recordContent(old), photos: await Promise.all(oldPhotos.map((p) => blobToDataURL(p.blob))) });
      if (previousHash === fingerprint) { plan.skipped++; continue; }
      const conflictId = `${source.id.slice(0, 180)}~${fingerprint.slice(0, 24)}`;
      if (records.has(conflictId)) { plan.skipped++; continue; }
      const record = { ...source, id: conflictId, conflictOfId: source.id, supersededById: null, reviewStatus: "NEEDS_CLARIFICATION", reviewComment: "Другая версия той же записи из файла. Координатор должен сравнить обе версии.", importedAt: new Date().toISOString(), importReceipts: [fingerprint] };
      plan.observations.push({ record, photos }); records.set(record.id, record); plan.conflicts++;
    } else {
      const record = { ...source, auditProjectId: source.auditProjectId || null, reviewStatus: source.reviewStatus || "UNREVIEWED", photoCount: photos.length, importReceipts: [...(source.importReceipts || []), fingerprint] };
      plan.observations.push({ record, photos }); records.set(record.id, record);
    }
  }
  for (const { record: r } of plan.observations) {
    for (const field of ["previousObservationId", "supersededById", "conflictOfId"]) if (r[field]) {
      const related = records.get(r[field]);
      if (!related || related.id === r.id || related.auditProjectId !== r.auditProjectId) throw new Error("Неполная или неверная связь между версиями наблюдения. Передайте полную копию проекта.");
      if (field === "supersededById" && (related.previousObservationId !== r.id || related.reviewStatus !== "ACCEPTED" || related.routePartId !== r.routePartId || Date.parse(related.observedAt) < Date.parse(r.observedAt))) throw new Error("Не подтверждено корректное обновление прежнего наблюдения.");
    }
    const seen = new Set([r.id]); let linked = r;
    while (linked.supersededById) { if (seen.has(linked.supersededById)) throw new Error("В файле обнаружен цикл замены наблюдений."); seen.add(linked.supersededById); linked = records.get(linked.supersededById); if (!linked) throw new Error("Не найдена новая версия наблюдения."); }
  }
  return plan;
}
export async function readBundle(file) {
  if (file.size > MAX_BYTES) throw new Error("Файл больше 100 МБ. Передайте результаты отдельного маршрута.");
  try { return JSON.parse(await file.text()); } catch { throw new Error("Файл не содержит корректный JSON."); }
}
export function download(data, name, type = "application/json") {
  const blob = data instanceof Blob ? data : new Blob([typeof data === "string" ? data : JSON.stringify(data)], { type });
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
