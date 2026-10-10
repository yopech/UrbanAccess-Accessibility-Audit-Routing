import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BrowserSttAdapter, type NativeRecognition, type RecognitionResultEvent, type SttAdapter, type SttEvent, type VoiceContext } from '../../src/voice/stt-adapter.js';
import { VoiceController } from '../../src/features/voice/voice-controller.js';
import type { VoiceDraft, VoiceDraftStore } from '../../src/voice/voice-drafts.js';
import { applyAuditCommands, createZ2Audit, type AuditCommand } from '../../src/domain/audit-model.js';
import { Z2_TEMPLATE } from '../../src/templates/z2-template.js';
class Recognition implements NativeRecognition {
  static last: Recognition;
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 0;
  onstart: NativeRecognition['onstart'] = null; onend: NativeRecognition['onend'] = null;
  onresult: NativeRecognition['onresult'] = null; onerror: NativeRecognition['onerror'] = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { Recognition.last = this; }
}
function context(): Omit<VoiceContext, 'sessionId'> { return { auditId: randomUUID(), zoneId: randomUUID(), elementId: randomUUID(), baseRevision: 1, mode: 'comment' }; }
function nativeSetup() {
  const adapter = new BrowserSttAdapter(() => Recognition); const events: SttEvent[] = []; adapter.subscribe((e) => events.push(e));
  const sessionId = randomUUID(); adapter.start({ sessionId, language: 'ru-RU', context: { ...context(), sessionId } });
  return { adapter, events, native: Recognition.last, sessionId };
}
function results(...entries: [string, boolean][]): RecognitionResultEvent { return { resultIndex: 0, results: entries.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })) }; }
class FakeAdapter implements SttAdapter {
  listener: ((event: SttEvent) => void) | undefined; session = ''; captured: Readonly<VoiceContext> | undefined;
  capability() { return { available: true, message: '' }; }
  subscribe(listener: (event: SttEvent) => void) { this.listener = listener; return () => { this.listener = undefined; }; }
  start(request: { sessionId: string; language: 'ru-RU'; context: Readonly<VoiceContext> }) { this.session = request.sessionId; this.captured = request.context; }
  stop = vi.fn(); abort = vi.fn();
  private finals = new Map<string, string>();
  emit(event: { type: 'final'; resultId: string; text: string } | { type: 'started' | 'ended' } | { type: 'error'; code: string; message: string }) { if (event.type === 'final') { this.finals.set(event.resultId, event.text); const finalSegments = [...this.finals].map(([resultId, text]) => ({ resultId, text })); this.listener?.({ type: 'transcript_update', sessionId: this.session, finalText: finalSegments.map((s) => s.text).join(' '), interimText: '', finalSegments }); } else this.listener?.({ ...event, sessionId: this.session }); }
}
function setup() {
  const adapter = new FakeAdapter(); const saved = new Map<string, VoiceDraft>();
  const store: VoiceDraftStore = { save: vi.fn(async (draft) => { saved.set(draft.id, structuredClone(draft)); }), list: async () => [...saved.values()] };
  const controller = new VoiceController({ adapter, store, uuid: randomUUID }); controller.start(context());
  return { adapter, saved, store, controller };
}
afterEach(() => vi.useRealTimers());
describe('Web Speech adapter', () => {
  it.each([
    ['1 2 3 4 5', 'Раз два три четыре пять проверка'],
    ['1 2 3 4 5 вышел зайчик', 'Раз два три четыре пять вышел зайчик погулять'],
    ['ширина проёма 85 сантиметров', 'Ширина проёма 85 см'],
    ['порог 20 см', 'порог 2 см'],
  ])('cumulative engine replaces a revised hypothesis (%s) with %s without persisting the previous wording', async (before, after) => {
    const writes: VoiceDraft[] = [];
    const controller = new VoiceController({adapter:new BrowserSttAdapter(()=>Recognition),store:{save:async draft=>{writes.push(structuredClone(draft));},list:async()=>writes.slice(-1)},uuid:randomUUID});
    controller.start(context()); const native=Recognition.last; native.onstart?.();
    native.onresult?.(results(['',true],['',true],[before,true]));
    native.onresult?.(results(['',true],['',true],[before,true],[after,true]));
    expect(controller.getSnapshot().interim).toBe(after);
    expect(controller.getSnapshot().draft?.reviewText).toBe('');
    expect(controller.getSnapshot().draft?.finalSegments).toEqual([]);
    const stopped=controller.stop();native.onend?.();await stopped;await controller.flush();
    expect(writes.at(-1)?.reviewText).toBe(after);
    expect(writes.at(-1)?.finalSegments).toEqual([{resultId:'2',text:after}]);
    await controller.dispose();
  });
  it('replays the actual Pixel 9 trace: advancing final indices contain cumulative hypotheses, not independent phrases', async () => {
    const trace = JSON.parse(readFileSync(new URL('../fixtures/pixel9-speech-results.json', import.meta.url), 'utf8')) as { resultIndex: number; results: {isFinal: boolean; text: string}[] }[];
    const writes: VoiceDraft[] = [];
    const controller = new VoiceController({ adapter: new BrowserSttAdapter(() => Recognition), store: {
      save: async draft => { writes.push(structuredClone(draft)); }, list: async () => writes.slice(-1),
    }, uuid: randomUUID });
    controller.start(context()); const native = Recognition.last; native.onstart?.();
    for (const event of trace) {
      native.onresult?.({resultIndex:event.resultIndex,results:event.results.map(result=>({isFinal:result.isFinal,0:{transcript:result.text}}))});
      expect(controller.getSnapshot().draft?.reviewText).toBe('');
      expect(controller.getSnapshot().draft?.finalSegments).toEqual([]);
    }
    expect(controller.getSnapshot().interim).toBe('ширина дверного проёма 85 см');
    native.onend?.(); await controller.flush();
    expect(writes.at(-1)?.reviewText).toBe('ширина дверного проёма 85 см');
    expect(writes.at(-1)?.finalSegments).toEqual([{resultId:'5',text:'ширина дверного проёма 85 см'}]);
    await controller.dispose();
  });
  it('quirk mode replaces the full hypothesis and preserves manual corrections at finalization', async () => {
    const controller = new VoiceController({ adapter: new BrowserSttAdapter(() => Recognition), store: {save:async()=>{},list:async()=>[]}, uuid:randomUUID });
    controller.start(context()); const native=Recognition.last; native.onstart?.();
    native.onresult?.(results(['',true],['',true],['ширина',true],['ширина 85 см',true],['ширина 85 см порог',true]));
    expect(controller.getSnapshot().draft?.reviewText).toBe('');
    controller.editReview('Ручная заметка инспектора');
    native.onresult?.(results(['',true],['',true],['ширина',true],['ширина 85 см',true],['ширина 85 см порог',true],['ширина 85 см порог 2 см',true],['ширина 85 см порог 2 см',true]));
    native.onend?.(); await controller.flush();
    expect(controller.getSnapshot().draft?.reviewText).toBe('Ручная заметка инспектора ширина 85 см порог 2 см');
    await controller.dispose();
  });
  it('15 growing mobile interim events never enter stored segments; repeated final and Stop produce one phrase', async () => {
    const writes: VoiceDraft[] = [];
    const store: VoiceDraftStore = { save: async (draft) => { writes.push(structuredClone(draft)); }, list: async () => [] };
    const controller = new VoiceController({ adapter: new BrowserSttAdapter(() => Recognition), store, uuid: randomUUID });
    controller.start(context()); const native = Recognition.last; native.onstart?.();
    const phrase = 'ширина дверного проёма в свету 85 сантиметров есть замечание по доводчику требуется дополнительная проверка закрывания двери';
    const words = phrase.split(' ');
    for (let index = 1; index <= 15; index++) {
      const hypothesis = words.slice(0, index).join(' ');
      native.onresult?.(results([hypothesis, false]));
      await controller.flush();
      expect(controller.getSnapshot().interim).toBe(hypothesis);
      expect(writes.every((draft) => draft.finalSegments.length === 0 && draft.reviewText === '')).toBe(true);
    }
    const stopped = controller.stop();
    native.onresult?.(results([phrase, true])); native.onresult?.(results([phrase, true])); native.onend?.();
    await stopped; await controller.flush();
    expect(controller.getSnapshot().draft?.reviewText).toBe(phrase);
    expect(writes.at(-1)?.reviewText).toBe(phrase);
    expect(writes.at(-1)?.finalSegments).toEqual([{ resultId: '0', text: phrase }]);
    expect(native.stop).toHaveBeenCalledOnce(); await controller.dispose();
  });
  it.each([false, true])('keeps the last unfinalized tail exactly once on Stop (already final: %s)', async (alreadyFinal) => {
    const writes: VoiceDraft[] = [];
    const store: VoiceDraftStore = { save: async (draft) => { writes.push(structuredClone(draft)); }, list: async () => [] };
    const controller = new VoiceController({ adapter: new BrowserSttAdapter(() => Recognition), store, uuid: randomUUID });
    controller.start(context()); const native = Recognition.last; native.onstart?.();
    native.onresult?.(alreadyFinal ? results(['порог 2 см', true], ['порог 2 см', false]) : results(['ширина 85 см', true], ['порог 2 см', false]));
    expect(writes.every((draft) => !draft.finalSegments.some((s) => s.resultId === 'end-interim'))).toBe(true);
    const stopped = controller.stop(); const end = native.onend; end?.(); end?.(); await stopped; await controller.flush();
    const expected = alreadyFinal ? 'порог 2 см' : 'ширина 85 см порог 2 см';
    expect(writes.at(-1)?.reviewText).toBe(expected); expect(controller.getSnapshot().interim).toBe('');
    await controller.dispose();
  });
  it('reports absent API without constructing anything or crashing', () => { const adapter = new BrowserSttAdapter(() => undefined); expect(adapter.capability().available).toBe(false); expect(adapter.capability().message).toContain('клавиатуры'); });
  it('starts RU only on explicit request, and emits interim separately', () => { vi.useFakeTimers(); const { native, events } = nativeSetup(); expect(native.lang).toBe('ru-RU'); expect(native.start).toHaveBeenCalledOnce(); native.onstart?.(); native.onresult?.(results(['порог', false])); expect(events.map((e) => e.type)).toEqual(['started', 'transcript_update']); });
  it('growing interim preview replaces text and persists only deduplicated spaced finals', async () => {
    const saved = new Map<string, VoiceDraft>(); const store: VoiceDraftStore = { save: async (draft) => { saved.set(draft.id, structuredClone(draft)); }, list: async () => [...saved.values()] };
    const adapter = new BrowserSttAdapter(() => Recognition); const controller = new VoiceController({ adapter, store, uuid: randomUUID }); controller.start(context()); const native = Recognition.last; native.onstart?.();
    for (const text of ['нужно', 'нужно', 'нужно проверить', 'нужно проверить как']) { native.onresult?.(results([text, false])); expect(controller.getSnapshot().interim).toBe(text); expect(controller.getSnapshot().draft?.reviewText).toBe(''); }
    native.onresult?.(results(['нужно проверить как', true])); native.onresult?.(results(['нужно проверить как', true], ['открывается дверь', false]));
    expect(controller.getSnapshot().draft?.reviewText).toBe('нужно проверить как'); expect(controller.getSnapshot().interim).toBe('открывается дверь');
    native.onresult?.(results(['нужно проверить как', true], ['открывается дверь', true])); native.onresult?.(results(['нужно проверить как', true], ['открывается дверь', true])); native.onend?.(); await controller.flush();
    expect([...saved.values()][0]?.reviewText).toBe('нужно проверить как открывается дверь'); expect([...saved.values()][0]?.finalSegments).toHaveLength(2); expect(controller.getSnapshot().interim).toBe('');
  });
  it('replaces cumulative snapshots with a nonzero resultIndex and removes withdrawn interim without persisting it', async () => {
    const saved = new Map<string, VoiceDraft>(); const store: VoiceDraftStore = { save: async (draft) => { saved.set(draft.id, structuredClone(draft)); }, list: async () => [...saved.values()] };
    const controller = new VoiceController({ adapter: new BrowserSttAdapter(() => Recognition), store, uuid: randomUUID }); controller.start(context()); const native = Recognition.last; native.onstart?.();
    for (const text of ['я', 'я', 'я тестирую']) native.onresult?.(results([text, false]));
    native.onresult?.(results(['я тестирую', true]));
    const cumulative = { ...results(['я тестирую', true], ['голосовой ввод', true], ['лишний хвост', false]), resultIndex: 1 };
    native.onresult?.(cumulative); const version = controller.getSnapshot().draft?.version;
    native.onresult?.(cumulative); expect(controller.getSnapshot().draft?.version).toBe(version);
    expect(controller.getSnapshot().draft?.reviewText).toBe('я тестирую голосовой ввод'); expect(controller.getSnapshot().interim).toBe('лишний хвост');
    native.onresult?.({ ...results(['я тестирую', true], ['голосовой ввод', true]), resultIndex: 2 });
    expect(controller.getSnapshot().interim).toBe(''); native.onend?.(); await controller.flush();
    expect([...saved.values()][0]?.reviewText).toBe('я тестирую голосовой ввод'); expect([...saved.values()][0]?.finalSegments.map((s) => s.resultId)).toEqual(['0', '1']);
  });
  it('AC-10: deduplicates cumulative final result indices, without losing equal phrases at different indices', () => {
    const { native, events } = nativeSetup(); native.onresult?.(results(['дверь', true])); native.onresult?.(results(['дверь', true], ['дверь', true])); native.onresult?.(results(['дверь', true], ['дверь', true]));
    expect(events.filter((e) => e.type === 'transcript_update').map((e) => e.finalText)).toEqual(['дверь', 'дверь дверь', 'дверь дверь']);
  });
  it('soft stop accepts final results before end and stops once', () => { const { adapter, native, events } = nativeSetup(); adapter.stop(); adapter.stop(); native.onresult?.(results(['итог', true])); native.onend?.(); expect(native.stop).toHaveBeenCalledOnce(); expect(events.some((e) => e.type === 'transcript_update' && e.finalText === 'итог')).toBe(true); expect(events.at(-1)?.type).toBe('ended'); });
  it('adapter independently enforces a 60-second soft stop', async () => { vi.useFakeTimers(); const { adapter, native } = nativeSetup(); native.onstart?.(); await vi.advanceTimersByTimeAsync(60_000); expect(native.stop).toHaveBeenCalledOnce(); adapter.abort(); });
  it('abort invalidates captured callbacks and old-session results', () => { const { adapter, native, events } = nativeSetup(); const late = native.onresult; adapter.abort(); late?.(results(['запоздало', true])); expect(events).toEqual([]); expect(native.abort).toHaveBeenCalledOnce(); });
  it.each(['not-allowed', 'network', 'no-speech'])('handles %s without automatic retries', (code) => { const { native, events } = nativeSetup(); native.onerror?.({ error: code }); expect(events.at(-1)).toMatchObject({ type: 'error', code }); expect(native.start).toHaveBeenCalledOnce(); expect(native.onresult).toBeNull(); });
});
describe('Voice session controller', () => {
  it('AC-09: soft stop and late final retain immutable original card context', async () => {
    const { controller, adapter, saved } = setup(); const captured = structuredClone(adapter.captured); adapter.emit({ type: 'started' }); const done = controller.stop();
    adapter.emit({ type: 'final', resultId: '0', text: 'Исходная дверь' }); adapter.emit({ type: 'ended' }); await done; await controller.flush();
    const draft = [...saved.values()][0]!; expect(draft.context).toEqual(captured); expect(draft.reviewText).toBe('Исходная дверь'); expect(controller.getSnapshot().state).toBe('review');
  });
  it('warns at 50 sec and softly stops at 60 sec with a bounded finalization window', async () => {
    vi.useFakeTimers(); const { controller, adapter } = setup(); adapter.emit({ type: 'started' }); await vi.advanceTimersByTimeAsync(50_000); expect(controller.getSnapshot().warning).toBe(true); expect(adapter.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000); expect(adapter.stop).toHaveBeenCalledOnce(); expect(controller.getSnapshot().state).toBe('stopping');
    await vi.advanceTimersByTimeAsync(5000); expect(controller.getSnapshot().state).toBe('review'); expect(adapter.abort).toHaveBeenCalledOnce();
  });
  it('bounds unanswered permission requests without retrying', async () => { vi.useFakeTimers(); const { controller, adapter } = setup(); await vi.advanceTimersByTimeAsync(15_000); expect(controller.getSnapshot().state).toBe('error'); expect(adapter.abort).toHaveBeenCalledOnce(); });
  it('AC-08: refusal keeps editable draft and never changes a confirmed field', async () => { const { controller, adapter, saved } = setup(); adapter.emit({ type: 'error', code: 'not-allowed', message: 'Введите вручную' }); controller.editReview('Ручной текст'); await controller.flush(); expect([...saved.values()][0]?.reviewText).toBe('Ручной текст'); expect(controller.getSnapshot().error).toBe('Введите вручную'); });
  it('deduplicates final events at controller boundary and preserves review edits', async () => { const { controller, adapter } = setup(); adapter.emit({ type: 'started' }); adapter.emit({ type: 'final', resultId: '0', text: 'Ошибка' }); controller.editReview('Исправлено'); adapter.emit({ type: 'final', resultId: '0', text: 'Ошибка' }); adapter.emit({ type: 'final', resultId: '1', text: 'Продолжение' }); adapter.emit({ type: 'ended' }); await controller.flush(); expect(controller.getSnapshot().draft?.reviewText).toBe('Исправлено Продолжение'); });
  it('draft save failure blocks update and allows retry without losing text', async () => {
    const { controller, adapter, store } = setup(); adapter.emit({ type: 'started' }); adapter.emit({ type: 'final', resultId: '0', text: 'Текст' }); adapter.emit({ type: 'ended' }); vi.mocked(store.save).mockRejectedValue(new Error('Нет места'));
    expect(await controller.prepareUpdate()).toBe(false); expect(controller.getSnapshot().draft?.reviewText).toBe('Текст'); controller.releaseUpdate(); vi.mocked(store.save).mockImplementation(async () => {}); expect(await controller.retry()).toBe(true);
  });
  it('update preparation waits for final results and persistence, and locks new recording until release', async () => {
    const { controller, adapter } = setup(); adapter.emit({ type: 'started' }); let finished = false;
    const update = controller.prepareUpdate().then((saved) => { finished = true; return saved; }); await Promise.resolve();
    expect(finished).toBe(false); expect(adapter.stop).toHaveBeenCalledOnce(); expect(() => controller.start(context())).toThrow();
    adapter.emit({ type: 'final', resultId: '0', text: 'Перед обновлением' }); adapter.emit({ type: 'ended' }); expect(await update).toBe(true);
    expect(() => controller.start(context())).toThrow(); controller.releaseUpdate(); expect(() => controller.start(context())).not.toThrow(); controller.abort(); await controller.flush();
  });
  it('cancel ignores delayed results and restore never starts recording', async () => { const { controller, adapter, saved } = setup(); adapter.emit({ type: 'started' }); adapter.emit({ type: 'final', resultId: '0', text: 'Черновик' }); controller.abort(); adapter.emit({ type: 'final', resultId: '1', text: 'Лишнее' }); await controller.flush(); await controller.resume([...saved.values()][0]!); expect(controller.getSnapshot().draft?.reviewText).toBe('Черновик'); expect(controller.getSnapshot().state).toBe('review'); });
  it('resuming a stale list item opens the latest stored correction rather than overwriting it', async () => {
    const { controller, adapter, saved } = setup(); adapter.emit({ type: 'started' }); adapter.emit({ type: 'final', resultId: '0', text: 'Исходное' }); adapter.emit({ type: 'ended' }); await controller.flush();
    const stale = structuredClone([...saved.values()][0]!); controller.editReview('Исправлено позднее'); await controller.flush(); await controller.resume(stale);
    expect(controller.getSnapshot().draft?.reviewText).toBe('Исправлено позднее');
  });
  it('AC-07: append to latest manual text and recommendations without extracting numeric measurements', () => {
    const actor = { id: randomUUID(), name: 'Инспектор' }; const at = new Date().toISOString();
    const audit = createZ2Audit({ object: { name: 'Школа', address: 'Москва' }, inspectedOn: '2026-10-10', author: actor, purpose: 'Проверка входа' }, { auditId: randomUUID(), objectId: randomUUID(), zoneId: randomUUID(), elementIds: Z2_TEMPLATE.elements.map(() => randomUUID()) }, at);
    const element = Object.values(audit.elements)[0]!;
    const commands: AuditCommand[] = [{ type: 'updateElement', elementId: element.id, patch: { comment: 'Ввёл вручную во время записи' } },
      { type: 'applyVoiceDraft', draftId: randomUUID(), draftVersion: 4, elementId: element.id, mode: 'comment', text: 'Порог 20 миллиметров', recommendationId: randomUUID() },
      { type: 'applyVoiceDraft', draftId: randomUUID(), draftVersion: 2, elementId: element.id, mode: 'recommendation', text: 'Установить поручень', recommendationId: randomUUID() }];
    const result = applyAuditCommands(audit, commands, { auditId: audit.id, actor, transactionId: randomUUID(), revision: 2, committedAt: at });
    expect(result.elements[element.id]?.comment).toBe('Ввёл вручную во время записи\nПорог 20 миллиметров'); expect(result.measurements).toEqual({}); expect(Object.values(result.recommendations)[0]?.text).toBe('Установить поручень'); expect(audit.elements[element.id]?.comment).toBe('');
  });
});
