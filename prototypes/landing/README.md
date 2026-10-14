# UrbanAccess: four inspection viewpoints

Local landing prototype, separate from the audit application. No audit data or IndexedDB access.

- `pnpm dev:landing`: http://127.0.0.1:5176/
- `pnpm build:landing`: production output in `dist/landing/`
- `pnpm test:landing`: browser/WebGL regression checks against the running preview. Set `PLAYWRIGHT_MODULE_PATH` if Playwright is supplied by an external runtime, or `LANDING_URL` for another preview URL.
- For an authorized Android USB device: `adb reverse tcp:5176 tcp:5176`, then open http://localhost:5176/ on the phone.

The map-bound glass tabs select territory, entrance, indoor circulation and accessible restroom. Keyboard arrow keys, Home and End select tabs. Reduced motion skips camera animation. The primary button opens the audit service.

The procedural Three.js building is illustrative: geometry is not a normative model. The exterior fades in place to reveal interior views. Native-density rendering is capped at 3x and three million framebuffer pixels. Materials are precompiled and their transparency/depth modes stay fixed during animation. Floor routes use four instanced draw calls, with rounded corners and restroom door clearance. Rendering pauses when idle and when hidden; the fixed shadow atlas is generated once.

Browser checks cover 320, 390 and 430 px, native canvas density, a map-bound dock no taller than 54 px, keyboard navigation, reduced motion, interrupted transitions, shader stability, draw calls, ramp endpoints and restroom route geometry.

## Smooth scrolling

Locomotive Scroll 5.0.1 is bundled locally for this landing only. Wheel smoothing and synchronized touch inertia use Lenis interpolation 0.12. The WebGL map is not placed in a transformed scrolling wrapper. Keyboard and native scrollbar scrolling remain available. Reduced motion destroys the smoothing instance; returning to normal motion recreates one instance. Hidden-page animation pauses, and pagehide/HMR remove listeners and destroy the instance.

Official APIs: https://scroll.locomotive.ca/docs/documentation/options and https://scroll.locomotive.ca/docs/documentation/methods.

## City context

Four muted neighboring buildings, three cars, a street crossing, curbs, lamps and planted sidewalks surround the inspection building. The environment is fixed through all four viewpoints. Static geometry is batched by 12 shared materials; lights use one fixed shadow atlas. Browser QA checks finite geometry and raycasts to the door, indoor stairs and toilet to reject context that blocks inspection sightlines.
