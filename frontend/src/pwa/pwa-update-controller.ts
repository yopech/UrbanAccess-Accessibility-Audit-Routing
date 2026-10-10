import { updateParticipants, type UpdateParticipant } from './update-participants.js';
export interface PwaSnapshot { status: 'unsupported' | 'registering' | 'ready' | 'waiting' | 'preparing' | 'blocked' | 'error'; message: string; }
export class PwaUpdateController {
  private snapshot: PwaSnapshot = { status: 'registering', message: 'Готовим офлайн-копию' };
  private listeners = new Set<() => void>();
  private registration: ServiceWorkerRegistration | undefined;
  private cleanup: (() => void)[] = [];
  private accepted = false;
  private coordinator: ServiceWorker | undefined;
  private started = false;
  private attempt: string | undefined;
  private generation = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly participants: UpdateParticipant = updateParticipants, private readonly reload = () => location.reload()) {}
  getSnapshot = (): PwaSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(status: PwaSnapshot['status'], message: string): void {
    this.snapshot = { status, message }; for (const fn of this.listeners) { try { fn(); } catch { /* Observer only. */ } }
  }
  async start(): Promise<void> {
    if (this.started) return; this.started = true;
    const generation = ++this.generation;
    if (import.meta.env.DEV) { this.set('unsupported', ''); return; }
    if (!('serviceWorker' in navigator)) { this.set('unsupported', 'Офлайн-режим недоступен'); return; }
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null || !('type' in data) || !('attempt' in data) || typeof data.attempt !== 'string') return;
      // Only the worker from this registration may coordinate an update.
      if (event.source !== this.registration?.waiting && event.source !== this.registration?.active && event.source !== this.coordinator) return;
      if (data.type === 'PREPARE_UPDATE') {
        if (this.attempt && this.attempt !== data.attempt) { event.ports[0]?.postMessage({ ready: false }); return; }
        this.coordinator = event.source as ServiceWorker;
        this.attempt = data.attempt; this.set('preparing', 'Сохраняем данные перед обновлением');
        const attempt = data.attempt;
        clearTimeout(this.releaseTimer);
        this.releaseTimer = setTimeout(() => { if (!this.accepted) this.release(attempt); }, 12000);
        void this.participants.prepareUpdate().then((ready) => {
          if (this.attempt !== attempt || !this.started) return;
          event.ports[0]?.postMessage({ ready });
        }, () => event.ports[0]?.postMessage({ ready: false }));
      } else if (data.type === 'RELEASE_UPDATE') this.release(data.attempt);
      else if (data.type === 'UPDATE_ACCEPTED' && this.attempt === data.attempt) {
        this.accepted = true; clearTimeout(this.releaseTimer);
      }
    };
    const onController = () => { if (this.accepted || (this.attempt && navigator.serviceWorker.controller === this.coordinator)) this.reload(); };
    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    this.cleanup.push(() => navigator.serviceWorker.removeEventListener('message', onMessage),
      () => navigator.serviceWorker.removeEventListener('controllerchange', onController));
    try {
      const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
      if (!this.started || generation !== this.generation) return;
      this.registration = registration;
      const inspect = () => { if (registration.waiting) this.set('waiting', 'Доступна новая версия приложения'); else if (registration.active) this.set('ready', 'Приложение готово к работе без сети'); };
      const found = () => {
        const installing = registration.installing;
        if (!installing) return;
        const changed = () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) this.set('waiting', 'Доступна новая версия приложения');
          else inspect();
        };
        installing.addEventListener('statechange', changed); this.cleanup.push(() => installing.removeEventListener('statechange', changed));
      };
      registration.addEventListener('updatefound', found); this.cleanup.push(() => registration.removeEventListener('updatefound', found));
      found(); inspect();
      void navigator.serviceWorker.ready.then(() => { if (this.started && generation === this.generation) inspect(); });
    } catch (error) { if (this.started) this.set('error', error instanceof Error ? error.message : 'Не удалось подготовить офлайн-копию'); }
  }
  private release(attempt: string): void {
    if (this.attempt !== attempt) return;
    clearTimeout(this.releaseTimer); this.attempt = undefined; this.accepted = false; this.coordinator = undefined;
    this.participants.releaseUpdate(); this.set('blocked', 'Обновление отложено. Завершите работу в открытых вкладках и повторите.');
  }
  async applyUpdate(): Promise<boolean> {
    // Called only by the explicit update button. No reload on update discovery.
    const worker = this.registration?.waiting;
    if (!worker || this.snapshot.status === 'preparing') return false;
    this.set('preparing', 'Проверяем сохранение во всех вкладках');
    const attempt = crypto.randomUUID();
    const channel = new MessageChannel();
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { finish(false); }, 10000);
      const finish = (accepted: boolean) => {
        clearTimeout(timer); channel.port1.close();
        if (!accepted) { this.release(attempt); this.set('blocked', 'Обновление отложено: есть несохранённые изменения или вкладка не отвечает.'); }
        resolve(accepted);
      };
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        finish(typeof data === 'object' && data !== null && 'accepted' in data && data.accepted === true);
      };
      try { worker.postMessage({ type: 'REQUEST_ACTIVATION', attempt }, [channel.port2]); }
      catch { finish(false); }
    });
  }
  stop(): void {
    this.started = false; this.generation++;
    for (const fn of this.cleanup.splice(0)) fn();
    clearTimeout(this.releaseTimer); this.participants.releaseUpdate(); this.attempt = undefined; this.accepted = false; this.coordinator = undefined;
  }
}
export const pwaUpdates = new PwaUpdateController();
