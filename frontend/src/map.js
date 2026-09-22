function valid(r) { return Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Math.abs(r.latitude) < 85 && Math.abs(r.longitude) <= 180; }
const x = (lon) => (lon + 180) / 360;
const y = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
const color = (r) => r.reviewStatus !== "ACCEPTED" ? "#805d20" : r.finding === "PRESENT" ? "#b84829" : "#24674b";
export function pointLayout(records, width = 640, height = 320) {
  const points = records.map((r, index) => ({ ...r, number: index + 1 })).filter(valid);
  if (!points.length) return { points: [], cx: .5, cy: .5, zoom: 16, width, height };
  const xs = points.map((p) => x(p.longitude)), ys = points.map((p) => y(p.latitude));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
  const zoom = Math.max(0, Math.min(18, Math.floor(Math.log2(Math.min((width - 64) / (256 * (spanX || 1e-8)), (height - 64) / (256 * (spanY || 1e-8)))))));
  const scale = 256 * 2 ** zoom;
  return { points: points.map((r) => ({ ...r, px: width / 2 + (x(r.longitude) - cx) * scale, py: height / 2 + (y(r.latitude) - cy) * scale })), cx, cy, zoom, width, height };
}
export function schemeSVG(records) {
  const { points } = pointLayout(records);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320" role="img" aria-label="Расположение наблюдений, без построенного маршрута"><defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#dce3dd"/></pattern></defs><rect width="640" height="320" fill="#f1f4ee"/><rect width="640" height="320" fill="url(#grid)"/>${points.map((r, i) => `<g><circle cx="${r.px}" cy="${r.py}" r="15" fill="${color(r)}" stroke="white" stroke-width="2"/><text x="${r.px}" y="${r.py + 5}" text-anchor="middle" font-size="14" font-family="sans-serif" fill="white">${r.number}</text></g>`).join("")}${!points.length ? '<text x="320" y="160" text-anchor="middle" font-family="sans-serif" fill="#53675a">Нет точек с координатами</text>' : ""}</svg>`;
}
export function renderOverview(container, records, demo = false) {
  if (!container) return;
  const width = container.clientWidth || 360, layout = pointLayout(records, width, 300);
  container.replaceChildren(); container.className = `overview-map ${demo ? "schematic-map" : ""}`;
  container.setAttribute("aria-label", demo ? "Учебная схема точек" : "Карта всех наблюдений проекта");
  if (!layout.points.length) { container.textContent = "Пока нет точек с координатами"; return; }
  if (!demo) {
    const centerX = layout.cx * 2 ** layout.zoom, centerY = layout.cy * 2 ** layout.zoom;
    for (let tx = Math.floor(centerX - width / 512) - 1; tx <= Math.ceil(centerX + width / 512); tx++) for (let ty = Math.floor(centerY - 300 / 512) - 1; ty <= Math.ceil(centerY + 300 / 512); ty++) {
      if (ty < 0 || ty >= 2 ** layout.zoom) continue;
      const img = document.createElement("img"); img.className = "map-tile"; img.alt = "";
      img.src = `https://tile.openstreetmap.org/${layout.zoom}/${((tx % 2 ** layout.zoom) + 2 ** layout.zoom) % 2 ** layout.zoom}/${ty}.png`;
      img.style.left = `${width / 2 + (tx - centerX) * 256}px`; img.style.top = `${150 + (ty - centerY) * 256}px`; container.append(img);
    }
  }
  layout.points.forEach((r, i) => {
    const button = document.createElement("button"); button.className = "point-button"; button.style.left = `${r.px}px`; button.style.top = `${r.py}px`; button.style.background = color(r); button.textContent = String(i + 1); button.title = r.locationDescription || `Наблюдение ${i + 1}`;
    button.textContent = String(r.number);
    button.setAttribute("aria-label", `Открыть наблюдение ${r.number}: ${r.locationDescription || "точка"}`);
    button.addEventListener("click", () => { const card = document.getElementById(`record-${r.id}`); if (card) { card.scrollIntoView({ block: "center", behavior: "smooth" }); card.focus({ preventScroll: true }); } });
    container.append(button);
  });
}
