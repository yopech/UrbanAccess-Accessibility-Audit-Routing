# UI motion review, 2026-10-14

References examined live:
- https://locomotive.ca/en/work
- https://pandapay.ca/ and its About navigation
- https://lightshiprv.com/
- https://populous.com/
- https://github.com/locomotivemtl/locomotive-scroll

Our design conclusions: borrow Pandapay's restrained black-and-white editorial illustration and white fade, Populous's clear hierarchy around one primary visual, and Lightship's restrained surface treatment. Keep UrbanAccess's dark green, system typography and grouped mobile forms. The references are inspiration; artwork and layouts are original.

## Implementation

Navigation guards and editor flush run first. The presentation layer uses native View Transitions, capturing the destination after its existing data loading is ready. The outgoing view fades to white in 110 ms and the new view appears in 190 ms, with 70 ms overlap timing. A 90/180 ms opacity fallback covers browsers without this API. Reduced motion changes pages directly. Page readiness is signalled by markup, not by new storage requests.

Routine autosave is announced to screen readers without occupying header space. Error/conflict notices are positioned above the content, preserving layout. The header menu is anchored to its trigger. Both header and card menus use one-open-at-a-time state, close on outside tap or Escape, animate opacity/transform and remain mounted to preserve portal dialogs.

Feedback uses 160 ms color/shadow transitions, 220–240 ms movement, and compositor-friendly transforms/opacity for page and dialog motion. No perpetual UI animation or global `transition: all`. Native wheel/touch scrolling stays intact, including horizontal zone inertia. Programmatic review scrolling uses existing browser smooth scroll. Locomotive Scroll was reviewed but is not required for an offline data-entry tool with keyboard, dialog and focus management.

Verification should cover: header geometry across dirty/saving/saved, menu alignment and mutual exclusion, interrupted navigation, focus, saving before leaving, reduced motion, native and fallback route transitions, 320–430 px overflow and existing M1 scenarios.

Follow-up: editor and punch-list share `AuditNavigationRow`, including the same 24 px chevron, 44 px button, centered 16 px title and 12 px padding above the Safe Area. Review export stays in the bottom dock. Card menus open left of their trigger so they do not cover the next card's menu button.

Live preview: production bundles are served from memory on port 5175. This avoids file-provider read timeouts and HMR reload storms observed in the development server. The landing remains on port 5176. Both ports are forwarded over USB for phone testing.

User follow-up: Locomotive Scroll 5.0.1 is now enabled on the landing, with wheel smoothing and synchronized touch inertia. The audit form retains native scrolling. Reduced-motion and lifecycle cleanup are handled in `prototypes/landing/src/landing-scroll.ts`.
