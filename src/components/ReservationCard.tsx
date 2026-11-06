import { ChevronRight, Users } from 'lucide-react';
import type { Profile, Reservation, Room } from '@/types';
import { statusOf } from '@/lib/reservations';
import { fmtDuration, fmtRange } from '@/lib/time';
import { Avatar } from './ui/Avatar';
import { RoomIcon } from './RoomIcon';
import { cn } from './ui/cn';

export function StatusBadge({ r, now }: { r: Reservation; now: Date }) {
  const s = statusOf(r, now);
  const map = {
    in_progress: { label: 'En curso', cls: 'bg-danger-soft text-danger' },
    upcoming: { label: 'Próxima', cls: 'bg-surface-2 text-muted' },
    finished: { label: 'Terminó', cls: 'bg-surface-2 text-muted' },
    cancelled: { label: 'Cancelada', cls: 'bg-surface-2 text-muted line-through' },
  } as const;
  const { label, cls } = map[s];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', cls)}>
      {s === 'in_progress' ? <span className="size-1.5 animate-pulse-soft rounded-full bg-danger" /> : null}
      {label}
    </span>
  );
}

interface ReservationCardProps {
  r: Reservation;
  room?: Room;
  owner?: Profile;
  now: Date;
  isMine?: boolean;
  onOpen: (r: Reservation) => void;
}

export function ReservationCard({ r, room, owner, now, isMine, onOpen }: ReservationCardProps) {
  const color = owner?.color ?? '#64748b';
  const cancelled = Boolean(r.cancelled_at);
  return (
    <button
      type="button"
      onClick={() => onOpen(r)}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition active:scale-[0.99]',
        cancelled && 'opacity-60',
      )}
      style={{ boxShadow: `inset 4px 0 0 ${color}` }}
    >
      <Avatar emoji={owner?.emoji ?? '🙂'} color={color} name={owner?.name} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={cn('truncate font-semibold', cancelled && 'line-through')}>{fmtRange(r.starts_at, r.ends_at)}</p>
          <span className="shrink-0 text-xs text-muted">{fmtDuration(r.starts_at, r.ends_at)}</span>
        </div>
        <p className="flex items-center gap-1.5 truncate text-sm">
          {room ? <RoomIcon icon={room.icon} color={room.color} size="sm" className="size-5 rounded-md [&_svg]:size-3" /> : null}
          <span className="truncate">{room?.name ?? 'Sala'}</span>
        </p>
        <p className="truncate text-xs text-muted">
          {isMine ? 'Tú' : owner?.name ?? 'Alguien'}
          {r.purpose ? ` · ${r.purpose}` : ''}
          {r.guests ? (
            <>
              {' · '}
              <Users className="inline size-3 align-[-1px]" aria-hidden /> {r.guests}
            </>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge r={r} now={now} />
        <ChevronRight className="size-4 text-muted" aria-hidden />
      </div>
    </button>
  );
}
