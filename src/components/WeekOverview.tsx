import type { Profile, Reservation, Room } from '@/types';
import { withAlpha } from '@/lib/colors';
import { clampToWindow, shortRoomName } from '@/lib/reservations';
import { addDays, dayHeading, fmtRange } from '@/lib/time';
import { RoomIcon } from './RoomIcon';
import { cn } from './ui/cn';

interface WeekOverviewProps {
  days: Date[];
  rooms: Room[];
  reservations: Reservation[];
  profiles: Map<string, Profile>;
  now: Date;
  onPickDay: (d: Date) => void;
}

const TICKS = [6, 12, 18];

/** Vista semanal: por día, una barra de 24 h por sala (verde = libre, color = ocupada). */
export function WeekOverview({ days, rooms, reservations, profiles, now, onPickDay }: WeekOverviewProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3 px-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-free/25 ring-1 ring-free/40" /> Libre
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-brand" /> Ocupada (color de quien reservó)
        </span>
      </div>
      {days.map((day, index) => {
        const start = day;
        const end = addDays(day, 1);
        const dayRes = reservations.filter((r) => new Date(r.starts_at) < end && new Date(r.ends_at) > start);
        const isPast = end <= now;
        const isToday = now >= start && now < end;
        return (
          <button
            key={day.toISOString()}
            type="button"
            onClick={() => onPickDay(day)}
            className={cn(
              'block w-full rounded-2xl border bg-surface p-3 text-left transition active:scale-[0.99]',
              isToday ? 'border-brand/60 ring-1 ring-brand/30' : 'border-line',
              isPast && 'opacity-60',
            )}
          >
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-semibold">{dayHeading(day, now)}</span>
              <span className="text-xs text-muted">
                {dayRes.length ? `${dayRes.length} reserva${dayRes.length === 1 ? '' : 's'}` : 'Todo libre'}
              </span>
            </div>
            <div className="space-y-1.5">
              {rooms.map((room) => (
                <div key={room.id} className="flex items-center gap-2">
                  <RoomIcon icon={room.icon} color={room.color} size="sm" className="size-5 rounded-md [&_svg]:size-3" />
                  <div className="relative h-4 flex-1 overflow-hidden rounded-md bg-free/15 ring-1 ring-inset ring-free/25">
                    {TICKS.map((h) => (
                      <span key={h} className="absolute inset-y-0 w-px bg-ink/10" style={{ left: `${(h / 24) * 100}%` }} />
                    ))}
                    {dayRes
                      .filter((r) => r.room_id === room.id)
                      .map((r) => {
                        const pos = clampToWindow(r, start, end);
                        const color = profiles.get(r.profile_id)?.color ?? '#64748b';
                        return (
                          <span
                            key={r.id}
                            className="absolute inset-y-0 rounded-[3px]"
                            style={{ left: `${(pos.startMin / 1440) * 100}%`, width: `${Math.max(0.8, ((pos.endMin - pos.startMin) / 1440) * 100)}%`, backgroundColor: color }}
                          />
                        );
                      })}
                    {isToday ? (
                      <span className="absolute inset-y-0 w-0.5 bg-danger" style={{ left: `${((now.getTime() - start.getTime()) / 86_400_000) * 100}%` }} />
                    ) : null}
                  </div>
                </div>
              ))}
              {index === 0 ? (
                <div className="flex justify-between pl-7 text-[9px] text-muted">
                  <span>12am</span>
                  <span>6am</span>
                  <span>12pm</span>
                  <span>6pm</span>
                  <span>12am</span>
                </div>
              ) : null}
            </div>
            {dayRes.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {dayRes.slice(0, 6).map((r) => {
                  const p = profiles.get(r.profile_id);
                  const room = rooms.find((x) => x.id === r.room_id);
                  return (
                    <li
                      key={r.id}
                      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ backgroundColor: withAlpha(p?.color ?? '#64748b', 0.14) }}
                    >
                      <span aria-hidden>{p?.emoji}</span>
                      {fmtRange(r.starts_at, r.ends_at)}
                      <span className="text-muted">· {room ? shortRoomName(room.name) : ''}</span>
                    </li>
                  );
                })}
                {dayRes.length > 6 ? <li className="px-1 text-[11px] text-muted">+{dayRes.length - 6}</li> : null}
              </ul>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
