export const $ = (id) => document.getElementById(id);
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const options = (labels, selected = "") => Object.entries(labels).map(([v, label]) => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(label)}</option>`).join("");
export function dateLabel(value) { const d = new Date(value); return value && Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(d) : "не указана"; }
export function errorMessage(error) { return error?.message || "Операция не выполнена. Попробуйте ещё раз."; }
