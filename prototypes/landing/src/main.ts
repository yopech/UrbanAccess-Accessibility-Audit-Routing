import { BuildingScene, type ZoneIndex } from './scene';
import './style.css';
import { installLandingScroll } from './landing-scroll';
import peopleImage from './assets/accessibility-people.png';

const zones = [
  { title: 'Территория', description: 'Парковка, пешеходный путь и перепады высоты на подходе к зданию.' },
  { title: 'Вход', description: 'Дверной проём, порог, входная площадка, пандус и поручни.' },
  { title: 'Внутри', description: 'Коридоры, лестницы и лифт на пути между помещениями.' },
  { title: 'Санузел', description: 'Место для разворота, опорные поручни и кнопка вызова помощи.' },
] as const;
const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
const serviceUrl = import.meta.env.DEV ? 'http://localhost:5175/frontend/#/audits' : 'https://yopech.github.io/UrbanAccess-Accessibility-Audit-Routing/frontend/update.html#/audits';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="site-header"><a class="wordmark" href="./">UrbanAccess</a></header>
  <main>
    <div class="hero-copy">
      <h1>Проверьте доступность<br><em>всего здания.</em></h1>
      <p class="intro">Для НКО и команд обследования. Замеры, фотографии и замечания собраны в одном акте.</p>
      <a class="service-button" href="${serviceUrl}">Открыть сервис ${arrow}</a>
    </div>
    <section class="scene-panel" aria-label="Интерактивная карта обследования здания">
      <div class="scene-canvas" id="scene" role="tabpanel" aria-labelledby="zone-tab-0"><div class="loading" role="status">Открываем здание…</div></div>
      <div class="scene-markers" aria-label="Зоны здания">${zones.map((z, i) => `<button type="button" class="scene-marker ${i === 0 ? 'is-selected' : ''}" data-zone="${i}" aria-label="Показать зону: ${z.title}" hidden><span>${i + 1}</span></button>`).join('')}</div>
      <nav class="zone-dock" aria-label="Ракурсы обследования">
        <div class="zone-tabs" role="tablist" aria-label="Выберите зону">${zones.map((z, i) => `<button id="zone-tab-${i}" class="zone-tab" type="button" role="tab" aria-selected="${i === 0}" aria-controls="scene" tabindex="${i === 0 ? '0' : '-1'}" data-zone="${i}">${z.title}</button>`).join('')}</div>
      </nav>
    </section>
    <p class="zone-description" id="zone-text" aria-live="polite" aria-atomic="true">${zones[0].description}</p>
  </main>
  <section class="people-section">
    <div><h2>Доступность для разных людей.</h2><p>Обследуйте здание вместе с теми, кто им пользуется. Зафиксируйте препятствия и подготовьте понятный список доработок.</p></div>
    <img src="${peopleImage}" width="1536" height="1024" loading="lazy" decoding="async" alt="Человек на кресле-коляске, пожилой человек с тростью и два инспектора обсуждают обследование здания" />
  </section>
`;
const cleanupScroll = installLandingScroll();
const canvas = document.querySelector<HTMLElement>('#scene')!;
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.zone-tab')];
const markers = [...document.querySelectorAll<HTMLButtonElement>('.scene-marker')];
let scene: BuildingScene | undefined;
let cleanupScene: (() => void) | undefined;
function select(index: ZoneIndex) {
  tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
  markers.forEach((marker, i) => marker.classList.toggle('is-selected', i === index));
  canvas.setAttribute('aria-labelledby', `zone-tab-${index}`);
  document.querySelector('#zone-text')!.textContent = zones[index].description;
  app.dataset.zone = String(index);
  scene?.select(index);
}
function unavailable() {
  markers.forEach(marker => marker.hidden = true);
  canvas.innerHTML = '<div class="scene-fallback"><strong>Не удалось открыть 3D-карту</strong><p>Выберите зону, чтобы посмотреть состав обследования.</p><button type="button" id="retry">Попробовать снова</button></div>';
  document.querySelector('#retry')?.addEventListener('click', () => location.reload());
}
try {
  scene = new BuildingScene(canvas);
  scene.onProject = points => points.forEach((point, i) => {
    markers[i].hidden = !point.visible;
    markers[i].style.opacity = String(point.opacity);
    markers[i].style.transform = `translate3d(${point.x}px,${point.y}px,0)`;
  });
  canvas.addEventListener('scene-unavailable', unavailable);
  void scene.ready.then(() => { canvas.querySelector('.loading')?.remove(); }).catch(unavailable);
  cleanupScene = () => { canvas.removeEventListener('scene-unavailable', unavailable); scene?.dispose(); };
} catch (error) { console.error('3D scene initialization:', error); unavailable(); }
[...tabs, ...markers].forEach(button => button.addEventListener('click', () => select(Number(button.dataset.zone) as ZoneIndex)));
tabs.forEach((tab, i) => tab.addEventListener('keydown', event => {
  let index: number | undefined;
  if (event.key === 'ArrowRight') index = (i + 1) % 4;
  if (event.key === 'ArrowLeft') index = (i + 3) % 4;
  if (event.key === 'Home') index = 0;
  if (event.key === 'End') index = 3;
  if (index !== undefined) { event.preventDefault(); tabs[index].focus(); select(index as ZoneIndex); }
}));
const pagehide = () => { cleanupScroll(); cleanupScene?.(); };
const pageshow = (event: PageTransitionEvent) => { if (event.persisted) location.reload(); };
window.addEventListener('pagehide', pagehide);
window.addEventListener('pageshow', pageshow);
if (import.meta.hot) import.meta.hot.dispose(() => {
  cleanupScroll(); cleanupScene?.();
  window.removeEventListener('pagehide', pagehide);
  window.removeEventListener('pageshow', pageshow);
});
