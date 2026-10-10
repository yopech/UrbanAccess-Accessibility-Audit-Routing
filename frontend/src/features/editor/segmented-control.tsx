import { useRef } from 'react';
export interface SegmentOption<T extends string> { value: T; label: string; accessibleLabel?: string; disabled?: boolean; }
export function SegmentedControl<T extends string>({ label, field, value, options, onChange }: { label: string; field: string; value: T; options: readonly SegmentOption<T>[]; onChange(value: T): void }) {
  const group = useRef<HTMLDivElement>(null);
  return <div className="segment-field"><span className="segment-label">{label}</span><div ref={group} role="radiogroup" aria-label={label} className={`segmented-control segments-${options.length}${options.length === 5 ? ' segmented-matrix' : ''}`}>
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} aria-label={option.accessibleLabel ?? option.label} disabled={option.disabled ?? false}
      data-audit-field={value === option.value ? field : undefined} tabIndex={value === option.value ? 0 : -1} onClick={() => onChange(option.value)}
      onKeyDown={(event) => { if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return; event.preventDefault();
        const enabled = options.filter((item) => !item.disabled); const index = enabled.findIndex((item) => item.value === option.value);
        const next = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : enabled[(index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : enabled.length - 1)) % enabled.length];
        if (next) { onChange(next.value); const target = options.findIndex((item) => item.value === next.value); group.current?.querySelectorAll<HTMLButtonElement>('button')[target]?.focus(); }
      }}>{option.label}</button>)}
  </div></div>;
}
