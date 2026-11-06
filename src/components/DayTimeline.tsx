import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import type { Profile, Reservation, Room } from '@/types';
import { withAlpha } from '@/lib/colors';
import { clampToWindow, roomNow } from '@/lib/reservations';
import { addDays, dayStart, fmtRange, fmtTime } from '@/lib/time';
import { RoomIcon } from './RoomIcon';
import { cn } from './ui/cn';

const HOUR_PX = 52;
const SLOT_MIN = 30;

interface DayTimelineProps {
  date: Date;
  rooms: Room[];
  reservations: Reservation[];
  profiles: Map<string, Profile>;
  now: Date;
  onSlot: (roomId: string, start: Date) => void;
  onOpen: (r: Reservation) => void;
}

/** Timeline vertical del día: una columna por sala, bloques de color por persona. */
export function DayTimeline({ date, rooms, reservations, profiles, now, onSlot, onOpen }: DayTimelineProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const start = useMemo(() => dayStart(date), [date]);
  const end = useMemo(() => addDays(start, 1), [start]);
  const isToday = now >= start && now < end;
  const nowMin = (now.getTime() - start.getTime()) / 60_000;

  // Desplazarse a "ahora" (hoy) o a la primera reserva / 8am.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let hour = 8;
    if (isToday) hour = Math.max(0, Math.floor(nowMin / 60) - 1);
    else {
      const first = reservations
        .filter((r) => new Date(r.starts_at) >= start)
        .map((r) => new Date(r.starts_at).getHours())
        .sort((a, b) => a - b)[0];
      if (first !== undefined) hour = Math.max(0, Math.min(first - 1, 16));
    }
    el.scrollTo({ top: hour * HOUR_PX, behavior: 'auto' });
    // Solo al cambiar de día, no en cada re-render.
  }, [start.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const hours = Array.from({ length: 24 }, (_, h) => h);

  const handleColumnClick = (room: Room, e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutes = Math.floor(((y / HOUR_PX) * 60) / SLOT_MIN) * SLOT_MIN;
    const slot = new Date(start.getTime() + minutes * 60_000);
    // Días pasados no se reservan; hoy, una franja que ya pasó = "desde ahora".
    if (slot.getTime() + SLOT_MIN * 60_000 <= now.getTime() && !isToday) return;
    onSlot(room.id, slot);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      {/* Encabezado de salas */}
      <div className="grid border-b border-line" style={{ gridTemplateColumns: `3rem repeat(${rooms.length}, minmax(0, 1fr))` }}>
        <div />
        {rooms.map((room) => {
          const state = isToday ? roomNow(reservations, room.id, now) : null;
          return (
            <div key={room.id} className="flex min-w-0 items-center gap-2 border-l border-line px-2 py-2.5">
              <RoomIcon icon={room.icon} color={room.color} size="sm" />
              <div className="min-w-0">
                <p className="line-clamp-2 text-[13px] font-semibold leading-tight" title={room.name}>
                  {room.name}
                </p>
                {state ? (
                  <p className={cn('text-[11px] font-semibold', state.current ? 'text-danger' : 'text-free')}>
                    {state.current ? `Ocupada hasta ${fmtTime(state.current.ends_at)}` : 'Libre ahora'}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted">
                    {reservations.filter((r) => r.room_id === room.id).length || 'Sin'} reserva
                    {reservations.filter((r) => r.room_id === room.id).length === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={scroller} className="relative max-h-[calc(100dvh-17rem)] min-h-[22rem] overflow-y-auto overscroll-contain">
        <div className="relative grid" style={{ gridTemplateColumns: `3rem repeat(${rooms.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
          {/* Horas */}
          <div className="relative">
            {hours.map((h) => (
              <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] font-medium text-muted" style={{ top: h * HOUR_PX }}>
                {h === 0 ? '' : fmtTime(new Date(start.getTime() + h * 3_600_000))}
              </span>
            ))}
          </div>

          {rooms.map((room) => (
            <div
              key={room.id}
              role="button"
              tabIndex={-1}
              aria-label={`Reservar ${room.name}`}
              className="group relative cursor-pointer border-l border-line bg-free/[0.035]"
              onClick={(e) => handleColumnClick(room, e)}
            >
              {hours.map((h) => (
                <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-line/70" style={{ top: h * HOUR_PX }} />
              ))}
              {isToday && nowMin > 0 ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 bg-surface-2/70" style={{ height: (nowMin / 60) * HOUR_PX }} />
              ) : null}

              {reservations
                .filter((r) => r.room_id === room.id)
                .map((r) => {
                  const pos = clampToWindow(r, start, end);
                  const owner = profiles.get(r.profile_id);
                  const color = owner?.color ?? '#64748b';
                  const top = (pos.startMin / 60) * HOUR_PX;
                  const height = Math.max(22, ((pos.endMin - pos.startMin) / 60) * HOUR_PX - 2);
                  const compact = height < 46;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(r);
                      }}
                      className="absolute inset-x-1 z-10 overflow-hidden rounded-lg border-l-4 px-1.5 py-1 text-left shadow-sm transition active:scale-[0.98]"
                      style={{
                        top: top + 1,
                        height,
                        background: `linear-gradient(${withAlpha(color, 0.2)}, ${withAlpha(color, 0.2)}), var(--app-surface)`,
                        borderColor: color,
                      }}
                      aria-label={`${owner?.name ?? 'Reserva'} ${fmtRange(r.starts_at, r.ends_at)} ${r.purpose ?? ''}`}
                    >
                      {pos.continuesBefore ? <ChevronUp className="absolute right-0.5 top-0.5 size-3 opacity-60" aria-hidden /> : null}
                      <p className={cn('truncate font-semibold leading-tight', compact ? 'text-[11px]' : 'text-xs')}>
                        <span aria-hidden>{owner?.emoji} </span>
                        {owner?.name ?? 'Alguien'}
                        {compact ? <span className="font-normal text-muted"> · {fmtTime(r.starts_at)}</span> : null}
                      </p>
                      {!compact ? (
                        <>
                          <p className="truncate text-[11px] text-muted">{fmtRange(r.starts_at, r.ends_at)}</p>
                          {r.purpose || r.guests ? (
                            <p className="truncate text-[11px]">{[r.purpose, r.guests && `con ${r.guests}`].filter(Boolean).join(' · ')}</p>
                          ) : null}
                        </>
                      ) : null}
                      {pos.continuesAfter ? <ChevronDown className="absolute bottom-0.5 right-0.5 size-3 opacity-60" aria-hidden /> : null}
                    </button>
                  );
                })}

              <Plus className="pointer-events-none absolute left-1/2 top-2 size-4 -translate-x-1/2 text-muted opacity-0 transition group-hover:opacity-40" aria-hidden />
            </div>
          ))}

          {isToday ? (
            <div className="pointer-events-none absolute right-0 z-[5] flex items-center" style={{ top: (nowMin / 60) * HOUR_PX, left: '2.6rem' }}>
              <span className="size-2.5 -translate-x-1/2 rounded-full bg-danger" />
              <span className="h-0.5 flex-1 bg-danger" />
            </div>
          ) : null}
        </div>
      </div>
      <p className="border-t border-line px-3 py-2 text-center text-xs text-muted">Toca un espacio libre para reservar · toca un bloque para ver detalles</p>
    </div>
  );
}
