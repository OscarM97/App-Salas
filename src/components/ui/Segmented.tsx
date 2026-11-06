import { cn } from './cn';

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; badge?: number }>;
  className?: string;
  label: string;
}

export function Segmented<T extends string>({ value, onChange, options, className, label }: SegmentedProps<T>) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
          {o.badge ? <span className="rounded-full bg-brand px-1.5 text-[11px] leading-5 text-brand-ink">{o.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
