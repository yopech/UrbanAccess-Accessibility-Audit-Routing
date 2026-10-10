import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
export function RevisionConflictDialog({ open, local, remote, onLoadLatest, onSaveCopy }: {
  open: boolean; local: unknown; remote: unknown; onLoadLatest: () => Promise<void>; onSaveCopy?: () => Promise<void>;
}) {
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Операция не завершена.'); }
    finally { setBusy(false); }
  };
  return <Dialog.Root open={open}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
    <Dialog.Content className="dialog-content" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
      <Dialog.Title>Обследование изменено в другой вкладке</Dialog.Title>
      <Dialog.Description>Ваши правки остаются в редакторе. Сравните версии перед выбором. Загрузка актуальной версии удалит ваши несохранённые правки.</Dialog.Description>
      <button disabled={busy} onClick={() => setCompare(!compare)}>Сравнить версии</button>
      {compare && <div className="comparison"><section><h3>Ваши правки</h3><pre>{JSON.stringify(local, null, 2)}</pre></section>
        <section><h3>Версия из базы</h3><pre>{JSON.stringify(remote, null, 2)}</pre></section></div>}
      {onSaveCopy && <button disabled={busy} onClick={() => { void run(onSaveCopy); }}>Сохранить самостоятельную копию</button>}
      <button disabled={busy} onClick={() => { void run(onLoadLatest); }}>Загрузить актуальную версию</button>
      {error && <p role="alert">{error}</p>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
