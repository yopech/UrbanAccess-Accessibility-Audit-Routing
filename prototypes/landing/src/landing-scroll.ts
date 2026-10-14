import LocomotiveScroll from 'locomotive-scroll';
import 'locomotive-scroll/locomotive-scroll.css';

/** Landing-only scroll lifecycle. Does not wrap or transform the WebGL map. */
export function installLandingScroll(): () => void {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let instance: LocomotiveScroll | undefined;
  let syncFrame = 0;
  let startFrame = 0;
  let disposed = false;
  let initialized = false;
  const sync = () => {
    syncFrame = 0;
    if (disposed) return;
    if (reduced.matches) {
      cancelAnimationFrame(startFrame);
      instance?.destroy(); instance = undefined; initialized = false;
      document.documentElement.removeAttribute('data-scroll-orientation');
      return;
    }
    if (!instance) {
      const created = new LocomotiveScroll({
        autoStart: false,
        lenisOptions: {
          smoothWheel: true,
          lerp: .12,
          wheelMultiplier: 1,
          syncTouch: true,
          syncTouchLerp: .12,
          touchMultiplier: 1,
          touchInertiaExponent: 1.4,
          autoRaf: false,
        },
      });
      instance = created; initialized = false;
      // Locomotive initializes its observers in the previous queued frame.
      startFrame = requestAnimationFrame(() => { initialized = true; if (!disposed && instance === created && !document.hidden) created.start(); });
    } else if (!document.hidden) instance.start();
  };
  const schedule = () => { cancelAnimationFrame(syncFrame); syncFrame = requestAnimationFrame(sync); };
  const visibility = () => { if (document.hidden) instance?.stop(); else schedule(); };
  const keyboard = (event: KeyboardEvent) => {
    if (['Tab', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) {
      // Cancel wheel inertia before the browser performs keyboard/focus scrolling.
      instance?.scrollTo(window.scrollY, { immediate: true });
    }
  };
  reduced.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('keydown', keyboard);
  schedule();
  return () => {
    disposed = true;
    cancelAnimationFrame(syncFrame); cancelAnimationFrame(startFrame);
    reduced.removeEventListener('change', schedule);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('keydown', keyboard);
    // Defer until Locomotive's own queued init has run, then destroy exactly once.
    const current = instance; instance = undefined;
    if (current) { if (initialized) current.destroy(); else requestAnimationFrame(() => current.destroy()); }
    document.documentElement.removeAttribute('data-scroll-orientation');
  };
}
