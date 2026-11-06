import { CalendarPlus, CircleCheck } from 'lucide-react';
import type { Profile, Reservation, Room } from '@/types';
import { withAlpha } from '@/lib/colors';
import { roomNow } from '@/lib/reservations';
import { fmtRange, fmtTime, relativeDay } from '@/lib/time';
import { Avatar } from './ui/Avatar';
import { RoomIcon } from './RoomIcon';

interface RoomStatusCardProps {
  room: Room;
  reservations: Reservation[];
  profiles: Map<string, Profile>;
  now: Date;
  onBook: (roomId: string, start?: Date) => void;
  onOpen: (r: Reservation) => void;
}

/** "Ahora mismo": Libre (verde) u Ocupada (color de quien la tiene). */
export function RoomStatusCard({ room, reservations, profiles, now, onBook, onOpen }: RoomStatusCardProps) {
  const { current, next } = roomNow(reservations, room.id, now);
  const owner = current ? profiles.get(current.profile_id) : undefined;
  const nextOwner = next ? profiles.get(next.profile_id) : undefined;
  const busyColor = owner?.color ?? '#64748b';

  return (
    <div
      className="overflow-hidden rounded-3xl border bg-surface"
      style={{
        borderColor: current
          ? 'color-mix(in oklab, var(--app-danger) 40%, transparent)'
          : 'color-mix(in oklab, var(--app-free) 40%, transparent)',
      }}
    >
      <div className="flex items-center gap-3 p-4 pb-3">
        <RoomIcon icon={room.icon} color={room.color} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{room.name}</p>
          {current ? (
            <p className="text-sm font-semibold text-danger">Ocupada hasta las {fmtTime(current.ends_at)}</p>
          ) : (
            <p className="flex items-center gap-1 text-sm font-semibold text-free">
              <CircleCheck className="size-4" aria-hidden /> Libre ahora
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
            current ? 'bg-danger-soft text-danger' : 'bg-free-soft text-free'
          }`}
        >
          {current ? 'Ocupada' : 'Libre'}
        </span>
      </div>

      {current ? (
        <button
          type="button"
          onClick={() => onOpen(current)}
          className="mx-4 mb-3 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl p-2.5 text-left"
          style={{ backgroundColor: withAlpha(busyColor, 0.1) }}
        >
          <Avatar emoji={owner?.emoji ?? '🙂'} color={busyColor} size="sm" />
          <div className="min-w-0 text-sm">
            <p className="truncate font-semibold">
              {owner?.name ?? 'Alguien'} · {fmtRange(current.starts_at, current.ends_at)}
            </p>
            {current.purpose || current.guests ? (
              <p className="truncate text-muted">{[current.purpose, current.guests && `con ${current.guests}`].filter(Boolean).join(' · ')}</p>
            ) : null}
          </div>
        </button>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <p className="min-w-0 truncate text-xs text-muted">
          {next ? (
            <>
              Después: {nextOwner?.emoji} {nextOwner?.name} {relativeDay(next.starts_at, now) === 'hoy' ? '' : `${relativeDay(next.starts_at, now)} `}
              {fmtRange(next.starts_at, next.ends_at)}
            </>
          ) : (
            'Sin más reservas próximas'
          )}
        </p>
        <button
          type="button"
          onClick={() => onBook(room.id, current ? new Date(current.ends_at) : undefined)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-ink"
        >
          <CalendarPlus className="size-3.5" aria-hidden />
          {current ? 'Reservar después' : 'Reservar'}
        </button>
      </div>
    </div>
  );
}
