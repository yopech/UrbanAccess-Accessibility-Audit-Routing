import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { SaveState } from '../../domain/contracts.js';
import { SaveStatusBadge } from '../editor/save-status-badge.js';
export function AuditHeader({ name, saveState, readyCount, totalCount, onBack, onRetry, zoneLabel = 'Входная группа · Z2', backLabel = 'Все обследования', children }: {
  backLabel?: string; zoneLabel?: string; children?: ReactNode; name: string; saveState: SaveState; readyCount: number; totalCount: number;
  onBack: () => void; onRetry: () => void;
}) {
  return <header className="audit-header sticky top-0 z-30 pt-[env(safe-area-inset-top)] bg-[#12372a]/[0.97] backdrop-blur-md text-white">
    <div className="audit-header-row">
      <button type="button" className="audit-header-button" aria-label={backLabel} onClick={onBack}><ChevronLeft size={24} strokeWidth={2.5} aria-hidden /></button>
      <div className="audit-header-title"><h1 className="text-[15px] truncate font-semibold">{name}</h1></div>
      <span className="header-ready-count">{readyCount}/{totalCount}</span>
    </div>
    <div className={saveState.kind === 'saved' ? 'sr-only' : 'audit-header-save-status'}><SaveStatusBadge compact state={saveState} onRetry={onRetry} /></div>
    {children}
    <div className="audit-header-progress"><div role="progressbar" aria-label={`Готовность зоны: ${zoneLabel}`} aria-valuemin={0} aria-valuemax={totalCount} aria-valuenow={readyCount} className="h-[4px]"><div style={{ width: `${totalCount ? readyCount / totalCount * 100 : 0}%` }} /></div></div>
  </header>;
}
