import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../../components/ui/button.js';
import type { DocumentBundle } from '../../documents/document-store.js';
export function AuditPrintView({ bundle, close }: { bundle: DocumentBundle; close(): void }) {
  const frame = useRef<HTMLIFrameElement>(null); const [html, setHtml] = useState(''); const [error, setError] = useState(''); const [ready, setReady] = useState(false);
  useEffect(() => { let active = true; const urls = new Map(bundle.photos.map((photo) => [photo.id, URL.createObjectURL(photo.blob)]));
    void import('../../documents/act-export.js').then(({ renderPrintHtml }) => { if (active) setHtml(renderPrintHtml(bundle.snapshot, urls)); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось открыть печатную версию.'); });
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [bundle]);
  return <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content print-dialog">
    <Dialog.Title>Печатная версия обследования</Dialog.Title><Dialog.Description>Редакция {bundle.snapshot.auditRevision}. A4, поля 15 мм. Содержимое соответствует сохранённому снимку документа.</Dialog.Description>
    <div className="button-row"><Button variant="primary" disabled={!ready || !!error} onClick={() => frame.current?.contentWindow?.print()}>Печатать</Button><Dialog.Close asChild><Button>Закрыть печатную версию</Button></Dialog.Close></div>
    {error && <p role="alert">{error}</p>}{html && <iframe ref={frame} title="Черновик акта для печати" sandbox="allow-same-origin allow-modals" srcDoc={html} onLoad={() => {
      const images = [...(frame.current?.contentDocument?.images ?? [])]; void Promise.all(images.map((image) => image.decode())).then(() => setReady(true), () => setError('Фото не загрузилось. Печать остановлена.'));
    }} />}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
