import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { MoonStar, Sun } from 'lucide-react';
import type { Profile, Reservation } from '@/types';
import { HOUR, MINUTE, addDays, fmtDurationShort, fmtTime, roundDown, roundUp } from '@/lib/time';
import { cn } from './ui/cn';

const SLOT = 30 * MINUTE;
const MAX_SPAN = 14 * HOUR;

interface TimePickerProps {
  /** Inicio (00:00) del día elegido */
  day: Date;
  start: Date;
  end: Date;
  allDay: boolean;
  /** Reservas activas de la sala elegida (sin la que se está editando) */
  busy: Reservation[];
  profiles: Map<string, Profile>;
  now: Date;
  /** Editando una reserva que ya empezó: el inicio no se mueve */
  lockStart?: boolean;
  /** Mientras se consulta la disponibilidad no se muestran botones */
  loading?: boolean;
  onChange: (start: Date, end: Date, allDay: boolean) => void;
}

interface Slot {
  t: Date;
  label: string;
  owner: Profile | null | undefined; // undefined = libre; null = ocupada (persona desconocida)
}

/**
 * Selector de horario con botones: primero "empieza", luego "termina".
 * Las horas ocupadas salen tachadas y no se pueden elegir, y la fila de
 * "termina" solo llega hasta la siguiente reserva: no hay forma de encimarse.
 */
export function TimePicker({ day, start, end, allDay, busy, profiles, now, lockStart, loading, onChange }: TimePickerProps) {
  const isToday = now >= day && now < addDays(day, 1);
  const busySorted = useMemo(() => [...busy].sort((a, b) => a.starts_at.localeCompare(b.starts_at)), [busy]);

  const ownerAt = (t: Date): Profile | null | undefined => {
    const r = busySorted.find((x) => new Date(x.starts_at) <= t && t < new Date(x.ends_at));
    if (!r) return undefined;
    return profiles.get(r.profile_id) ?? null;
  };

  // 48 botones como máximo: se calculan en cada render, es barato.
  const startSlots: Slot[] = [];
  if (isToday) {
    const n = roundDown(now, 5);
    startSlots.push({ t: n, label: 'Ahora', owner: ownerAt(n) });
  }
  for (let i = 0; i < 48; i++) {
    const t = new Date(day.getTime() + i * SLOT);
    if (isToday && t <= now) continue;
    startSlots.push({ t, label: fmtTime(t), owner: ownerAt(t) });
  }

  const startBusy = ownerAt(start) !== undefined;

  const endSlots: Array<{ t: Date; label: string; sub: string }> = (() => {
    if (startBusy) return [];
    const s = start.getTime();
    const next = busySorted.map((r) => new Date(r.starts_at).getTime()).find((t) => t > s);
    const limit = Math.min(next ?? Infinity, s + MAX_SPAN);
    const out: Array<{ t: Date; label: string; sub: string }> = [];
    for (let t = Math.floor(s / SLOT) * SLOT + SLOT; t <= limit; t += SLOT) {
      if (t - s < 15 * MINUTE || t <= now.getTime() + 5 * MINUTE) continue;
      out.push({ t: new Date(t), label: fmtTime(new Date(t)), sub: fmtDurationShort(start, new Date(t)) });
    }
    if (next !== undefined && next <= limit && next - s >= 15 * MINUTE && out[out.length - 1]?.t.getTime() !== next) {
      out.push({ t: new Date(next), label: fmtTime(new Date(next)), sub: fmtDurationShort(start, new Date(next)) });
    }
    return out;
  })();

  const nextBusyOwner = useMemo(() => {
    const r = busySorted.find((x) => new Date(x.starts_at).getTime() > start.getTime());
    if (!r || new Date(r.starts_at).getTime() > start.getTime() + MAX_SPAN) return null;
    return { at: new Date(r.starts_at), who: profiles.get(r.profile_id) };
  }, [busySorted, start, profiles]);

  const pickStart = (t: Date) => {
    const dur = Math.max(30 * MINUTE, end.getTime() - start.getTime());
    let e = new Date(t.getTime() + Math.min(dur, 2 * HOUR));
    const next = busySorted.map((r) => new Date(r.starts_at)).find((x) => x > t);
    if (next && next < e) e = next;
    onChange(t, e, false);
  };

  const setAllDay = (on: boolean) => {
    if (on) onChange(isToday ? roundDown(now, 5) : day, addDays(day, 1), true);
    else {
      const s = isToday ? roundUp(now, 30) : new Date(day.getTime() + 18 * HOUR);
      onChange(s, new Date(s.getTime() + 2 * HOUR), false);
    }
  };

  const startRow = useRef<HTMLDivElement>(null);
  const endRow = useRef<HTMLDivElement>(null);
  useCenterSelected(startRow, `${day.getTime()}-${start.getTime()}-${allDay}`);
  useCenterSelected(endRow, `${start.getTime()}-${end.getTime()}-${allDay}`);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-2xl border border-line p-3">
        <div className="flex items-center gap-2">
          <Sun className="size-5 text-amber-500" aria-hidden />
          <div>
            <p className="font-semibold">Todo el día</p>
            <p className="text-xs text-muted">{isToday ? 'Desde ahora hasta las 12am' : 'De 12am a 12am'}</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={allDay}
          aria-label="Todo el día"
          onClick={() => setAllDay(!allDay)}
          className={cn('relative h-7 w-12 shrink-0 rounded-full transition', allDay ? 'bg-brand' : 'bg-line')}
        >
          <span className={cn('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', allDay ? 'left-[1.4rem]' : 'left-0.5')} />
        </button>
      </div>

      {allDay ? null : loading ? (
        <p className="flex items-center gap-2 py-3 text-sm text-muted" role="status">
          <span className="size-2 animate-pulse-soft rounded-full bg-brand" /> Revisando horarios…
        </p>
      ) : (
        <>
          {lockStart ? (
            <p className="text-sm text-muted">
              Empezó a las <b className="text-ink">{fmtTime(start)}</b>. Elige a qué hora termina:
            </p>
          ) : (
            <Row label="Empieza" refEl={startRow}>
              {startSlots.map((s) => {
                const selected = s.t.getTime() === start.getTime();
                const taken = s.owner !== undefined;
                return (
                  <Chip
                    key={s.t.getTime()}
                    selected={selected}
                    disabled={taken}
                    onClick={() => pickStart(s.t)}
                    title={taken ? `Ocupado por ${s.owner?.name ?? 'alguien'}` : undefined}
                    label={s.label}
                    sub={taken ? s.owner?.emoji ?? '•' : s.label !== 'Ahora' && s.t.getHours() < 6 ? <MoonStar className="mx-auto size-3" aria-hidden /> : ' '}
                  />
                );
              })}
            </Row>
          )}

          {startBusy ? (
            <p className="rounded-xl bg-danger-soft p-2.5 text-sm font-semibold text-danger">Esa hora ya está ocupada. Elige otra hora para empezar.</p>
          ) : (
            <Row label="Termina" refEl={endRow}>
              {endSlots.map((s) => {
                const selected = s.t.getTime() === end.getTime();
                const inRange = s.t.getTime() < end.getTime();
                return (
                  <Chip
                    key={s.t.getTime()}
                    selected={selected}
                    inRange={inRange}
                    onClick={() => onChange(start, s.t, false)}
                    label={s.label}
                    sub={s.sub}
                  />
                );
              })}
            </Row>
          )}

          {!startBusy && nextBusyOwner ? (
            <p className="text-xs text-muted">
              Puedes reservar hasta las <b className="text-ink">{fmtTime(nextBusyOwner.at)}</b>: a esa hora la tiene {nextBusyOwner.who?.emoji}{' '}
              {nextBusyOwner.who?.name ?? 'alguien'}.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Row({ label, refEl, children }: { label: string; refEl: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div ref={refEl} className="no-scrollbar relative -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1">
        {children}
      </div>
    </div>
  );
}

function Chip({
  label,
  sub,
  selected,
  inRange,
  disabled,
  title,
  onClick,
}: {
  label: string;
  sub: ReactNode;
  selected?: boolean;
  inRange?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-selected={selected ? 'true' : undefined}
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      aria-label={title ? `${label}, ${title}` : typeof sub === 'string' && sub.trim() ? `${label}, ${sub}` : label}
      onClick={onClick}
      className={cn(
        'flex min-w-[4.25rem] shrink-0 flex-col items-center rounded-xl px-2 py-1.5 text-sm font-semibold transition',
        selected
          ? 'bg-brand text-brand-ink shadow-sm'
          : disabled
            ? 'cursor-not-allowed bg-danger-soft/60 text-danger/70 line-through'
            : inRange
              ? 'bg-brand/15 text-ink'
              : 'bg-surface text-ink ring-1 ring-line hover:bg-surface-2',
      )}
    >
      <span className="leading-tight">{label}</span>
      <span className={cn('min-h-4 text-[11px] font-medium leading-4 no-underline', selected ? 'text-brand-ink/80' : 'text-muted')}>{sub}</span>
    </button>
  );
}

/** Centra horizontalmente el botón elegido sin mover la hoja verticalmente. */
function useCenterSelected(ref: RefObject<HTMLDivElement | null>, key: string) {
  useEffect(() => {
    const row = ref.current;
    const el = row?.querySelector<HTMLElement>('[data-selected="true"]');
    if (!row || !el) return;
    row.scrollTo({ left: el.offsetLeft - row.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' });
  }, [ref, key]);
}
