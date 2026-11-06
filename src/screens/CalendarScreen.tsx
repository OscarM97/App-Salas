import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { isSameDay } from 'date-fns';
import { useApp } from '@/app-context';
import { useDayReservations, useProfiles, useReservationsRange, useRooms, useUpcoming } from '@/hooks/queries';
import { useNow } from '@/hooks/useNow';
import { HOUR, MINUTE, addDays, capitalize, dayHeading, dayStart, fmtLongDate, fmtShortDate, toDateInput } from '@/lib/time';
import { DateStrip } from '@/components/DateStrip';
import { DayTimeline } from '@/components/DayTimeline';
import { WeekOverview } from '@/components/WeekOverview';
import { IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Spinner } from '@/components/ui/Spinner';

type Mode = 'day' | 'week';
const MODE_KEY = 'salas:calendar-mode';

export function CalendarScreen() {
  const { openNew, openDetail } = useApp();
  const now = useNow();
  const rooms = useRooms();
  const profiles = useProfiles();
  const upcoming = useUpcoming();
  const [mode, setModeState] = useState<Mode>(() => (sessionStorage.getItem(MODE_KEY) as Mode) || 'day');
  const [date, setDate] = useState(() => dayStart(new Date()));

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      sessionStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignorar */
    }
  };

  const day = useDayReservations(date);
  // Vista semanal = los 7 días a partir del día elegido (por defecto, hoy).
  const wStart = useMemo(() => dayStart(date), [date]);
  const wEnd = useMemo(() => addDays(wStart, 7), [wStart]);
  const week = useReservationsRange(wStart, wEnd);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(wStart, i)), [wStart]);

  const busyDays = useMemo(() => {
    const s = new Set<string>();
    for (const r of upcoming.data ?? []) s.add(toDateInput(new Date(r.starts_at)));
    return s;
  }, [upcoming.data]);

  const stripStart = useMemo(() => addDays(dayStart(now), -7), [now.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSlot = (roomId: string, start: Date) => {
    // Termina 2 h después o cuando empiece la siguiente reserva de esa sala.
    let end = new Date(start.getTime() + 2 * HOUR);
    const next = (day.data ?? [])
      .filter((r) => r.room_id === roomId && new Date(r.starts_at) > start)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    if (next && new Date(next.starts_at) < end && new Date(next.starts_at).getTime() - start.getTime() >= 15 * MINUTE) {
      end = new Date(next.starts_at);
    }
    openNew({ roomId, start, end });
  };

  return (
    <div className="space-y-3 pb-4 pt-3">
      <Segmented
        label="Vista del calendario"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'day', label: 'Día' },
          { value: 'week', label: 'Semana' },
        ]}
      />

      {mode === 'day' ? (
        <>
          <DateStrip value={date} onChange={(d) => setDate(dayStart(d))} start={stripStart} count={42} now={now} busyDays={busyDays} />
          <div className="flex items-center gap-1">
            <IconButton label="Día anterior" onClick={() => setDate((d) => addDays(d, -1))}>
              <ChevronLeft className="size-5" />
            </IconButton>
            <div className="min-w-0 flex-1 text-center">
              <p className="font-bold">{dayHeading(date, now)}</p>
              <p className="text-xs text-muted">{capitalize(fmtLongDate(date, now))}</p>
            </div>
            <IconButton label="Día siguiente" onClick={() => setDate((d) => addDays(d, 1))}>
              <ChevronRight className="size-5" />
            </IconButton>
          </div>
          {!isSameDay(date, now) ? (
            <button type="button" onClick={() => setDate(dayStart(new Date()))} className="mx-auto block text-sm font-semibold text-brand">
              Ir a hoy
            </button>
          ) : null}
          {rooms.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner className="text-brand" />
            </div>
          ) : (
            <DayTimeline
              date={date}
              rooms={rooms.active}
              reservations={day.data ?? []}
              profiles={profiles.byId}
              now={now}
              onSlot={onSlot}
              onOpen={openDetail}
            />
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <IconButton label="Semana anterior" onClick={() => setDate((d) => addDays(d, -7))}>
              <ChevronLeft className="size-5" />
            </IconButton>
            <div className="min-w-0 flex-1 text-center">
              <p className="font-bold">
                {fmtShortDate(wStart)} – {fmtShortDate(addDays(wStart, 6))}
              </p>
              {isSameDay(wStart, now) ? (
                <p className="text-xs text-muted">Próximos 7 días</p>
              ) : (
                <button type="button" onClick={() => setDate(dayStart(new Date()))} className="text-xs font-semibold text-brand">
                  Ir a hoy
                </button>
              )}
            </div>
            <IconButton label="Semana siguiente" onClick={() => setDate((d) => addDays(d, 7))}>
              <ChevronRight className="size-5" />
            </IconButton>
          </div>
          <WeekOverview
            days={weekDays}
            rooms={rooms.active}
            reservations={week.data ?? []}
            profiles={profiles.byId}
            now={now}
            onPickDay={(d) => {
              setDate(d);
              setMode('day');
            }}
          />
        </>
      )}
    </div>
  );
}
