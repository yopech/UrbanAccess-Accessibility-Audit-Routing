import type { UUID } from '../domain/contracts.js';
export interface VoiceContext { sessionId: UUID; auditId: UUID; zoneId: UUID; elementId: UUID; baseRevision: number; mode: 'comment' | 'recommendation'; }
export type SttEvent =
  | { type: 'started' | 'ended'; sessionId: UUID }
  | { type: 'transcript_update'; sessionId: UUID; finalText: string; interimText: string; finalSegments: readonly { resultId: string; text: string }[] }
  | { type: 'error'; sessionId: UUID; code: string; message: string };
export interface SttAdapter {
  capability(): { available: boolean; message: string };
  subscribe(listener: (event: SttEvent) => void): () => void;
  start(request: { sessionId: UUID; language: 'ru-RU'; context: Readonly<VoiceContext> }): void;
  stop(): void;
  abort(): void;
}
interface RecognitionResult { isFinal: boolean; readonly [index: number]: { transcript: string }; }
export interface RecognitionResultEvent { resultIndex: number; results: { length: number; readonly [index: number]: RecognitionResult }; }
export interface NativeRecognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onstart: (() => void) | null; onend: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null; onerror: ((event: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionConstructor = new () => NativeRecognition;
function browserConstructor(): RecognitionConstructor | undefined {
  const root = globalThis as typeof globalThis & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return root.SpeechRecognition ?? root.webkitSpeechRecognition;
}
export function speechError(code: string): string {
  const messages: Record<string, string> = {
    'not-allowed': 'Доступ к микрофону не разрешён. Можно продолжить ввод с клавиатуры или разрешить микрофон в настройках браузера.',
    'service-not-allowed': 'Браузер запретил распознавание речи. Продолжите ввод с клавиатуры.',
    network: 'Сервис распознавания недоступен по сети. Уже полученный текст остаётся в черновике; можно продолжить вручную.',
    'no-speech': 'Речь не обнаружена. Введите текст вручную или начните новую запись.',
    'audio-capture': 'Микрофон недоступен. Проверьте устройство или введите текст вручную.',
    aborted: 'Запись отменена. Уже полученные фрагменты остаются в черновике.',
    unsupported: 'Этот браузер не поддерживает диктовку. Все поля можно заполнить с клавиатуры.',
  };
  return messages[code] ?? 'Не удалось завершить распознавание. Полученный текст остаётся в черновике; ручной ввод доступен.';
}
export class BrowserSttAdapter implements SttAdapter {
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<(event: SttEvent) => void>();
  private active: { recognition: NativeRecognition; sessionId: UUID; stopping: boolean; started: boolean } | undefined;
  constructor(private readonly getConstructor = browserConstructor) {}
  capability() { const available = typeof this.getConstructor() === 'function'; return { available, message: available ? 'Распознавание может требовать сеть и обработку речи сервисом браузера. Приложение не сохраняет аудиозапись.' : speechError('unsupported') }; }
  subscribe(listener: (event: SttEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: SttEvent): void { for (const listener of this.listeners) { try { listener(event); } catch { /* Observers cannot keep the microphone running. */ } } }
  private detach(recognition: NativeRecognition): void { recognition.onstart = null; recognition.onresult = null; recognition.onend = null; recognition.onerror = null; }
  start(request: { sessionId: UUID; language: 'ru-RU'; context: Readonly<VoiceContext> }): void {
    if (this.active) throw new Error('Сначала завершите текущую запись.');
    const Constructor = this.getConstructor(); if (!Constructor) { this.emit({ type: 'error', sessionId: request.sessionId, code: 'unsupported', message: speechError('unsupported') }); return; }
    if (request.context.sessionId !== request.sessionId) throw new Error('Неверный контекст диктовки.');
    let recognition: NativeRecognition;
    try { recognition = new Constructor(); } catch { this.emit({ type: 'error', sessionId: request.sessionId, code: 'start-failed', message: speechError('start-failed') }); return; }
    const session = { recognition, sessionId: request.sessionId, stopping: false, started: false }; this.active = session;
    // Indexed session state. Interim hypotheses never enter this map.
    const finalByIndex = new Map<number, string>();
    const emptyFinalIndices = new Set<number>();
    let sawInterim = false;
    let cumulativeMode = false;
    // Recorded Pixel 9 trace: several empty "finals", then full growing
    // hypotheses, each marked final at a new index. These are not utterances.
    const publishTranscript = (ended = false, interimText = '') => {
      const ordered = [...finalByIndex].sort(([a], [b]) => a - b);
      const firstIndex = ordered[0]?.[0] ?? Infinity;
      const cumulativeFinals = !sawInterim && [...emptyFinalIndices].filter((index) => index < firstIndex).length >= 2;
      cumulativeMode = cumulativeFinals;
      const latest = ordered.at(-1)?.[1] ?? '';
      // In the recorded anomalous stream every index is another version of
      // the whole utterance, not a new segment. Revisions can replace words,
      // punctuation or digits completely; textual prefix matching is unsafe.
      const finals = cumulativeFinals
        ? ended && latest ? [{ resultId: String(firstIndex), text: latest }] : []
        : ordered.map(([index, text]) => ({ resultId: String(index), text }));
      const tail = cumulativeFinals && !ended ? latest : interimText;
      this.emit({ type: 'transcript_update', sessionId: session.sessionId,
        finalText: finals.map((segment) => segment.text).join(' '), interimText: tail, finalSegments: finals });
    };
    recognition.lang = request.language; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
    recognition.onstart = () => { if (this.active === session && !session.started) { session.started = true; clearTimeout(this.timeout); this.timeout = setTimeout(() => this.stop(), 60_000); this.emit({ type: 'started', sessionId: session.sessionId }); } };
    recognition.onresult = (event) => {
      if (this.active !== session) return;
      // results is the complete cumulative session snapshot, not a delta.
      const interim: string[] = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index]; if (!result) continue;
        const transcript = result[0]?.transcript.replace(/\s+/g, ' ').trim() ?? '';
        if (result.isFinal === true) { if (transcript) finalByIndex.set(index, transcript); else emptyFinalIndices.add(index); }
        else if (result.isFinal === false) { sawInterim = true; if (transcript) interim.push(transcript); }
      }
      // Normal implementations retain every independent final index, including
      // deliberately repeated words. Interim remains a replaceable snapshot.
      publishTranscript(false, interim.join(' '));
    };
    recognition.onerror = (event) => {
      if (this.active !== session) return;
      this.active = undefined; clearTimeout(this.timeout); this.detach(recognition); try { recognition.abort(); } catch { /* Already ended. */ }
      this.emit({ type: 'error', sessionId: session.sessionId, code: event.error, message: speechError(event.error) });
    };
    recognition.onend = () => { if (this.active !== session) return; if (cumulativeMode) publishTranscript(true); this.active = undefined; clearTimeout(this.timeout); this.detach(recognition); this.emit({ type: 'ended', sessionId: session.sessionId }); };
    try { recognition.start(); } catch (cause) { if (this.active === session) { this.abort(); const code = cause instanceof Error && cause.name === 'NotAllowedError' ? 'not-allowed' : 'start-failed'; this.emit({ type: 'error', sessionId: session.sessionId, code, message: speechError(code) }); } }
  }
  stop(): void { clearTimeout(this.timeout); const session = this.active; if (!session || session.stopping) return; session.stopping = true; try { session.recognition.stop(); } catch { this.abort(); this.emit({ type: 'ended', sessionId: session.sessionId }); } }
  abort(): void { clearTimeout(this.timeout); const session = this.active; this.active = undefined; if (session) { this.detach(session.recognition); try { session.recognition.abort(); } catch { /* No live recognition remains. */ } } }
}
