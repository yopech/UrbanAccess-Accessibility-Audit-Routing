import { useSyncExternalStore } from 'react';
import { pwaUpdates } from './pwa-update-controller.js';
export function PwaUpdatePrompt() {
  const state = useSyncExternalStore(pwaUpdates.subscribe, pwaUpdates.getSnapshot, pwaUpdates.getSnapshot);
  if (!state.message) return null;
  return <aside className="pwa-status" aria-live="polite" data-pwa-status={state.status}>
    <span>{state.message}</span>
    {(state.status === 'waiting' || state.status === 'blocked') && <button onClick={() => { void pwaUpdates.applyUpdate(); }}>Сохранить данные и обновить приложение</button>}
  </aside>;
}
