/// <reference lib="webworker" />
import { setCacheNameDetails, cacheNames } from 'workbox-core';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };
setCacheNameDetails({ prefix: 'urbanaccess', suffix: self.registration.scope });
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/\/legacy\.html$/] }));
let coordinating = false;
function vote(client: WindowClient, attempt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const done = (ready: boolean) => { clearTimeout(timer); channel.port1.close(); resolve(ready); };
    const timer = setTimeout(() => done(false), 5000);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      done(typeof data === 'object' && data !== null && 'ready' in data && data.ready === true);
    };
    try { client.postMessage({ type: 'PREPARE_UPDATE', attempt }, [channel.port2]); } catch { done(false); }
  });
}
async function windows(): Promise<WindowClient[]> {
  return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter((client) => client.frameType !== 'nested' && client.url.startsWith(self.registration.scope));
}
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'REQUEST_ACTIVATION'
    || !('attempt' in data) || typeof data.attempt !== 'string' || !event.ports[0]) return;
  const source = event.source;
  if (!source || !('url' in source) || !source.url.startsWith(self.registration.scope)) return;
  const reply = event.ports[0]; const attempt = data.attempt;
  if (coordinating) { reply.postMessage({ accepted: false }); return; }
  coordinating = true;
  event.waitUntil((async () => {
    let clients: WindowClient[] = [];
    try {
      clients = await windows();
      const votes = await Promise.all(clients.map((client) => vote(client, attempt)));
      const current = await windows();
      const stable = current.length === clients.length && current.every((c) => clients.some((old) => old.id === c.id));
      if (!clients.length || !stable || !votes.every(Boolean)) {
        for (const client of clients) client.postMessage({ type: 'RELEASE_UPDATE', attempt });
        reply.postMessage({ accepted: false }); return;
      }
      for (const client of clients) client.postMessage({ type: 'UPDATE_ACCEPTED', attempt });
      reply.postMessage({ accepted: true });
      await self.skipWaiting();
    } catch {
      for (const client of clients) client.postMessage({ type: 'RELEASE_UPDATE', attempt });
      reply.postMessage({ accepted: false });
    } finally { coordinating = false; }
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Keep other applications' caches on the shared GitHub Pages origin.
    await Promise.all(keys.filter((name) => name.startsWith('urbanaccess-shell-')
      || (name.startsWith('urbanaccess-') && name.endsWith(self.registration.scope) && name !== cacheNames.precache))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});
