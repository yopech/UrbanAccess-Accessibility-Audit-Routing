import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FieldProposals } from './field-proposals.js';
import { Mic, Square, X } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { MediaButton } from '../editor/photo-picker.js';
import type { Audit, AuditCommand, Element } from '../../domain/audit-model.js';
import type { EditorController } from '../editor/editor-controller.js';
import { VoiceController, type VoiceState } from './voice-controller.js';
import type { VoiceDraft } from '../../voice/voice-drafts.js';
function HighlightedTranscript({ text }: { text: string }) {
  return <>{text.split(/(\d+(?:[.,]\d+)?|(?<![а-яё])(?:ноль|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто|полтора|целых|десятых|сотых)(?![а-яё]))/gi).map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : part)}</>;
}
const focusOrigins = new WeakMap<VoiceController, HTMLElement>();
function rememberFocus(controller: VoiceController): void { if (document.activeElement instanceof HTMLElement) focusOrigins.set(controller, document.activeElement); }
const labels: Record<VoiceState, string> = { idle: 'Диктовка', requesting: 'Запрос доступа к микрофону', listening: 'Идёт запись', stopping: 'Завершение записи', review: 'Проверка текста', error: 'Проверка текста после остановки', cancelled: 'Запись отменена', discarded: 'Черновик отклонён', applied: 'Текст добавлен' };
export function DictationButton({ audit, element, mode, controller, baseRevision }: { baseRevision: number; audit: Audit; element: Element; mode: 'comment' | 'recommendation'; controller: VoiceController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const capability = controller.capability(); const [error, setError] = useState('');
  return <><MediaButton label={`Диктовать ${mode === 'comment' ? 'комментарий' : 'рекомендацию'}`} icon={Mic}
    disabled={!capability.available || ['requesting', 'listening', 'stopping'].includes(state.state) || state.applying}
    onClick={() => { try { rememberFocus(controller); controller.start({ auditId: audit.id, zoneId: element.zoneId, elementId: element.id, baseRevision, mode }); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Сначала завершите сохранение черновика.'); } }} />
    {!capability.available && mode === 'comment' && <p className="secondary-text">{capability.message}</p>}{error && <p role="alert" className="field-error">{error}</p>}</>;
}
export function DictationPanel({ controller, editor }: { controller: VoiceController; editor: EditorController<Audit, AuditCommand> }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const draft = state.draft; const recording = ['requesting', 'listening', 'stopping'].includes(state.state);
  const trigger = useRef<HTMLElement | null>(null);
  const element = draft ? editor.getSnapshot().value.elements[draft.elementId] : undefined;
  return <Dialog.Root open={state.open} onOpenChange={(open) => { if (!open) controller.close(); }}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content dictation-dialog"
      onOpenAutoFocus={() => { trigger.current = focusOrigins.get(controller) ?? document.activeElement as HTMLElement | null; }}
      onCloseAutoFocus={(event) => { event.preventDefault(); const origin = trigger.current; const target = origin?.isConnected && !(origin instanceof HTMLButtonElement && origin.disabled) ? origin : document.getElementById('zone-heading'); target?.focus(); }}>
      <Dialog.Close asChild><button type="button" className="voice-sheet-close" aria-label="Закрыть панель"><span><X size={18} strokeWidth={2.5} aria-hidden /></span></button></Dialog.Close>
      <div className="dictation-scroll">
      <Dialog.Title>Диктовка {draft?.context.mode === 'recommendation' ? 'рекомендации' : 'комментария'}</Dialog.Title>
      <Dialog.Description>{element?.name || 'Карточка элемента'}. Проверьте текст перед добавлением.</Dialog.Description>
      <div className="dictation-status-row"><p role="status" aria-live="polite" aria-atomic="true">{labels[state.state]}{state.warning && state.state === 'listening' ? '. Запись завершится через 10 секунд или раньше.' : ''}</p>{state.state === 'listening' && <span className="dictation-wave" aria-hidden>{Array.from({length: 9}, (_, index) => <i key={index} style={{animationDelay: `${index * 0.08}s`}} />)}</span>}</div>
      <p aria-live="off" className="dictation-timer">Время записи: {state.elapsed} сек. Максимум 60 секунд.</p>
      {state.state === 'requesting' && <p>Разрешите микрофон в запросе браузера. Запись начнётся после разрешения.</p>}
      {recording && <><p aria-live="off" className="dictation-transcript"><HighlightedTranscript text={[draft?.reviewText, state.interim].filter(Boolean).join(' ') || 'Говорите, текст появится здесь'} /></p></>}
      {state.error && <p role="alert" className="field-error">{state.error}</p>}
      <label className="dictation-review-field">Текст для проверки<textarea value={draft?.reviewText ?? ''} disabled={state.applying || state.applicationPending || state.state === 'applied'} onChange={(event) => controller.editReview(event.target.value)} placeholder="Полученный текст можно исправить с клавиатуры" /></label>
      {draft && draft.context.mode === 'comment' && !recording && state.state !== 'applied' && state.state !== 'discarded' && <FieldProposals key={draft.id} transcript={draft.reviewText} auditId={draft.auditId} zoneId={draft.context.zoneId} elementId={draft.elementId} editor={editor} disabled={state.applying || state.applicationPending || !!state.persistenceError} />}
      <p className="secondary-text">{controller.capability().message}</p>
      <p aria-live="off">{state.persistenceError ? 'Черновик пока не сохранён.' : state.saving ? 'Сохраняем черновик' : 'Черновик сохранён на устройстве'}</p>
      {state.persistenceError && <><p role="alert" className="field-error">{state.persistenceError}</p><Button onClick={() => { void controller.retry(); }}>Повторить сохранение черновика</Button></>}
      {!recording && <Button disabled={state.applying || state.applicationPending} onClick={() => { void controller.dismiss(); }}>Не использовать этот черновик</Button>}
      </div><div className="dictation-footer">
      {recording ? <Button variant="primary" className="dictation-stop" disabled={state.state === 'stopping'} onClick={() => { void controller.stop(); }}><Square aria-hidden />Остановить запись</Button> : <Button variant="primary" disabled={recording || state.applying || !draft?.reviewText.trim() || !!state.persistenceError || state.state === 'applied'} onClick={() => { void controller.apply(editor); }}>
        {state.applying ? 'Сохраняем добавленный текст' : `Добавить к ${draft?.context.mode === 'recommendation' ? 'рекомендации' : 'комментарию'}`}</Button>}
      {!recording && <Dialog.Close asChild><Button className="dictation-done" disabled={state.applying || state.applicationPending}>Готово</Button></Dialog.Close>}
      </div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
export function VoiceDraftSheet({ audit, controller, open, onClose, onCountChange }: { audit: Audit; controller: VoiceController; open: boolean; onClose: () => void; onCountChange: (count: number) => void }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [drafts, setDrafts] = useState<VoiceDraft[]>([]); const [error, setError] = useState('');
  useEffect(() => { let active = true; void controller.list(audit.id).then((values) => { if (active) setDrafts(values.filter((draft) => !draft.appliedAt && draft.state !== 'discarded' && (draft.reviewText.trim() || draft.finalSegments.length))); }, (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось открыть черновики.'); }); return () => { active = false; }; }, [audit.id, controller, snapshot.draft?.updatedAt, snapshot.saving, snapshot.state]);
  useEffect(() => { onCountChange(drafts.length); }, [drafts.length, onCountChange]);
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!value) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content voice-draft-sheet rounded-t-[20px]" onCloseAutoFocus={(event) => { event.preventDefault(); document.querySelector<HTMLButtonElement>('.drafts-trigger')?.focus(); }}>
    <Dialog.Title>Черновики диктовки</Dialog.Title><Dialog.Description>Откройте запись, чтобы проверить текст и добавить его в исходную карточку.</Dialog.Description>
    <Dialog.Close asChild><button type="button" className="voice-sheet-close" aria-label="Закрыть черновики"><span><X size={18} strokeWidth={2.5} aria-hidden /></span></button></Dialog.Close>
    {drafts.length === 0 && !error && <p>Нет черновиков для проверки.</p>}
    {drafts.length > 0 && <section className="notice" aria-label="Черновики диктовки"><h3>Черновики диктовки для проверки</h3>{drafts.map((draft) => <Button key={draft.id} disabled={audit.archivedAt !== undefined || snapshot.applying || ['requesting', 'listening', 'stopping'].includes(snapshot.state)} onClick={() => { rememberFocus(controller); void controller.resume(draft).then(onClose).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Не удалось открыть черновик.')); }}>Открыть черновик: {audit.elements[draft.elementId]?.name || 'элемент'}, {draft.context.mode === 'comment' ? 'комментарий' : 'рекомендация'}, {new Date(draft.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Button>)}</section>}
    {error && <p role="alert" className="field-error">{error}</p>}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
