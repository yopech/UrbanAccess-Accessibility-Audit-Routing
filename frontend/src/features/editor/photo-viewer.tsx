import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
export function useBlobURL(blob: Blob | undefined): string | undefined {
  const [url, setURL] = useState<string>();
  useEffect(() => { if (!blob) { setURL(undefined); return; } const next = URL.createObjectURL(blob); setURL(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url;
}
export function PhotoView({ blob, caption }: { blob: Blob; caption: string }) {
  const viewport = useRef<HTMLDivElement>(null); const picture = useRef<HTMLImageElement>(null);
  const url = useBlobURL(blob); const [zoom, setZoom] = useState(1);
  return <><div className="photo-zoom-controls"><Button aria-label="Уменьшить фото" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - .5))}><ZoomOut aria-hidden />Уменьшить</Button>
    <span role="status">{Math.round(zoom * 100)} %</span><Button aria-label="Увеличить фото" disabled={zoom >= 4} onClick={() => setZoom(Math.min(4, zoom + .5))}><ZoomIn aria-hidden />Увеличить</Button><Button onClick={() => { const width = viewport.current?.clientWidth; if (width && picture.current?.naturalWidth) setZoom(picture.current.naturalWidth / width); }}>Исходный размер</Button></div>
    <div ref={viewport} className="photo-viewport" tabIndex={0} role="region" aria-label="Фотография. Для перемещения увеличенного снимка используйте прокрутку">
      {url && <img ref={picture} src={url} alt={caption || 'Фотография обследуемого элемента'} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} />}
    </div></>;
}
export function PhotoViewer({ blob, caption }: { blob: Blob; caption: string }) {
  const url = useBlobURL(blob);
  return <Dialog.Root><Dialog.Trigger asChild><button className="photo-preview" aria-label={`Открыть фото: ${caption || 'элемент без подписи'}`}>{url && <img src={url} alt={caption || 'Фото элемента'} />}</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content photo-dialog">
      <Dialog.Title>Просмотр фотографии</Dialog.Title><Dialog.Description>{caption || 'Проверьте детали снимка и показания измерительного прибора при увеличении.'}</Dialog.Description>
      <Dialog.Close asChild><Button className="photo-close"><X aria-hidden />Закрыть просмотр</Button></Dialog.Close><PhotoView blob={blob} caption={caption} />
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
