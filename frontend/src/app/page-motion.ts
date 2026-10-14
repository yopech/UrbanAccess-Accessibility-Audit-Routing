/** Presentation only. Navigation guards and editor flush must finish before calling this. */
let activeTransition: ViewTransition | undefined;
function pageReady(stage: HTMLElement): Promise<void> {
  if (stage.querySelector('[data-page-ready="true"]')) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { observer.disconnect(); clearTimeout(timeout); resolve(); };
    const observer = new MutationObserver(() => { if (stage.querySelector('[data-page-ready="true"]')) finish(); });
    observer.observe(stage, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-page-ready'] });
    const timeout = setTimeout(finish, 1500);
  });
}
export async function presentPage(stage: HTMLElement | null, update: () => void): Promise<void> {
  if (!stage || matchMedia('(prefers-reduced-motion: reduce)').matches) { update(); return; }
  stage.setAttribute('aria-busy', 'true');
  try {
    if (document.startViewTransition) {
      activeTransition?.skipTransition();
      const transition = document.startViewTransition(async () => { update(); await pageReady(stage); });
      activeTransition = transition;
      void transition.ready.catch(() => {});
      void transition.finished.catch(() => {}).finally(() => { if (activeTransition === transition) activeTransition = undefined; });
      await transition.updateCallbackDone;
    } else {
      // A white fade is also available in browsers without View Transitions.
      const exit = stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'ease-out', fill: 'forwards' });
      await exit.finished;
      try {
        update(); await pageReady(stage);
        const enter = stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
        exit.cancel(); await enter.finished;
      } finally { exit.cancel(); }
    }
  } finally { stage.removeAttribute('aria-busy'); }
}
