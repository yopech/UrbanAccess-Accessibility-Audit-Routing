import { StrictMode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/cyrillic-400.css';
import './shell.css';
import { allowNavigation } from './navigation-guards.js';
import { openDatabase } from '../storage/database.js';
import { pwaUpdates } from '../pwa/pwa-update-controller.js';
import { PwaUpdatePrompt } from '../pwa/pwa-update-prompt.js';
import { AuditListPage } from '../features/audits/audit-list-page.js';
import { AuditReviewPage } from '../features/review/audit-review-page.js';
import { AuditEditorPage } from '../features/audits/audit-editor-page.js';
import { installZ2Template } from '../features/audits/audit-service.js';
import type { Audit, AuditCommand } from '../domain/audit-model.js';
import type { EditorController } from '../features/editor/editor-controller.js';
const defaultRoute = '#/audits';
const accessibleRoute = (hash: string): string => hash === '#/routes' || hash.startsWith('#/routes/') ? defaultRoute : hash || defaultRoute;
function App() {
  const pwa = useSyncExternalStore(pwaUpdates.subscribe, pwaUpdates.getSnapshot, pwaUpdates.getSnapshot);
  const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const [route, setRoute] = useState(accessibleRoute(location.hash));
  const routeRef = useRef(route); const navigation = useRef(Promise.resolve());
  const activeEditor = useRef<EditorController<Audit, AuditCommand> | undefined>(undefined);
  const register = useCallback((controller: EditorController<Audit, AuditCommand> | undefined) => { activeEditor.current = controller; }, []);
  const navigate = useCallback((target: string) => {
    target = accessibleRoute(target);
    navigation.current = navigation.current.then(async () => {
      if (target === routeRef.current) return;
      if (!allowNavigation()) { history.replaceState(null, '', routeRef.current); return; }
      if (pwaUpdates.getSnapshot().status === 'preparing') { history.replaceState(null, '', routeRef.current); return; }
      const controller = activeEditor.current;
      if (controller && (await controller.flush()).kind !== 'saved') {
        history.replaceState(null, '', routeRef.current); setError('Сначала завершите сохранение или разрешите конфликт.'); return;
      }
      routeRef.current = target; setError(''); setRoute(target);
      if (location.hash !== target) location.hash = target;
    }).catch((cause: unknown) => { history.replaceState(null, '', routeRef.current); setError(cause instanceof Error ? cause.message : 'Переход не завершён.'); });
  }, []);
  useEffect(() => {
    let active = true;
    void openDatabase().then(installZ2Template).then(() => { if (active) setReady(true); }, (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось открыть локальные данные.'); });
    if (location.hash !== accessibleRoute(location.hash)) history.replaceState(null, '', accessibleRoute(location.hash));
    const change = () => navigate(accessibleRoute(location.hash)); window.addEventListener('hashchange', change);
    void pwaUpdates.start();
    return () => { active = false; window.removeEventListener('hashchange', change); pwaUpdates.stop(); };
  }, [navigate]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [route]);
  const match = /^#\/audits\/([0-9a-f-]+)(\/review)?(?:\?(.*))?$/i.exec(route);
  const focus = new URLSearchParams(match?.[3] ?? '');
  return <><header className="shell-header"><strong>UrbanAccess</strong><span>Данные хранятся на этом устройстве</span>
    <nav aria-label="Режим работы"><button aria-current={route.startsWith('#/audits') ? 'page' : undefined} onClick={() => navigate('#/audits')}>Обследования</button></nav></header>
    <PwaUpdatePrompt />
    {error && <p role="alert" className="global-error">{error}</p>}
    {!ready && !error && <p role="status" className="audit-page">Открываем локальные данные</p>}
    <div inert={pwa.status === 'preparing'}>{ready && (route === '#/audits' ? <AuditListPage navigate={navigate} />
      : match ? (match[2] ? <AuditReviewPage key={route} id={match[1]!} navigate={navigate} register={register} /> : <AuditEditorPage key={route} id={match[1]!} navigate={navigate} register={register} focusElementId={focus.get('element') ?? undefined} focusField={focus.get('field') ?? undefined} voiceDraftId={focus.get('voice') ?? undefined} zoneCode={focus.get('zone') ?? undefined} />)
      : <main className="audit-page"><h1>Раздел не найден</h1><button onClick={() => navigate('#/audits')}>Открыть обследования</button></main>)}</div>
    <small className="build-label" data-build={__APP_VERSION__}>Версия {__APP_VERSION__}</small>
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
