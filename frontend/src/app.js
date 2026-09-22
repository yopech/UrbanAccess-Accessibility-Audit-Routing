import { getSnapshot, saveProject, saveRecords, applyImport, deleteObservation } from "./db.js";
import { PROJECT_STATUSES, REVIEW_STATUSES, EXPERIENCE_SOURCES, COVERAGE_STATUSES, CONCLUSIONS, DEFAULT_PARTS, id, nowISO, validateProject, validatePilotObservation, reviewObservation, projectRecords, auditSummary, saveConclusion, supersedeRecord, updateCoverage } from "./pilot.js";
import { FINDING_LABELS, RESTRICTION_LABELS, ALTERNATIVE_ACCESS_LABELS, CONTEXT_LABELS, toLocalDateTimeInput, observationsToCSV, observationToGeoJSONFeature, downloadName } from "./domain.js";
import { initCollector, resetForm, fillForm, renderMap } from "./collector.js";
import { $, esc, options, dateLabel, errorMessage } from "./ui.js";
import { createBundle, prepareImport, readBundle, download } from "./exchange.js";
import { renderOverview } from "./map.js";
import { buildReport } from "./report.js";
import { createDemo, demoPhoto } from "./demo.js";
import { resolvePair } from "./pilot.js";

const state = { snapshot: { projects: [], observations: [], photos: [] }, activeId: localStorage.getItem("urbanaccess-project"), view: "project-view", filter: "ALL", urls: [], importFile: null, report: null };
const getProject = () => state.snapshot.projects.find((p) => p.id === state.activeId);
let toastTimer;
function notify(message) { $("toast").textContent = message; $("toast").classList.add("is-visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("is-visible"), 4500); }
function fail(error) { $("global-error").textContent = errorMessage(error); $("global-error").hidden = false; $("global-error").scrollIntoView({ block: "center" }); }
function safe(fn) { return async (event) => { $("global-error").hidden = true; const button = event?.currentTarget; if (button?.tagName === "BUTTON") button.disabled = true; try { await fn(event); } catch (error) { fail(error); } finally { if (button?.tagName === "BUTTON") button.disabled = false; } }; }
function on(id, event, fn) { $(id)?.addEventListener(event, safe(fn)); }
function requireProject() { const project = getProject(); if (!project) throw new Error("Сначала создайте, загрузите или выберите маршрут."); return project; }
function selectProject(value) { state.activeId = value; localStorage.setItem("urbanaccess-project", value || ""); resetForm(); renderProjects(); renderResults(); $("nav-count").textContent = String(projectRecords(getProject(), state.snapshot.observations).length); }
async function refresh() {
  state.snapshot = await getSnapshot();
  if (!getProject()) state.activeId = state.snapshot.projects[0]?.id || null;
  renderProjects(); renderResults();
  $("nav-count").textContent = String(projectRecords(getProject(), state.snapshot.observations).length);
}
function showView(view) {
  if (["collector-view", "records-view", "report-view"].includes(view) && !getProject()) { notify("Сначала создайте маршрут или откройте демо."); view = "project-view"; }
  state.view = view;
  document.querySelectorAll(".view").forEach((el) => { el.hidden = el.id !== view; });
  document.querySelectorAll(".nav-item").forEach((el) => { const active = el.dataset.view === view || view === "report-view" && el.dataset.view === "records-view"; el.classList.toggle("is-active", active); el.setAttribute("aria-current", active ? "page" : "false"); });
  document.body.classList.toggle("collector-active", view === "collector-view");
  document.body.classList.toggle("report-active", view === "report-view");
  if (view === "collector-view") requestAnimationFrame(renderMap);
  if (view === "records-view") { renderResults(); requestAnimationFrame(drawMap); }
  window.scrollTo({ top: 0 });
}

function renderProjects() {
  const p = getProject();
  $("project-select").innerHTML = '<option value="">Выберите маршрут</option>' + state.snapshot.projects.map((x) => `<option value="${esc(x.id)}" ${x.id === p?.id ? "selected" : ""}>${esc(x.title)}</option>`).join("");
  $("welcome").hidden = state.snapshot.projects.length > 0;
  $("export-assignment").disabled = $("export-project").disabled = !p;
  $("project-detail").innerHTML = p ? `<article class="card project-card">
    <div class="eyebrow">${p.isDemo ? "ДЕМО · ВЫМЫШЛЕННЫЕ ДАННЫЕ" : "Проверка пути"} · ${esc(PROJECT_STATUSES[p.status])}</div><h2>${esc(p.title)}</h2>
    <div class="route-endpoints"><p><small>Откуда</small><b>${esc(p.originDescription)}</b></p><span aria-hidden="true">↓</span><p><small>Куда</small><b>${esc(p.destinationDescription)}</b></p></div>
    <p><b>Для кого:</b> ${esc(p.targetRequirements)}</p><p><b>Проверяем:</b> ${esc(p.objective)}</p><p class="muted">${esc(p.partnerName || "Сообщество ещё не указано")} · Координатор: ${esc(p.coordinator)}${p.fieldworkDate ? ` · Выход: ${esc(p.fieldworkDate)}` : ""}</p>
    ${p.instructions ? `<p class="notice">${esc(p.instructions)}</p>` : ""}<ol class="route-parts">${p.parts.map((part) => `<li><b>${esc(part.label)}</b><span>${esc(COVERAGE_STATUSES[part.coverage])}</span></li>`).join("")}</ol>
    <div class="button-row"><button id="start-fieldwork" class="button button-primary">Начать сбор</button><button id="open-results" class="button button-secondary">Открыть результаты</button><button id="edit-project" class="button button-ghost">Изменить задание</button></div>
    ${p.isDemo ? '<p class="muted">Схемы и решения придуманы для знакомства с интерфейсом. Для полевого выхода создайте отдельный маршрут.</p>' : ""}
    ${(p.importVariants || []).map((v, i) => `<details class="notice"><summary>Другая версия задания ${v.resolvedAt ? "— рассмотрена" : "— требуется решение"}</summary><p>Описание из файла сохранено для сравнения. Текущее задание не перезаписано.</p><pre>${esc(JSON.stringify(v.project, null, 2))}</pre>${v.resolvedAt ? `<p>Оставлено текущее задание: ${esc(v.resolution)} · ${esc(dateLabel(v.resolvedAt))}</p>` : `<form class="variant-form" data-index="${i}"><label class="field"><span>Почему оставляем текущее задание?</span><textarea name="reason" required></textarea></label><button class="button button-secondary">Зафиксировать решение</button></form>`}</details>`).join("")}
  </article>` : '<div class="empty-state">Создайте проверку своего пути или загрузите файл задания от координатора.</div>';
  on("start-fieldwork", "click", () => { resetForm(); showView("collector-view"); });
  on("open-results", "click", () => showView("records-view"));
  on("edit-project", "click", () => openProjectForm(p));
  document.querySelectorAll(".variant-form").forEach((form) => form.addEventListener("submit", safe(async (event) => {
    event.preventDefault(); const reason = new FormData(form).get("reason").trim(); if (!reason) throw new Error("Укажите основание решения.");
    const current = requireProject(), variants = current.importVariants.map((v, i) => i === Number(form.dataset.index) ? { ...v, resolvedAt: nowISO(), resolution: reason, reviewer: current.coordinator } : v);
    await saveProject({ ...current, importVariants: variants, updatedAt: nowISO() }); await refresh();
  })));
  renderLegacy();
}

const fields = { "project-name": "title", "partner-name": "partnerName", coordinator: "coordinator", origin: "originDescription", destination: "destinationDescription", "target-requirements": "targetRequirements", objective: "objective", instructions: "instructions", "fieldwork-date": "fieldworkDate" };
function openProjectForm(p = null) {
  showView("project-view"); $("project-form").reset(); $("project-form").hidden = false; $("project-id").value = p?.id || "";
  $("project-form-title").textContent = p ? "Изменить задание" : "Новая проверка";
  for (const [field, key] of Object.entries(fields)) $(field).value = p?.[key] || "";
  $("project-status").innerHTML = options(PROJECT_STATUSES, p?.status || "DRAFT");
  $("project-parts").value = (p?.parts.map((part) => part.label) || DEFAULT_PARTS).join("\n");
  $("project-form").scrollIntoView({ block: "start" }); $("project-name").focus({ preventScroll: true });
}
async function submitProject(event) {
  event.preventDefault(); const previous = state.snapshot.projects.find((p) => p.id === $("project-id").value), at = nowISO();
  const labels = $("project-parts").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (new Set(labels).size !== labels.length) throw new Error("Названия частей не должны повторяться.");
  const removed = previous?.parts.filter((part) => !labels.includes(part.label)) || [];
  if (removed.some((part) => state.snapshot.observations.some((r) => r.auditProjectId === previous.id && r.routePartId === part.id))) throw new Error("Нельзя удалить или переименовать часть с наблюдениями. Добавьте уточнение в инструкцию или новую часть.");
  const project = { ...previous, id: previous?.id || id(), createdAt: previous?.createdAt || at, updatedAt: at, status: $("project-status").value, isDemo: Boolean(previous?.isDemo),
    ...Object.fromEntries(Object.entries(fields).map(([field, key]) => [key, $(field).value.trim()])),
    parts: labels.map((label) => previous?.parts.find((part) => part.label === label) || { id: id(), label, coverage: "UNCHECKED", coverageNote: "" }) };
  const errors = validateProject(project); if (errors.length) throw new Error(errors.join(" "));
  await saveProject(project); state.activeId = project.id; localStorage.setItem("urbanaccess-project", project.id); await refresh(); resetForm(); $("project-form").hidden = true; notify("Задание сохранено на этом устройстве.");
}

function renderLegacy() {
  const legacy = state.snapshot.observations.filter((r) => !r.auditProjectId), p = getProject();
  $("legacy-panel").innerHTML = !legacy.length ? "" : `<details class="card"><summary>Прежние наблюдения без маршрута: ${legacy.length}</summary><p>Все записи и фотографии сохранены. Выберите подходящую часть текущего маршрута, чтобы перенести запись на проверку. Учебный маршрут для этого не подходит.</p>${legacy.map((r) => `<form class="legacy-form" data-record="${esc(r.id)}"><p>${esc(r.locationDescription || r.placeName || r.id)} · ${esc(dateLabel(r.observedAt))}</p><label class="field"><span>Часть текущего маршрута</span><select name="part">${p?.parts.map((part) => `<option value="${esc(part.id)}">${esc(part.label)}</option>`).join("") || '<option value="">Сначала создайте маршрут</option>'}</select></label><button class="button button-secondary" ${!p || p.isDemo ? "disabled" : ""}>Привязать к маршруту</button></form>`).join("")}</details>`;
  document.querySelectorAll(".legacy-form").forEach((form) => form.addEventListener("submit", safe(async (event) => {
    event.preventDefault(); const p = requireProject(); if (p.isDemo) throw new Error("Реальные записи нельзя переносить в демо.");
    const record = state.snapshot.observations.find((r) => r.id === form.dataset.record), part = new FormData(form).get("part");
    if (!p.parts.some((x) => x.id === part)) throw new Error("Выберите часть маршрута.");
    await saveRecords([{ ...record, auditProjectId: p.id, routePartId: part, reviewStatus: "UNREVIEWED", isDemo: false, updatedAt: nowISO() }]); await refresh(); notify("Запись привязана. Перед приёмкой уточните участника и основание оценки.");
  })));
}

function visibleRecords() {
  const p = getProject(); if (!p) return [];
  return projectRecords(p, state.snapshot.observations).filter((r) => state.filter === "HISTORY" ? r.supersededById : !r.supersededById && (state.filter === "ALL" || (r.reviewStatus || "UNREVIEWED") === state.filter)).sort((a, b) => (a.observedAt || "").localeCompare(b.observedAt || "") || a.id.localeCompare(b.id));
}
function drawMap() { renderOverview($("results-map"), visibleRecords(), getProject()?.isDemo); }
function recordCard(r, index) {
  const p = getProject(), photos = state.snapshot.photos.filter((x) => x.observationId === r.id);
  const images = photos.map((photo) => { const url = URL.createObjectURL(photo.blob); state.urls.push(url); return `<button class="photo-preview" data-photo="${esc(url)}" aria-label="Увеличить фото: ${esc(photo.name || "наблюдение")}"><img src="${esc(url)}" alt="${esc(photo.name || "Фото наблюдения")}" loading="lazy"></button>`; }).join("");
  return `<article id="record-${esc(r.id)}" class="card observation-card" tabindex="-1"><div class="card-topline"><span class="record-number">${index + 1}</span><span class="review-badge ${r.reviewStatus === "ACCEPTED" ? "accepted" : ""}">${esc(REVIEW_STATUSES[r.reviewStatus] || "Не проверено")}</span>${r.status === "DRAFT" ? '<span class="muted">Черновик</span>' : ""}</div>
    <h3>${esc(r.locationDescription || "Без ориентира")}</h3><p class="muted">${esc(p.parts.find((x) => x.id === r.routePartId)?.label || "Часть не указана")} · ${esc(dateLabel(r.observedAt))}</p>
    <p><b>${esc(r.finding === "PRESENT" ? RESTRICTION_LABELS[r.restrictionType] || "Влияние не указано" : FINDING_LABELS[r.finding])}</b></p>${r.finding === "PRESENT" ? `<p>${esc(ALTERNATIVE_ACCESS_LABELS[r.alternativeAccess] || "Альтернатива не указана")}${r.alternativeDescription ? `: ${esc(r.alternativeDescription)}` : ""}</p>` : ""}
    <p>${esc(r.comment || "")}</p><p class="muted">${esc(r.reporterAlias || "Участник не указан")} · ${esc(EXPERIENCE_SOURCES[r.experienceSource] || "Основание не указано")}</p><p class="muted">${esc(CONTEXT_LABELS[r.contextType] || "")} · ${esc(r.levelRef || "уровень не указан")} · ${esc(r.latitude)}, ${esc(r.longitude)}</p>
    ${r.conflictOfId ? '<p class="notice">Из файла получена другая версия этой записи. Сравните обе и отклоните неподходящую либо подтвердите замену.</p>' : ""}${r.supersededById ? '<p class="notice">Архивная запись: координатор принял обновление. Она сохранена для истории.</p>' : ""}
    <div class="record-photos">${images}</div><p><b>Решение:</b> ${esc(r.reviewComment || "Ещё не принято")}</p>
    ${r.reviewHistory?.length ? `<details><summary>История решений (${r.reviewHistory.length})</summary><ul>${r.reviewHistory.map((h) => `<li>${esc(dateLabel(h.at))}, ${esc(h.reviewer)}: ${esc(REVIEW_STATUSES[h.status])}. ${esc(h.comment)}</li>`).join("")}</ul></details>` : ""}
    <div class="button-row"><button class="button button-secondary button-small" data-action="edit" data-id="${esc(r.id)}">${r.status === "DRAFT" ? "Продолжить" : "Исправить копией"}</button>${!r.supersededById ? `<button class="button button-ghost button-small" data-action="recheck" data-id="${esc(r.id)}">Проверить снова</button>` : ""}${r.status === "DRAFT" ? `<button class="button button-ghost button-small" data-action="delete" data-id="${esc(r.id)}">Удалить черновик</button>` : ""}</div>
    ${r.status === "READY" && !r.supersededById ? `<details class="review-panel"><summary>Решение координатора</summary><form class="review-form" data-record="${esc(r.id)}"><label class="field"><span>Статус</span><select name="status">${options(REVIEW_STATUSES, r.reviewStatus || "UNREVIEWED")}</select></label><label class="field"><span>Кто проверил</span><input name="reviewer" value="${esc(p.coordinator)}" required maxlength="100"></label><label class="field"><span>Основание решения</span><textarea name="comment" required maxlength="2000">${esc(r.reviewComment || "")}</textarea></label>${r.previousObservationId ? '<label class="checkbox-field"><input name="replace" type="checkbox"> После приёмки заменить прежнюю запись этим наблюдением; старую сохранить в истории</label>' : ""}<button class="button button-primary">Сохранить решение</button></form></details>` : ""}
  </article>`;
}

function renderResults() {
  state.urls.forEach((url) => URL.revokeObjectURL(url)); state.urls = [];
  const p = getProject(); $("results-project").textContent = p?.title || "Выберите маршрут";
  if (!p) { $("results-content").replaceChildren(); return; }
  const s = auditSummary(p, state.snapshot.observations), rows = visibleRecords();
  $("results-content").innerHTML = `${p.isDemo ? '<p class="notice"><b>ДЕМО.</b> Вымышленный маршрут, учебные схемы и решения. <button id="add-demo-example" class="text-button">Заполнить учебную запись</button></p>' : ""}
    <div class="stats-row"><div><b>${s.accepted.length}</b><span>принято</span></div><div><b>${s.pending.length}</b><span>ждут решения</span></div><div><b>${s.unknownParts.length}</b><span>частей не проверено</span></div></div>
    <section class="card conclusion-card"><p class="eyebrow">Вывод для этого пути и требований</p><h3>${esc(CONCLUSIONS[s.effectiveConclusion])}</h3><p>${esc(p.conclusionNote || "Координатор ещё не сформулировал вывод.")}</p>${s.reasons.length ? `<details><summary>Что мешает подтвердить весь путь</summary><ul>${s.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></details>` : ""}<div class="button-row"><button id="open-report" class="button button-primary">Открыть отчёт</button><button id="results-export" class="button button-secondary">Передать результаты</button></div></section>
    <details class="card"><summary>Обследование частей маршрута</summary><p>Точки показывают отдельные места. Отметку «обследован целиком» координатор ставит после проверки всей части, включая подходы и указанный обход.</p><form id="coverage-form">${p.parts.map((part, i) => `<fieldset class="coverage-part" data-index="${i}"><legend>${esc(part.label)}</legend><label class="field"><span>Полнота обследования</span><select name="coverage-${i}">${options(COVERAGE_STATUSES, part.coverage)}</select></label><label class="field"><span>Кто обследовал</span><input name="by-${i}" value="${esc(part.checkedBy || "")}" maxlength="100"></label><label class="field"><span>Когда обследовал</span><input name="at-${i}" type="datetime-local" value="${part.checkedAt ? esc(toLocalDateTimeInput(new Date(part.checkedAt))) : ""}"></label><label class="field"><span>Основание: что именно проверили, где границы</span><textarea name="note-${i}" maxlength="2000">${esc(part.coverageNote || "")}</textarea></label></fieldset>`).join("")}<label class="checkbox-field"><input name="confirmed" type="checkbox" ${p.coverageConfirmed ? "checked" : ""}> Как координатор подтверждаю, что перечислены все части проверяемого пути, включая вход и необходимые обходы.</label><button class="button button-secondary">Сохранить обследование частей</button></form></details>
    <details class="card"><summary>Записать вывод и срок повторной проверки</summary><p>Вывод делает координатор. Давность не удаляет ограничения; истёкший срок проверки делает положительный итог неподтверждённым.</p><form id="conclusion-form"><label class="field"><span>Итог</span><select name="conclusion">${options(CONCLUSIONS, p.conclusion || "UNKNOWN")}</select></label><label class="field"><span>Для кого, при каких условиях и на чём основан вывод</span><textarea name="note" required maxlength="3000">${esc(p.conclusionNote || "")}</textarea></label><label class="field"><span>Повторно проверить до</span><input type="date" name="next" value="${esc(p.nextCheckAt || "")}"></label><button class="button button-primary">Сохранить вывод</button></form></details>
    ${s.pairs.length ? `<details class="card" ${s.conflicts.length ? "open" : ""}><summary>Похожие места и возможные противоречия: ${s.pairs.length}</summary><p>Близость точек — подсказка. Направление, уровень, время и фотографии сравнивает координатор.</p><ul>${s.pairs.map((pair) => `<li>${pair.conflict ? "Возможное противоречие" : "Возможный дубль"}: ${[pair.a, pair.b].map((rid) => { const r = s.all.find((r) => r.id === rid); return `<a href="#record-${esc(rid)}">${esc(r.locationDescription || rid)} · ${esc(r.reporterAlias || "участник")}</a>`; }).join(" ↔ ")}</li>`).join("")}</ul><p class="muted">Для разных проходов уточните часть маршрута или уровень через исправление записи. Для повторной проверки примите замену. Неверную версию отклоните с объяснением.</p></details>` : ""}
    <label class="field"><span>Наблюдения</span><select id="review-filter">${options({ ALL: "Все актуальные", ...REVIEW_STATUSES, HISTORY: "Архив: заменённые записи" }, state.filter)}</select></label>
    <div class="map-block"><div id="results-map" class="overview-map"></div><div class="map-caption"><span>${p.isDemo ? "Учебная схема. Нажмите номер, чтобы открыть запись." : "Точки наблюдений. Подложка требует сети; путь не построен."}</span>${!p.isDemo ? '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>' : ""}</div></div>
    <p class="map-legend">Зелёный — принятая свободная точка · оранжевый — принятое ограничение · охра — другие решения. Цвет отдельной точки не оценивает весь путь.</p>
    <div id="record-list">${rows.map(recordCard).join("") || '<div class="empty-state">Здесь пока нет записей. Добавьте наблюдение или измените фильтр.</div>'}</div>
    <details class="card"><summary>Выгрузка для таблицы и карты</summary><p>CSV и GeoJSON содержат все записи проекта, включая архивные. Фотографии входят в JSON и отчёт.</p><div class="button-row"><button id="export-csv" class="button button-secondary">CSV</button><button id="export-geojson" class="button button-secondary">GeoJSON</button></div></details>`;
  const pairsPanel = document.createElement("div");
  pairsPanel.innerHTML = s.pairs.filter((pair) => pair.conflict).map((pair) => `<details class="card"><summary>${pair.resolution ? "Противоречие рассмотрено" : "Разобрать пару записей"}: ${esc(s.all.find((r) => r.id === pair.a).locationDescription || "место")}</summary>${pair.resolution ? `<p>${esc(pair.resolution.note)} · ${esc(pair.resolution.reviewer)} · ${esc(dateLabel(pair.resolution.at))}</p>` : `<p>Если обе записи верны, объясните различие места, направления или условий. Ошибочную запись отклоните, а подтверждённое изменение примите с заменой прежней записи.</p><form class="pair-form" data-a="${esc(pair.a)}" data-b="${esc(pair.b)}"><label class="field"><span>Почему обе записи совместимы?</span><textarea name="reason" required maxlength="2000"></textarea></label><button class="button button-secondary">Зафиксировать разбор</button></form>`}</details>`).join("");
  $("record-list").before(pairsPanel);
  document.querySelectorAll("[data-photo]").forEach((button) => button.addEventListener("click", () => { $("photo-preview-image").src = button.dataset.photo; $("photo-preview-image").alt = button.querySelector("img").alt; $("photo-dialog").showModal(); }));
  document.querySelectorAll(".pair-form").forEach((form) => form.addEventListener("submit", safe(async (event) => { event.preventDefault(); await saveProject(resolvePair(requireProject(), state.snapshot.observations, form.dataset.a, form.dataset.b, new FormData(form).get("reason"))); await refresh(); drawMap(); notify("Разбор записан. Каждое наблюдение всё равно требует отдельного решения."); })));
  on("review-filter", "change", (event) => { state.filter = event.target.value; renderResults(); drawMap(); });
  on("open-report", "click", openReport); on("results-export", "click", () => exportBundle("RESULTS"));
  on("add-demo-example", "click", addDemoExample);
  on("export-csv", "click", () => download("\uFEFF" + observationsToCSV(projectRecords(p, state.snapshot.observations)), downloadName("urbanaccess", "csv"), "text/csv;charset=utf-8"));
  on("export-geojson", "click", () => download(JSON.stringify({ type: "FeatureCollection", features: projectRecords(p, state.snapshot.observations).map(observationToGeoJSONFeature).filter(Boolean) }, null, 2), downloadName("urbanaccess", "geojson"), "application/geo+json"));
  on("coverage-form", "submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.target), current = requireProject();
    const parts = current.parts.map((part, i) => ({ ...part, coverage: data.get(`coverage-${i}`), checkedBy: data.get(`by-${i}`).trim(), checkedAt: data.get(`at-${i}`) ? new Date(data.get(`at-${i}`)).toISOString() : null, coverageNote: data.get(`note-${i}`).trim() }));
    await saveProject(updateCoverage(current, parts, data.has("confirmed"), state.snapshot.observations)); await refresh(); drawMap(); notify("Обследование частей сохранено. При необходимости обновите итоговый вывод.");
  });
  on("conclusion-form", "submit", async (event) => { event.preventDefault(); const data = new FormData(event.target); await saveProject(saveConclusion(requireProject(), state.snapshot.observations, data.get("conclusion"), data.get("note"), data.get("next"))); await refresh(); drawMap(); notify("Вывод координатора сохранён."); });
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", safe(async () => {
    const record = state.snapshot.observations.find((r) => r.id === button.dataset.id);
    if (button.dataset.action === "delete") { if (!confirm("Удалить этот черновик и его фотографии с устройства?")) return; await deleteObservation(record.id); await refresh(); drawMap(); }
    else fillForm(record, state.snapshot.photos.filter((x) => x.observationId === record.id), button.dataset.action === "recheck");
  })));
  document.querySelectorAll(".review-form").forEach((form) => form.addEventListener("submit", safe(async (event) => {
    event.preventDefault(); const data = new FormData(form), record = state.snapshot.observations.find((r) => r.id === form.dataset.record);
    if (data.get("status") === "ACCEPTED") { const errors = validatePilotObservation(record, state.snapshot.photos.filter((p) => p.observationId === record.id).length, true, requireProject()); if (Object.keys(errors).length) throw new Error(Object.values(errors).join(" ")); }
    const reviewed = reviewObservation(record, data.get("status"), data.get("comment"), data.get("reviewer"));
    const updates = [reviewed]; if (data.has("replace")) updates.push(supersedeRecord(state.snapshot.observations.find((r) => r.id === record.previousObservationId), reviewed));
    await saveRecords(updates); await refresh(); drawMap(); notify("Решение сохранено в истории.");
  })));
  if (state.view === "records-view") requestAnimationFrame(drawMap);
}

async function exportBundle(kind) {
  const bundle = await createBundle(await getSnapshot(), kind === "BACKUP" ? null : requireProject().id, kind === "ASSIGNMENT");
  download(JSON.stringify(bundle), downloadName(`urbanaccess-${kind.toLowerCase()}`, "json"), "application/json"); notify("Файл подготовлен. Передайте его выбранному получателю самостоятельно.");
}
async function previewImport(event) {
  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
  state.importFile = null; $("import-preview").hidden = true;
  const bundle = await readBundle(file), plan = await prepareImport(bundle, await getSnapshot()); state.importFile = bundle;
  $("import-preview").innerHTML = `<div class="notice"><b>${esc(file.name)}</b><p>Добавить записей: ${plan.observations.length}. Уже есть: ${plan.skipped}. Версий для сравнения: ${plan.conflicts}. Новых или уточнённых проектов: ${plan.projects.length}.</p>${plan.warnings.map((w) => `<p>${esc(w)}</p>`).join("")}<p>Текущие записи и решения сохранятся. Имена и решения в файле — сведения его отправителя, личности приложение не проверяет.</p><div class="button-row"><button id="confirm-import" class="button button-primary">Объединить данные</button><button id="cancel-import" class="button button-ghost">Отмена</button></div></div>`;
  $("import-preview").hidden = false;
  on("cancel-import", "click", () => { state.importFile = null; $("import-preview").hidden = true; });
  on("confirm-import", "click", async () => { const current = await prepareImport(state.importFile, await getSnapshot()); await applyImport(current); state.activeId = state.importFile.projects?.[0]?.id || state.activeId; state.importFile = null; $("import-preview").hidden = true; await refresh(); resetForm(); notify("Данные объединены. Проверьте результаты и спорные версии."); });
  $("import-preview").scrollIntoView({ block: "center" });
}
async function openReport() { const p = requireProject(); state.report = await buildReport(p, await getSnapshot()); $("report-content").innerHTML = state.report.content; showView("report-view"); }
async function openDemo() {
  let project = state.snapshot.projects.find((p) => p.isDemo);
  if (!project) { const demo = await createDemo(); await applyImport(demo); project = demo.projects[0]; await refresh(); }
  selectProject(project.id); showView("project-view"); notify("Открыт учебный пример. Начните с результатов проверки.");
}
async function addDemoExample() {
  const p = requireProject(); if (!p.isDemo) return;
  fillForm({ id: id(), auditProjectId: p.id, routePartId: p.parts.at(-1).id, status: "DRAFT", observedAt: nowISO(), latitude: 55.7525, longitude: 37.6175, finding: "PRESENT", restrictionType: "RESTRICTED", alternativeAccess: "UNKNOWN", reporterAlias: "Учебный участник", experienceSource: "DIRECT_OBSERVATION", locationDescription: "Учебная запись: вход в центр", comment: "Демо. Условный вход со ступенью; альтернативу нужно проверить.", contextType: "STREET", measurements: {} }, [await demoPhoto("Учебная запись: вход")]);
}
function connectionStatus() { $("connection-badge").textContent = navigator.onLine ? "На устройстве" : "Без сети"; }

async function init() {
  initCollector({ getProject, notify, showView, onSaved: async () => { await refresh(); showView("records-view"); } });
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  on("project-select", "change", (event) => selectProject(event.target.value));
  on("new-project", "click", () => openProjectForm()); on("welcome-create", "click", () => openProjectForm());
  on("cancel-project", "click", () => { $("project-form").hidden = true; }); on("project-form", "submit", submitProject);
  on("open-demo", "click", openDemo); on("new-record", "click", () => { resetForm(); showView("collector-view"); });
  on("export-assignment", "click", () => exportBundle("ASSIGNMENT")); on("export-project", "click", () => exportBundle("RESULTS")); on("export-backup", "click", () => exportBundle("BACKUP"));
  on("import-open", "click", () => $("import-backup").click()); on("import-backup", "change", previewImport);
  on("back-results", "click", () => showView("records-view"));
  on("close-photo", "click", () => $("photo-dialog").close());
  on("print-report", "click", async () => { await Promise.all([...$("report-content").querySelectorAll("img")].map((img) => img.decode().catch(() => {}))); window.print(); });
  on("download-report", "click", () => { if (state.report) download(state.report.html, downloadName("urbanaccess-report", "html"), "text/html;charset=utf-8"); });
  window.addEventListener("online", connectionStatus); window.addEventListener("offline", connectionStatus); connectionStatus();
  await refresh(); resetForm();
  if (new URLSearchParams(location.search).has("demo")) await openDemo();
  if ("serviceWorker" in navigator) {
    const existing = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register("./sw.js").catch(() => notify("Офлайн-копия пока не готова. Откройте страницу ещё раз при наличии сети."));
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (existing) notify("Доступно обновление. Сохраните черновик и перезагрузите страницу."); });
  }
}
init().catch(fail);
