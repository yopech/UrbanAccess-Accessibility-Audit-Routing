import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
export function useBlobURL(blob: Blob | undefined): string | undefined {
  const [url, setURL] = useState<string>();
  useEffect(() => { if (!blob) { setURL(undefined); return; } const next = URL.createObjectURL(blob); setURL(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url;
}
export function PhotoView({ blob, caption }: { blob: Blob; caption: string }) {
  const url = useBlobURL(blob); const [zoom, setZoom] = useState(1); const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; zoom: number } | undefined>(undefined);
  const changeZoom = (value: number) => { const next = Math.min(4, Math.max(1, value)); setZoom(next); if (next === 1) setOffset({ x: 0, y: 0 }); };
  return <><button className="photo-scale-badge" aria-label="Переключить масштаб фотографии" onClick={() => changeZoom(zoom === 1 ? 2 : 1)}><span role="status">{zoom.toFixed(1)}x</span></button>
    <div className="photo-viewport" tabIndex={0} role="region" aria-label="Фотография. Масштаб меняется жестом двумя пальцами или кнопкой сверху"
      onKeyDown={(event) => { if (event.key === '+' || event.key === '=') changeZoom(zoom + .5); if (event.key === '-') changeZoom(zoom - .5); if (event.key === '0') changeZoom(1); }}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; gesture.current = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom }; } }}
      onPointerMove={(event) => { const previous = pointers.current.get(event.pointerId); if (!previous) return; pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.current.size === 2 && gesture.current) { const [a, b] = [...pointers.current.values()]; if (gesture.current.distance > 0) changeZoom(gesture.current.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y) / gesture.current.distance); } else if (zoom > 1) setOffset(old => ({ x: old.x + event.clientX - previous.x, y: old.y + event.clientY - previous.y })); }}
      onPointerUp={(event) => { pointers.current.delete(event.pointerId); gesture.current = undefined; }} onPointerCancel={(event) => { pointers.current.delete(event.pointerId); gesture.current = undefined; }}>
      {url && <img src={url} alt={caption || 'Фотография обследуемого элемента'} draggable={false} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }} />}
    </div></>;
}
export function PhotoViewer({ blob, caption }: { blob: Blob; caption: string }) {
  const url = useBlobURL(blob);
  return <Dialog.Root><Dialog.Trigger asChild><button className="photo-preview" aria-label={`Открыть фото: ${caption || 'элемент без подписи'}`}>{url && <img src={url} alt={caption || 'Фото элемента'} />}</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content photo-dialog photo-fullscreen">
      <Dialog.Title className="sr-only">Просмотр фотографии</Dialog.Title><Dialog.Description className="sr-only">{caption || 'Проверьте детали снимка и показания измерительного прибора при увеличении.'}</Dialog.Description>
      <Dialog.Close asChild><Button className="photo-close" aria-label="Закрыть просмотр"><X size={20} aria-hidden /></Button></Dialog.Close><PhotoView blob={blob} caption={caption} />
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
