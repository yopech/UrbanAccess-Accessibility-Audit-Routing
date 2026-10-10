import { ChevronRight } from 'lucide-react';
export function BottomActionBar({ readyCount, totalCount, disabled, onReview }: {
  readyCount: number; totalCount: number; disabled: boolean; onReview: () => void;
}) {
  const allReady = totalCount > 0 && readyCount === totalCount;
  return <div className="bottom-action-bar fixed bottom-0 left-0 right-0 z-20 pb-[max(16px,env(safe-area-inset-bottom))] border-t">
    <div className="bottom-action-inner"><p>{readyCount} из {totalCount}<span>элементов готово</span></p>
      <button type="button" className="h-[52px]" disabled={disabled} aria-label={allReady ? 'Сводка и документ' : 'Перейти к сводке ›'} onClick={onReview}><span>{allReady ? 'Сводка и документ' : 'Перейти к сводке'}</span><ChevronRight size={18} aria-hidden /></button>
    </div>
  </div>;
}
