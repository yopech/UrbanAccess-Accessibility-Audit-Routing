import type { Audit, AuditCommand } from '../../domain/audit-model.js';
import type { UUID } from '../../domain/contracts.js';
import type { EditorController } from '../editor/editor-controller.js';
import { BrowserSttAdapter, type SttAdapter, type SttEvent, type VoiceContext } from '../../voice/stt-adapter.js';
import { voiceDrafts, validateVoiceDraft, type VoiceDraft, type VoiceDraftStore } from '../../voice/voice-drafts.js';
export type VoiceState = 'idle' | VoiceDraft['state'];
export interface VoiceSnapshot {
  state: VoiceState; draft: Readonly<VoiceDraft> | undefined; open: boolean; interim: string;
  elapsed: number; warning: boolean; error: string; persistenceError: string; saving: boolean; applying: boolean; applicationPending: boolean;
}
export interface VoiceOptions { adapter?: SttAdapter; store?: VoiceDraftStore; now?: () => number; uuid?: () => UUID; }
const activeStates: readonly VoiceState[] = ['requesting', 'listening', 'stopping'];
/** One controller outlives individual accordion cards. No session is restarted automatically. */
export class VoiceController {
  private readonly adapter: SttAdapter;
  private readonly store: VoiceDraftStore;
  private readonly now: () => number;
  private readonly uuid: () => UUID;
  private snapshot: VoiceSnapshot = { state: 'idle', draft: undefined, open: false, interim: '', elapsed: 0, warning: false, error: '', persistenceError: '', saving: false, applying: false, applicationPending: false };
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private startedAt = 0;
  private manuallyEdited = false;
  private queue: Promise<void> = Promise.resolve();
  private persisted = new Map<string, number>();
  private finishWait: Promise<void> | undefined;
  private finishResolve: (() => void) | undefined;
  private updateLocked = false;
  constructor(options: VoiceOptions = {}) {
    this.adapter = options.adapter ?? new BrowserSttAdapter(); this.store = options.store ?? voiceDrafts;
    this.now = options.now ?? Date.now; this.uuid = options.uuid ?? (() => crypto.randomUUID());
    this.unsubscribe = this.adapter.subscribe((event) => this.receive(event));
  }
  capability() { return this.adapter.capability(); }
  getSnapshot = (): VoiceSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<VoiceSnapshot>): void { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) { try { listener(); } catch { /* Observers cannot interrupt microphone cleanup. */ } } }
  private changeDraft(patch: Partial<VoiceDraft>): void {
    const draft = this.snapshot.draft; if (!draft) return;
    const next = { ...draft, ...patch, version: draft.version + 1, updatedAt: new Date(this.now()).toISOString() };
    this.publish({ draft: next, state: next.state }); this.persist(next);
  }
  private persist(input: Readonly<VoiceDraft>): void {
    const draft = structuredClone(input); this.publish({ saving: true });
    this.queue = this.queue.then(async () => {
      try {
        await this.store.save(draft); this.persisted.set(draft.id, draft.version);
        if (this.snapshot.draft?.id === draft.id) this.publish({ persistenceError: '' });
      } catch (cause) {
        if (this.snapshot.draft?.id === draft.id) this.publish({ persistenceError: cause instanceof Error ? cause.message : 'Черновик пока не сохранён. Оставьте панель открытой и повторите сохранение.' });
      }
    }).then(() => { const current = this.snapshot.draft; this.publish({ saving: !!current && (this.persisted.get(current.id) ?? 0) < current.version }); });
  }
  start(context: Omit<VoiceContext, 'sessionId'>): void {
    if (this.updateLocked || activeStates.includes(this.snapshot.state) || (this.snapshot.applying || this.snapshot.applicationPending)) throw new Error('Сначала завершите текущую диктовку.');
    if (this.hasUnsavedDraft()) throw new Error('Сначала сохраните текущий черновик.');
    this.manuallyEdited = false;
    const sessionId = this.uuid(); const at = new Date(this.now()).toISOString();
    const captured = Object.freeze({ ...context, sessionId });
    const draft: VoiceDraft = { id: sessionId, sessionId, auditId: context.auditId, elementId: context.elementId, context: captured,
      state: 'requesting', finalSegments: [], reviewText: '', version: 1, createdAt: at, updatedAt: at };
    validateVoiceDraft(draft);
    this.publish({ state: 'requesting', draft, open: true, interim: '', elapsed: 0, warning: false, error: '', persistenceError: '' }); this.persist(draft);
    this.finishWait = new Promise<void>((resolve) => { this.finishResolve = resolve; });
    this.deadline = setTimeout(() => this.fail('Браузер не начал запись. Проверьте разрешение микрофона или продолжите вручную.'), 15_000);
    // Keep start synchronous in the click handler: Safari requires a user gesture.
    try { this.adapter.start({ sessionId, language: 'ru-RU', context: captured }); }
    catch (cause) { this.fail(cause instanceof Error ? cause.message : 'Не удалось включить микрофон.'); }
  }
  private receive(event: SttEvent): void {
    const draft = this.snapshot.draft;
    if (!draft || draft.sessionId !== event.sessionId || !activeStates.includes(this.snapshot.state)) return;
    switch (event.type) {
      case 'started': {
        if (this.snapshot.state !== 'requesting') return;
        clearTimeout(this.deadline); this.startedAt = this.now(); this.changeDraft({ state: 'listening' });
        this.timer = setInterval(() => {
          const elapsed = Math.min(60, Math.floor((this.now() - this.startedAt) / 1000));
          this.publish({ elapsed, warning: elapsed >= 50 }); if (elapsed >= 60) void this.stop();
        }, 1000); break;
      }
      case 'transcript_update': {
        const finalSegments = event.finalSegments.map((segment) => ({ ...segment }));
        this.publish({ interim: event.interimText });
        if (JSON.stringify(finalSegments) === JSON.stringify(draft.finalSegments)) break;
        // Speech replaces speech. Explicit manual corrections are retained; only
        // newly finalized indices may be added to the inspector's edited text.
        const additional = finalSegments.filter((segment) => !draft.finalSegments.some((old) => old.resultId === segment.resultId)).map((segment) => segment.text).join(' ');
        // Derive persisted text only from finalized segments, never from the
        // adapter's display text or interim hypotheses.
        const reviewText = this.manuallyEdited ? (additional ? [draft.reviewText.trimEnd(), additional].filter(Boolean).join(' ') : draft.reviewText) : finalSegments.map((segment) => segment.text).join(' ');
        this.changeDraft({ finalSegments, reviewText }); break;
      }
      case 'ended': this.finish('review'); break;
      case 'error': this.fail(event.message); break;
    }
  }
  private clearTimers(): void { clearInterval(this.timer); clearTimeout(this.deadline); this.timer = undefined; this.deadline = undefined; }
  private finish(state: 'review' | 'error' | 'cancelled'): void {
    const draft = this.snapshot.draft;
    // Promote the last volatile tail exactly once, only after recognition ends.
    // Some browsers end without issuing a final result for this last phrase.
    const tail = this.snapshot.interim.trim();
    const finalText = draft?.finalSegments.map((segment) => segment.text).join(' ') ?? '';
    const normalized = (text: string) => text.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim();
    const alreadyFinal = !!tail && (normalized(finalText) === normalized(tail) || normalized(finalText).endsWith(` ${normalized(tail)}`));
    const finalSegments = draft ? [...draft.finalSegments] : [];
    if (tail && !alreadyFinal && state !== 'cancelled') finalSegments.push({ resultId: 'end-interim', text: tail });
    const reviewText = this.manuallyEdited ? [draft?.reviewText.trimEnd(), tail && !alreadyFinal && state !== 'cancelled' ? tail : ''].filter(Boolean).join(' ') : finalSegments.map((segment) => segment.text).join(' ');
    this.clearTimers(); this.publish({ interim: '' }); this.changeDraft({ state, finalSegments, reviewText });
    this.finishResolve?.(); this.finishResolve = undefined; this.finishWait = undefined;
  }
  private fail(message: string): void { this.adapter.abort(); this.publish({ error: message }); this.finish('error'); }
  /** Soft stop preserves final results for the captured context, even after its card closes. */
  stop = (): Promise<void> => {
    if (!activeStates.includes(this.snapshot.state)) return Promise.resolve();
    const wait = this.finishWait ?? Promise.resolve();
    if (this.snapshot.state !== 'stopping') {
      this.clearTimers(); this.changeDraft({ state: 'stopping' });
      this.deadline = setTimeout(() => { this.adapter.abort(); this.publish({ error: 'Завершение записи заняло слишком долго. Сохранены уже полученные фрагменты.' }); this.finish('review'); }, 5000);
      try { this.adapter.stop(); } catch { this.fail('Не удалось корректно завершить запись. Проверьте уже полученный текст.'); }
    }
    return wait;
  };
  abort(): void { if (!activeStates.includes(this.snapshot.state)) return; this.adapter.abort(); this.finish('cancelled'); }
  editReview(text: string): void { if (!this.snapshot.draft || this.snapshot.applying || this.snapshot.applicationPending || (this.snapshot.state === 'applied' || this.snapshot.state === 'discarded') || this.updateLocked) return; this.manuallyEdited = true; this.changeDraft({ reviewText: text }); }
  async dismiss(): Promise<void> { await this.stop(); if (this.snapshot.applying || this.snapshot.applicationPending || this.updateLocked) return; this.changeDraft({ state: 'discarded' }); if (await this.flush()) this.publish({ open: false }); }
  close(): void { void this.stop(); this.publish({ open: false }); }
  async resume(draft: VoiceDraft): Promise<void> {
    await this.stop(); if (!(await this.flush()) || this.updateLocked || (this.snapshot.applying || this.snapshot.applicationPending)) throw new Error('Сначала сохраните текущий черновик.');
    validateVoiceDraft(draft);
    const latest = (await this.store.list(draft.auditId)).find((item) => item.id === draft.id);
    if (!latest) throw new Error('Черновик больше недоступен на устройстве.');
    validateVoiceDraft(latest); if (latest.appliedAt || ['applied', 'discarded'].includes(latest.state)) throw new Error('Этот черновик уже добавлен.');
    const value = structuredClone(latest); value.context = Object.freeze(value.context); this.persisted.set(value.id, value.version);
    this.publish({ draft: value, state: value.state, open: true, interim: '', elapsed: 0, warning: false, error: '', persistenceError: '' });
    // A restored recording is text for review. It never turns on the microphone.
    if (!['review', 'error'].includes(value.state)) this.changeDraft({ state: 'review' });
  }
  list(auditId: string) { return this.store.list(auditId); }
  hasUnsavedDraft(): boolean { const draft = this.snapshot.draft; return !!draft && (this.persisted.get(draft.id) ?? 0) < draft.version; }
  hasPendingWork(): boolean { return activeStates.includes(this.snapshot.state) || this.hasUnsavedDraft() || this.snapshot.applying; }
  async flush(): Promise<boolean> { await this.queue; return !this.hasUnsavedDraft(); }
  async retry(): Promise<boolean> { const draft = this.snapshot.draft; if (draft) this.persist(draft); return this.flush(); }
  async apply(editor: EditorController<Audit, AuditCommand>): Promise<boolean> {
    if (this.snapshot.applying || this.updateLocked) return false;
    this.publish({ applying: true, error: '' });
    try {
      await this.stop(); if (!(await this.flush())) return false;
      const draft = this.snapshot.draft; if (!draft || !draft.reviewText.trim()) throw new Error('Введите или продиктуйте текст для добавления.');
      const stored = (await this.store.list(draft.auditId)).find((item) => item.id === draft.id);
      if (stored?.appliedAt) { this.persisted.set(stored.id, stored.version); this.publish({ draft: stored, state: 'applied', open: false, applicationPending: false }); return true; }
      const current = editor.getSnapshot().value;
      if (current.id !== draft.auditId || current.elements[draft.elementId]?.zoneId !== draft.context.zoneId) throw new Error('Исходная карточка больше недоступна. Текст остаётся в черновике.');
      if (!editor.hasPendingCommand((command) => command.type === 'applyVoiceDraft' && command.draftId === draft.id)) {
        if ((await editor.flush()).kind !== 'saved') throw new Error('Сначала завершите сохранение карточки или разрешите конфликт.');
        editor.enqueue({ type: 'applyVoiceDraft', draftId: draft.id, draftVersion: draft.version, elementId: draft.elementId,
          mode: draft.context.mode, text: draft.reviewText, recommendationId: this.uuid() }); this.publish({ applicationPending: true });
      }
      const result = editor.getSnapshot().saveState.kind === 'error' ? await editor.retry() : await editor.flush();
      if (result.kind !== 'saved') throw new Error('Добавление пока не сохранено. Черновик остаётся доступным; завершите сохранение или разрешите конфликт.');
      const applied = (await this.store.list(draft.auditId)).find((item) => item.id === draft.id);
      if (!applied?.appliedAt) throw new Error('Не удалось подтвердить добавление черновика.');
      this.persisted.set(applied.id, applied.version); this.publish({ draft: applied, state: 'applied', open: false, applicationPending: false }); return true;
    } catch (cause) { this.publish({ error: cause instanceof Error ? cause.message : 'Не удалось добавить текст.' }); return false; }
    finally { this.publish({ applying: false }); }
  }
  async prepareUpdate(): Promise<boolean> { this.updateLocked = true; await this.stop(); return !this.snapshot.applying && await this.flush(); }
  releaseUpdate(): void { this.updateLocked = false; }
  /** Cleanup waits for late finals and their storage transactions before removing listeners. */
  async dispose(): Promise<void> { await this.stop(); await this.flush(); this.unsubscribe(); this.listeners.clear(); }
}
