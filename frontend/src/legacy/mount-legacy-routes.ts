import type { UpdateParticipant } from '../pwa/update-participants.js';
export interface LegacyMount extends UpdateParticipant { dispose(): void; hasUnsavedChanges(): boolean; }
export function mountLegacyRoutes(root: HTMLElement, dependencies: { url?: string } = {}): LegacyMount {
  const frame = document.createElement('iframe');
  frame.title = 'Проверка маршрутов UrbanAccess'; frame.className = 'legacy-routes-frame';
  frame.src = dependencies.url ?? `${import.meta.env.BASE_URL}legacy.html${location.search}`;
  let dirty = new Set<Element>();
  let disposed = false;
  let doc: Document | undefined;
  let frozen = false;
  const input = (event: Event) => { const form = (event.target as Element | null)?.closest('form'); if (form) dirty.add(form); };
  const changed = (event: Event) => { dirty.add((event as CustomEvent<Element>).detail); };
  const clicked = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.closest('#locate-button, #map')) { const form = target.closest('form'); if (form) dirty.add(form); }
  };
  const saved = (event: Event) => { dirty.delete((event as CustomEvent<Element>).detail); };
  const reset = (event: Event) => { if (event.target && 'nodeType' in event.target && event.target.nodeType === 1) dirty.delete(event.target as Element); };
  const warn = (event: BeforeUnloadEvent) => { if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ''; } };
  const detach = () => {
    doc?.removeEventListener('input', input, true); doc?.removeEventListener('change', input, true);
    doc?.removeEventListener('legacy:form-saved', saved); doc?.removeEventListener('legacy:form-changed', changed);
    doc?.removeEventListener('click', clicked, true); doc?.removeEventListener('reset', reset, true);
  };
  const loaded = () => {
    if (disposed) return;
    detach(); dirty.clear(); doc = frame.contentDocument ?? undefined;
    doc?.addEventListener('input', input, true); doc?.addEventListener('change', input, true);
    doc?.addEventListener('legacy:form-saved', saved); doc?.addEventListener('legacy:form-changed', changed);
    doc?.addEventListener('click', clicked, true); doc?.addEventListener('reset', reset, true);
    if (doc) doc.body.inert = frozen;
  };
  const hasUnsavedChanges = () => !doc || dirty.size > 0 || Number(doc.documentElement.dataset.legacyOperations ?? 0) > 0
    || doc.getElementById('dictate-comment')?.getAttribute('aria-pressed') === 'true';
  frame.addEventListener('load', loaded); window.addEventListener('beforeunload', warn);
  root.replaceChildren(frame);
  return {
    hasUnsavedChanges,
    async prepareUpdate() {
      frozen = true; if (doc) doc.body.inert = true;
      return !hasUnsavedChanges();
    },
    releaseUpdate() { frozen = false; if (doc) doc.body.inert = false; },
    dispose() {
      if (disposed) return; disposed = true; doc?.dispatchEvent(new Event('legacy:dispose')); detach(); dirty.clear();
      frame.removeEventListener('load', loaded); window.removeEventListener('beforeunload', warn);
      // Removing the browsing context releases its DOM handlers, timers and microphone session.
      frame.src = 'about:blank'; frame.remove(); doc = undefined;
    },
  };
}
