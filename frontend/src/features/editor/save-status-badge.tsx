import { LoaderCircle, RotateCcw } from 'lucide-react';
import type { SaveState } from '../../domain/contracts.js';
export function SaveStatusBadge({ state, onRetry, compact = false, iconOnly = false }: { iconOnly?: boolean; compact?: boolean; state: SaveState; onRetry?: () => void }) {
  const text = state.kind === 'saved' ? (compact ? 'Сохранено' : 'Сохранено на устройстве') : state.kind === 'dirty' ? (compact ? 'Не сохранено' : 'Есть несохранённые изменения')
    : state.kind === 'saving' ? (compact ? 'Сохраняем' : 'Сохраняем изменения') : state.kind === 'conflict' ? 'Другая вкладка изменила обследование' : state.message;
  if (iconOnly) return <div className="save-status-icon" role={state.kind === 'error' || state.kind === 'conflict' ? 'alert' : 'status'} aria-live="polite" data-save-state={state.kind} title={text}>
    <span className="sr-only">{text}</span>
    {state.kind === 'saving' ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <span className={`save-status-dot save-status-${state.kind}`} aria-hidden />}
    {state.kind === 'error' && onRetry && <button type="button" aria-label="Повторить сохранение" onClick={onRetry}><RotateCcw size={18} aria-hidden /></button>}
  </div>;
  return <div className={compact ? 'save-badge-compact' : undefined} role={state.kind === 'error' || state.kind === 'conflict' ? 'alert' : 'status'} aria-live="polite" data-save-state={state.kind}>
    <span>{text}</span>{state.kind === 'error' && onRetry && <button type="button" onClick={onRetry}>Повторить сохранение</button>}
  </div>;
}
