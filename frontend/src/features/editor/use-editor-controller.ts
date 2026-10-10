import { useEffect, useSyncExternalStore } from 'react';
import type { StoredAudit } from '../../storage/audit-store.js';
import type { EditorController, EditorSnapshot } from './editor-controller.js';
import { updateParticipants } from '../../pwa/update-participants.js';

export function useEditorController<T extends StoredAudit, C>(controller: EditorController<T, C>): EditorSnapshot<T> {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const disconnect = controller.connect();
    const unregister = updateParticipants.add(controller);
    const flush = () => { if (document.visibilityState === 'hidden') void controller.flush(); };
    const flushNow = () => { void controller.flush(); };
    const warn = (event: BeforeUnloadEvent) => {
      if (controller.hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ''; }
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('focusout', flushNow);
    window.addEventListener('beforeunload', warn);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('focusout', flushNow);
      window.removeEventListener('beforeunload', warn);
      // The owner retains the controller and its queue if flush is blocked.
      const releaseIfSaved = () => {
        if (!controller.hasUnsavedChanges()) { unregister(); unsubscribe(); }
      };
      const unsubscribe = controller.subscribe(releaseIfSaved);
      void controller.flush().then(releaseIfSaved); disconnect();
    };
  }, [controller]);
  return snapshot;
}

export async function flushBeforeTransition<T extends StoredAudit, C>(controller: EditorController<T, C>, transition: () => void): Promise<boolean> {
  if ((await controller.flush()).kind !== 'saved') return false;
  transition(); return true;
}
