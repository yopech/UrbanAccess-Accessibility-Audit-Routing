import type { ReactNode } from 'react';
import { ChevronLeft, Mic } from 'lucide-react';
import type { SaveState } from '../../domain/contracts.js';
import { SaveStatusBadge } from '../editor/save-status-badge.js';
export function AuditHeader({ name, saveState, readyCount, totalCount, draftsCount, onBack, onDraftsOpen, onRetry, zoneLabel = 'Входная группа · Z2', children }: {
  zoneLabel?: string; children?: ReactNode; name: string; saveState: SaveState; readyCount: number; totalCount: number; draftsCount: number;
  onBack: () => void; onDraftsOpen: () => void; onRetry: () => void;
}) {
  return <header className="audit-header sticky top-0 z-30 pt-[env(safe-area-inset-top)] bg-[#12372a]/[0.97] backdrop-blur-md text-white">
    <div className="audit-header-row">
      <button type="button" className="audit-header-button" aria-label="Все обследования" onClick={onBack}><ChevronLeft size={24} strokeWidth={2.5} aria-hidden /></button>
      <div className="audit-header-title"><p className="text-[11px] uppercase tracking-wider text-white/60">{zoneLabel}</p><h1 className="text-[15px] truncate font-semibold">{name}</h1></div>
      <SaveStatusBadge iconOnly state={saveState} onRetry={onRetry} />
      <button type="button" className="audit-header-button drafts-trigger" aria-label="Черновики диктовки" onClick={onDraftsOpen}>
        <Mic size={20} aria-hidden />{draftsCount > 0 && <span className="drafts-count" aria-hidden>{draftsCount}</span>}<span className="sr-only">{draftsCount} черновиков</span>
      </button>
    </div>
    {children}
    <div className="audit-header-progress"><span>{readyCount} из {totalCount} готово</span><div role="progressbar" aria-label={`Готовность зоны: ${zoneLabel}`} aria-valuemin={0} aria-valuemax={totalCount} aria-valuenow={readyCount} className="h-[4px]"><div style={{ width: `${totalCount ? readyCount / totalCount * 100 : 0}%` }} /></div></div>
  </header>;
}
