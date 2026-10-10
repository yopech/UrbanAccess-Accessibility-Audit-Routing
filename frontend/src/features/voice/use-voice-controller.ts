import { useEffect, useRef, useSyncExternalStore } from 'react';
import { registerNavigationGuard } from '../../app/navigation-guards.js';
import { updateParticipants } from '../../pwa/update-participants.js';
import type { VoiceController } from './voice-controller.js';
export function useVoiceController(controller: VoiceController) {
  const generation = useRef(0);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const current = ++generation.current;
    const unregister = updateParticipants.add(controller);
    const guard = registerNavigationGuard(() => { void controller.stop(); return !controller.hasPendingWork(); });
    const hidden = () => { if (document.visibilityState === 'hidden') void controller.stop().then(() => controller.flush()); };
    const pagehide = () => { void controller.stop().then(() => controller.flush()); };
    const beforeunload = (event: BeforeUnloadEvent) => { if (controller.hasPendingWork()) { void controller.stop(); event.preventDefault(); event.returnValue = ''; } };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', pagehide); window.addEventListener('beforeunload', beforeunload);
    return () => {
      guard(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pagehide); window.removeEventListener('beforeunload', beforeunload);
      // Keep the update blocker until final results and their storage transactions finish.
      void controller.stop().then(() => controller.flush()).then(async (saved) => {
        if (saved) unregister();
        if (generation.current === current && saved) await controller.dispose();
      });
    };
  }, [controller]);
  return snapshot;
}
