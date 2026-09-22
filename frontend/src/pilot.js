import { validateObservation } from "./domain.js";

export const PROJECT_STATUSES = { DRAFT: "Подготовка", FIELDWORK: "В поле", REVIEW: "Проверка", COMPLETED: "Завершён", ARCHIVED: "В архиве" };
export const REVIEW_STATUSES = { UNREVIEWED: "Не проверено", ACCEPTED: "Принято", NEEDS_CLARIFICATION: "Нужно уточнить", REJECTED: "Отклонено" };
export const EXPERIENCE_SOURCES = { PERSONAL_EXPERIENCE: "Прошёл сам / сама", DIRECT_OBSERVATION: "Наблюдал на месте", ASSUMPTION: "Предполагаю, нужен осмотр" };
export const COVERAGE_STATUSES = { UNCHECKED: "Не обследован", PARTIAL: "Частично обследован", CHECKED: "Обследован целиком" };
export const CONCLUSIONS = { UNKNOWN: "Данных недостаточно", PASSABLE: "Можно пройти самостоятельно", CONDITIONAL: "Проход с ограничениями или обходом", BLOCKED: "Самостоятельно не пройти" };
export const DEFAULT_PARTS = ["Точка отправления", "Путь по улице", "Переход", "Подход к месту назначения", "Вход"];
export const id = () => globalThis.crypto.randomUUID();
export const nowISO = () => new Date().toISOString();
export const canonical = (value) => JSON.stringify(sortKeys(value));
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => [k, sortKeys(value[k])]));
  return value;
}

export function validateProject(project) {
  const errors = [];
  for (const [key, label] of [["title", "название"], ["originDescription", "точку отправления"], ["destinationDescription", "точку назначения"], ["targetRequirements", "требования к проходу"], ["objective", "цель проверки"], ["coordinator", "имя координатора"]]) {
    if (!String(project[key] || "").trim()) errors.push(`Укажите ${label}.`);
  }
  if (!PROJECT_STATUSES[project.status]) errors.push("Неизвестный статус проекта.");
  if (!Array.isArray(project.parts) || !project.parts.length || project.parts.some((p) => !p.id || !p.label?.trim() || !COVERAGE_STATUSES[p.coverage])) errors.push("Добавьте части маршрута с понятными названиями.");
  if (project.parts && new Set(project.parts.map((p) => p.id)).size !== project.parts.length) errors.push("Идентификаторы частей не должны повторяться.");
  return errors;
}

export function validatePilotObservation(observation, photoCount, ready, project, now) {
  const errors = validateObservation(observation, photoCount, ready, now);
  if (!project || observation.auditProjectId !== project.id) errors.project = "Выберите маршрут перед сбором.";
  if (ready) {
    if (!project?.parts.some((p) => p.id === observation.routePartId)) errors.routePartId = "Выберите часть маршрута.";
    if (!observation.reporterAlias?.trim()) errors.reporterAlias = "Укажите имя или псевдоним участника.";
    if (!EXPERIENCE_SOURCES[observation.experienceSource]) errors.experienceSource = "Укажите, на чём основана оценка.";
    if (!observation.locationDescription?.trim()) errors.locationDescription = "Добавьте ориентир: какой именно проход проверяли.";
    if (observation.finding === "ABSENT" && !observation.previousObservationId) errors.previousObservationId = "Об исчезновении проблемы сообщайте через «Проверить снова» у прежней записи.";
    if (observation.finding === "PRESENT" && ["NEARBY", "DETOUR", "ASSISTED"].includes(observation.alternativeAccess) && !observation.alternativeDescription?.trim()) errors.alternativeDescription = "Опишите, где альтернатива и как ею воспользоваться.";
  }
  return errors;
}

export function reviewObservation(record, status, comment, reviewer, time = nowISO()) {
  if (record.status !== "READY") throw new Error("Сначала участник должен подготовить запись к проверке.");
  if (!REVIEW_STATUSES[status]) throw new Error("Неизвестное решение.");
  if (!reviewer?.trim()) throw new Error("Укажите имя проверяющего.");
  if (!comment?.trim()) throw new Error("Запишите основание решения.");
  if (status === "ACCEPTED" && record.experienceSource === "ASSUMPTION") throw new Error("Предположение нужно проверить на месте. Создайте повторное наблюдение.");
  return { ...record, reviewStatus: status, reviewComment: comment.trim(), reviewer: reviewer.trim(), reviewedAt: time, updatedAt: time,
    reviewHistory: [...(record.reviewHistory || []), { id: id(), status, comment: comment.trim(), reviewer: reviewer.trim(), at: time }] };
}

export function projectRecords(project, records) { return records.filter((r) => r.auditProjectId === project?.id); }
export function currentRecords(records) { return records.filter((r) => !r.supersededById); }
export const pairKey = (a, b) => [a, b].sort().join("|");
export const pairSignature = (a, b) => canonical([a, b].sort((x, y) => x.id.localeCompare(y.id)).map((r) => [r.id, r.updatedAt]));
export function resolvePair(project, records, a, b, note) {
  const x = records.find((r) => r.id === a), y = records.find((r) => r.id === b);
  if (!note?.trim() || !x || !y || x.auditProjectId !== project.id || y.auditProjectId !== project.id) throw new Error("Выберите две записи этого маршрута и объясните, почему они совместимы.");
  const decision = { key: pairKey(a, b), signature: pairSignature(x, y), note: note.trim(), reviewer: project.coordinator, at: nowISO() };
  return { ...project, pairResolutions: [...(project.pairResolutions || []), decision], updatedAt: nowISO() };
}
export function nearbyPairs(records) {
  const rows = currentRecords(records).filter((r) => r.status === "READY" && r.reviewStatus !== "REJECTED");
  const pairs = [];
  for (let a = 0; a < rows.length; a++) for (let b = a + 1; b < rows.length; b++) {
    const x = rows[a], y = rows[b];
    if (x.auditProjectId !== y.auditProjectId || x.routePartId !== y.routePartId || x.contextType !== y.contextType || (x.levelRef && y.levelRef && x.levelRef !== y.levelRef)) continue;
    const related = x.previousObservationId === y.id || y.previousObservationId === x.id || x.conflictOfId === y.id || y.conflictOfId === x.id;
    const near = Number.isFinite(x.latitude) && Number.isFinite(y.latitude) && distanceMeters(x, y) <= 15;
    if (!related && !near) continue;
    const differs = x.finding !== y.finding || x.restrictionType !== y.restrictionType || x.alternativeAccess !== y.alternativeAccess;
    pairs.push({ a: x.id, b: y.id, conflict: Boolean(differs || x.conflictOfId || y.conflictOfId) });
  }
  return pairs;
}
function distanceMeters(a, b) {
  const rad = Math.PI / 180, dLat = (a.latitude - b.latitude) * rad, dLon = (a.longitude - b.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function reportFingerprint(project, records) {
  return canonical({ title: project.title, origin: project.originDescription, destination: project.destinationDescription, requirements: project.targetRequirements,
    objective: project.objective, parts: project.parts, nextCheckAt: project.nextCheckAt, coverageConfirmed: project.coverageConfirmed,
    variants: project.importVariants, pairs: project.pairResolutions, rows: projectRecords(project, records).map((r) => [r.id, r.updatedAt, r.reviewStatus, r.supersededById || null]).sort((a, b) => a[0].localeCompare(b[0])) });
}

export function auditSummary(project, records, today = new Date()) {
  const all = projectRecords(project, records), current = currentRecords(all), ready = current.filter((r) => r.status === "READY");
  const accepted = ready.filter((r) => r.reviewStatus === "ACCEPTED");
  const unknownParts = project.parts.filter((p) => p.coverage !== "CHECKED");
  const pending = current.filter((r) => r.status !== "READY" || !r.reviewStatus || r.reviewStatus === "UNREVIEWED" || r.reviewStatus === "NEEDS_CLARIFICATION");
  const pairs = nearbyPairs(all).map((p) => ({ ...p, resolution: (project.pairResolutions || []).findLast((r) => r.key === pairKey(p.a, p.b) && r.signature === pairSignature(all.find((x) => x.id === p.a), all.find((x) => x.id === p.b))) }));
  const conflicts = pairs.filter((p) => p.conflict && !p.resolution);
  const blocked = accepted.filter((r) => r.finding === "PRESENT" && r.restrictionType === "BLOCKED");
  const due = Boolean(project.nextCheckAt && project.nextCheckAt < today.toISOString().slice(0, 10));
  const changed = project.conclusionFingerprint !== reportFingerprint(project, records);
  const positive = ["PASSABLE", "CONDITIONAL"].includes(project.conclusion);
  const reasons = [];
  if (!project.coverageConfirmed) reasons.push("Координатор ещё не подтвердил полноту перечня частей маршрута.");
  if (unknownParts.length) reasons.push(`Не полностью обследованы части: ${unknownParts.map((p) => p.label).join(", ")}.`);
  if (!accepted.length) reasons.push("Нет принятых наблюдений.");
  if (pending.length) reasons.push(`Ожидают проверки или уточнения: ${pending.length}.`);
  if (conflicts.length) reasons.push(`Есть возможные противоречия: ${conflicts.length}. Их разбирает координатор.`);
  if (project.importVariants?.some((v) => !v.resolvedAt)) reasons.push("Не согласованы разные версии задания.");
  if (due) reasons.push("Наступил согласованный срок повторной проверки.");
  if (positive && accepted.some((r) => r.finding === "PRESENT" && ["NONE", "UNKNOWN", "ASSISTED"].includes(r.alternativeAccess) && r.restrictionType === "BLOCKED")) reasons.push("Нет проверенного самостоятельного обхода заблокированного прохода.");
  if (project.conclusion === "PASSABLE" && accepted.some((r) => r.finding === "PRESENT")) reasons.push("Остались принятые ограничения: свободный проход без условий не подтверждён.");
  const stale = Boolean(project.conclusion && project.conclusion !== "UNKNOWN" && changed);
  if (stale) reasons.push("Сведения изменились после последнего вывода координатора.");
  const effectiveConclusion = stale || (positive && reasons.length) ? "UNKNOWN" : (project.conclusion || "UNKNOWN");
  return { all, current, ready, accepted, pending, pairs, conflicts, blocked, unknownParts, due, reasons, effectiveConclusion,
    alternativesUnknown: accepted.filter((r) => r.finding === "PRESENT" && r.alternativeAccess === "UNKNOWN").length };
}

export function saveConclusion(project, records, conclusion, note, nextCheckAt, time = nowISO()) {
  if (!CONCLUSIONS[conclusion] || !note?.trim()) throw new Error("Выберите вывод и объясните его основание.");
  const updated = { ...project, conclusion, conclusionNote: note.trim(), nextCheckAt, conclusionAt: time, updatedAt: time };
  updated.conclusionFingerprint = reportFingerprint(updated, records);
  const summary = auditSummary(updated, records);
  if (["PASSABLE", "CONDITIONAL"].includes(conclusion) && summary.reasons.length) throw new Error(summary.reasons.join(" "));
  if (conclusion === "BLOCKED" && !summary.blocked.length) throw new Error("Для этого вывода нужно принятое наблюдение о невозможности самостоятельного прохода.");
  updated.conclusionHistory = [...(project.conclusionHistory || []), { conclusion, note: note.trim(), at: time, reviewer: project.coordinator }];
  return updated;
}

export function supersedeRecord(previous, next) {
  if (!previous || next.previousObservationId !== previous.id || next.auditProjectId !== previous.auditProjectId || next.routePartId !== previous.routePartId) throw new Error("Нельзя заменить наблюдение другого места или маршрута.");
  if (next.reviewStatus !== "ACCEPTED" || !Number.isFinite(Date.parse(next.observedAt)) || !Number.isFinite(Date.parse(previous.observedAt)) || new Date(next.observedAt) < new Date(previous.observedAt)) throw new Error("Обновление должно быть принято и наблюдаться не раньше прежнего.");
  if (previous.supersededById && previous.supersededById !== next.id) throw new Error("У прежнего наблюдения уже есть обновление. Проверьте последнюю запись.");
  return { ...previous, supersededById: next.id, updatedAt: nowISO() };
}

export function updateCoverage(project, parts, confirmed, records) {
  if (parts.length !== project.parts.length || parts.some((p, i) => p.id !== project.parts[i].id || !COVERAGE_STATUSES[p.coverage])) throw new Error("Состав частей маршрута изменился. Обновите страницу.");
  for (const part of parts) if (part.coverage === "CHECKED") {
    if (!part.coverageNote?.trim() || !part.checkedBy?.trim() || !Number.isFinite(Date.parse(part.checkedAt)) || Date.parse(part.checkedAt) > Date.now() + 300000) throw new Error(`«${part.label}»: укажите дату, проверяющего и основание обследования всей части.`);
    if (!currentRecords(projectRecords(project, records)).some((r) => r.routePartId === part.id && r.status === "READY" && r.reviewStatus === "ACCEPTED" && r.experienceSource !== "ASSUMPTION")) throw new Error(`«${part.label}»: сначала примите хотя бы одно наблюдение с места.`);
  }
  return { ...project, parts, coverageConfirmed: Boolean(confirmed), updatedAt: nowISO() };
}
