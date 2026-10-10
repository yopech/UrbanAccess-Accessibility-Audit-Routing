const guards = new Set<() => boolean>();
export function registerNavigationGuard(guard: () => boolean): () => void {
  guards.add(guard); return () => { guards.delete(guard); };
}
export function allowNavigation(): boolean { return [...guards].every((guard) => guard()); }
