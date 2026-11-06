import { useEffect, useRef } from 'react';
import { CalendarDays } from 'lucide-react';
import { format, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { combineDateTime, daysFrom, toDateInput } from '@/lib/time';
import { cn } from './ui/cn';

interface DateStripProps {
  value: Date;
  onChange: (d: Date) => void;
  start: Date;
  count?: number;
  now: Date;
  /** Marca los días con reservas */
  busyDays?: Set<string>;
}

/** Tira horizontal de días + selector nativo para cualquier otra fecha. */
export function DateStrip({ value, onChange, start, count = 21, now, busyDays }: DateStripProps) {
  const days = daysFrom(start, count);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [value]);

  return (
    <div className="flex items-stretch gap-2">
      <div className="no-scrollbar -mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1 py-1">
        {days.map((d) => {
          const selected = isSameDay(d, value);
          const today = isSameDay(d, now);
          return (
            <button
              key={d.toISOString()}
              ref={selected ? selectedRef : undefined}
              type="button"
              onClick={() => onChange(d)}
              aria-pressed={selected}
              aria-label={format(d, "EEEE d 'de' MMMM", { locale: es })}
              className={cn(
                'relative flex w-12 shrink-0 flex-col items-center rounded-2xl py-1.5 transition',
                selected ? 'bg-brand text-brand-ink shadow-sm' : 'bg-surface text-ink ring-1 ring-line',
              )}
            >
              <span className={cn('text-[10px] font-semibold uppercase', !selected && 'text-muted')}>
                {today ? 'Hoy' : format(d, 'EEE', { locale: es }).replace('.', '')}
              </span>
              <span className="text-lg font-bold leading-tight">{format(d, 'd')}</span>
              {busyDays?.has(toDateInput(d)) ? (
                <span className={cn('absolute bottom-1 size-1 rounded-full', selected ? 'bg-brand-ink' : 'bg-brand')} />
              ) : null}
            </button>
          );
        })}
      </div>
      <label className="relative flex w-12 shrink-0 cursor-pointer flex-col items-center justify-center rounded-2xl bg-surface text-muted ring-1 ring-line">
        <CalendarDays className="size-5" aria-hidden />
        <span className="text-[10px] font-semibold">Otra</span>
        <input
          type="date"
          aria-label="Elegir otra fecha"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={toDateInput(value)}
          onChange={(e) => e.target.value && onChange(combineDateTime(e.target.value, '00:00'))}
        />
      </label>
    </div>
  );
}
