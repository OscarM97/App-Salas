import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, CircleCheck, CircleExclamationPoint, MoonStar, Sparkles } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Profile, Reservation, Room, SessionProfile } from '@/types';
import { backend } from '@/lib/backend';
import { AppError, toAppError } from '@/lib/errors';
import { findConflicts, nextFreeSlot } from '@/lib/reservations';
import {
  HOUR,
  MINUTE,
  addDays,
  dayStart,
  fmtDuration,
  fmtRange,
  fmtRangeSentence,
  fmtTime,
  isAllDay,
  relativeDay,
  resolveRange,
  roundDown,
  toDateInput,
  toTimeInput,
} from '@/lib/time';
import { qk, useReservationsRange } from '@/hooks/queries';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { Label, TextInput } from './ui/Field';
import { useToast } from './ui/Toast';
import { DateStrip } from './DateStrip';
import { RoomIcon } from './RoomIcon';
import { TimePicker } from './TimePicker';
import { cn } from './ui/cn';

export interface BookingPrefill {
  roomId?: string;
  start?: Date;
  end?: Date;
}

interface BookingFormProps {
  me: SessionProfile;
  rooms: Room[];
  profiles: Map<string, Profile>;
  now: Date;
  editing?: Reservation | null;
  prefill?: BookingPrefill;
  onDone: () => void;
}

const PURPOSES = ['🎬 Noche de pelis', '🎮 Videojuegos', '⚽ Partido', '📚 Estudio', '🎉 Reunión', '💬 Visita', '🍕 Cena'];

function initialRange(prefill: BookingPrefill | undefined, editing: Reservation | null | undefined, now: Date) {
  if (editing) return { start: new Date(editing.starts_at), end: new Date(editing.ends_at) };
  let start = prefill?.start ?? new Date(Math.ceil(now.getTime() / (30 * MINUTE)) * 30 * MINUTE);
  // Tocar la franja actual en el timeline = "desde ahora".
  if (start < now) start = roundDown(now, 15);
  let end = prefill?.end ?? new Date(start.getTime() + 2 * HOUR);
  if (end.getTime() - start.getTime() < 15 * MINUTE) end = new Date(start.getTime() + 2 * HOUR);
  return { start, end };
}

export function BookingForm({ me, rooms, profiles, now, editing, prefill, onDone }: BookingFormProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const init = useMemo(() => initialRange(prefill, editing, now), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [roomId, setRoomId] = useState<string>(editing?.room_id ?? prefill?.roomId ?? rooms[0]?.id ?? '');
  const [date, setDate] = useState(toDateInput(init.start));
  const [startTime, setStartTime] = useState(toTimeInput(init.start));
  const [endTime, setEndTime] = useState(toTimeInput(init.end));
  const [allDay, setAllDay] = useState(() => isAllDay(init.start, init.end));
  const [purpose, setPurpose] = useState(editing?.purpose ?? '');
  const [guests, setGuests] = useState(editing?.guests ?? '');
  const [serverError, setServerError] = useState<AppError | null>(null);

  const range = useMemo(() => resolveRange(date, startTime, endTime), [date, startTime, endTime]);
  const day = useMemo(() => dayStart(range.start), [range.start]);
  const windowEnd = useMemo(() => addDays(day, 3), [day]);
  const { data: nearby = [], isFetching, isLoading: nearbyLoading, isPlaceholderData } = useReservationsRange(day, windowEnd);

  useEffect(() => setServerError(null), [roomId, date, startTime, endTime]);

  const conflictsByRoom = useMemo(() => {
    const m = new Map<string, Reservation[]>();
    for (const room of rooms) m.set(room.id, findConflicts(nearby, room.id, range.start, range.end, editing?.id));
    return m;
  }, [rooms, nearby, range, editing?.id]);

  const conflict = conflictsByRoom.get(roomId)?.[0] ?? null;
  const room = rooms.find((r) => r.id === roomId);
  const durationMin = Math.round((range.end.getTime() - range.start.getTime()) / MINUTE);
  const editingInProgress = Boolean(editing && new Date(editing.starts_at) <= now);

  let validation: string | null = null;
  if (!room) validation = 'Elige una sala.';
  else if (range.end <= now) validation = 'Ese horario ya pasó. Elige una hora más tarde.';
  else if (durationMin < 15) validation = 'La reserva debe durar al menos 15 minutos.';
  else if (durationMin > 24 * 60) validation = 'Máximo 24 horas.';
  else if (!editingInProgress && range.start.getTime() < now.getTime() - 15 * MINUTE)
    validation = 'La hora de inicio ya pasó. Puedes empezar desde ahora.';

  const otherFreeRoom = conflict ? rooms.find((r) => r.id !== roomId && (conflictsByRoom.get(r.id)?.length ?? 0) === 0) : undefined;
  const nextSlot = useMemo(() => {
    if (!conflict) return null;
    const pool = nearby.filter((r) => r.id !== editing?.id);
    const s = nextFreeSlot(pool, roomId, range.start, durationMin);
    return s && s.getTime() !== range.start.getTime() ? s : null;
  }, [conflict, nearby, editing?.id, roomId, range.start, durationMin]);

  const apply = (s: Date, e: Date, all: boolean) => {
    setDate(toDateInput(s));
    setStartTime(toTimeInput(s));
    setEndTime(toTimeInput(e));
    setAllDay(all);
  };

  const applyStart = (s: Date) => apply(s, new Date(s.getTime() + durationMin * MINUTE), false);

  // Cambiar de día conserva el horario; "todo el día" se mueve con el día.
  const changeDate = (d: Date) => {
    const newDay = dayStart(d);
    const isToday = newDay.getTime() === dayStart(now).getTime();
    if (allDay) {
      apply(isToday ? roundDown(now, 5) : newDay, addDays(newDay, 1), true);
      return;
    }
    const next = resolveRange(toDateInput(newDay), startTime, endTime);
    if (isToday && !editingInProgress && next.start.getTime() < now.getTime() - 15 * MINUTE) {
      const s = roundDown(now, 5);
      apply(s, new Date(s.getTime() + Math.min(durationMin, 120) * MINUTE), false);
      return;
    }
    setDate(toDateInput(newDay));
  };

  const busyHere = useMemo(
    () => nearby.filter((r) => r.room_id === roomId && r.id !== editing?.id),
    [nearby, roomId, editing?.id],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const input = {
        room_id: roomId,
        starts_at: range.start,
        ends_at: range.end,
        purpose: purpose.trim() || null,
        guests: guests.trim() || null,
      };
      return editing ? backend.updateReservation(editing.id, input) : backend.createReservation(input);
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.reservations });
      void qc.invalidateQueries({ queryKey: qk.activity });
      toast({
        tone: 'success',
        title: editing ? 'Reserva actualizada' : '¡Listo! Sala separada',
        description: `${room?.name} · ${relativeDay(r.starts_at, new Date())} ${fmtRangeSentence(r.starts_at, r.ends_at)}`,
      });
      onDone();
    },
    onError: (err) => {
      const e = toAppError(err);
      setServerError(e);
      if (e.code === 'room_conflict') void qc.invalidateQueries({ queryKey: qk.reservations });
    },
  });

  const blocked = Boolean(validation || conflict);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!blocked) mutation.mutate();
  };

  const stripStart = useMemo(() => dayStart(now), [now.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form id="booking-form" onSubmit={submit} className="space-y-5">
      {/* Sala */}
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">¿Qué sala?</legend>
        <div className={cn('grid gap-2', rooms.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {rooms.map((r) => {
            const c = conflictsByRoom.get(r.id)?.[0];
            const selected = r.id === roomId;
            const owner = c ? profiles.get(c.profile_id) : undefined;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setRoomId(r.id)}
                aria-pressed={selected}
                className={cn(
                  'flex flex-col gap-2 rounded-2xl border-2 p-3 text-left transition',
                  selected ? 'border-brand bg-brand/5' : 'border-line bg-surface',
                )}
              >
                <div className="flex items-center gap-2">
                  <RoomIcon icon={r.icon} color={r.color} size="sm" />
                  <span className="line-clamp-2 text-sm font-semibold leading-tight">{r.name}</span>
                </div>
                {c ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-danger">
                    <CircleExclamationPoint className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">
                      Ocupada · {owner?.emoji} {owner?.name ?? 'alguien'}
                    </span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-semibold text-free">
                    <CircleCheck className="size-3.5" aria-hidden /> Libre en ese horario
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Fecha */}
      <div>
        <Label hint={relativeDay(range.start, now) === 'hoy' ? 'Hoy' : relativeDay(range.start, now)}>¿Qué día?</Label>
        <DateStrip
          value={range.start}
          start={stripStart}
          count={21}
          now={now}
          onChange={changeDate}
        />
      </div>

      {/* Horario */}
      <div>
        <Label hint={<span className="font-semibold text-ink">{allDay ? 'Todo el día' : fmtDuration(range.start, range.end)}</span>}>
          Horario
        </Label>
        <TimePicker
          day={day}
          start={range.start}
          end={range.end}
          allDay={allDay}
          busy={busyHere}
          profiles={profiles}
          now={now}
          lockStart={editingInProgress}
          loading={nearbyLoading || isPlaceholderData}
          onChange={apply}
        />
        {!allDay && range.nextDay ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <MoonStar className="size-3.5" aria-hidden /> Termina al día siguiente ({relativeDay(range.end, now)} {fmtTime(range.end)})
          </p>
        ) : null}
        {!allDay ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-brand">Escribir una hora exacta</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Desde</span>
                <TextInput
                  type="time"
                  step={300}
                  value={startTime}
                  disabled={editingInProgress}
                  onChange={(e) => e.target.value && setStartTime(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Hasta</span>
                <TextInput type="time" step={300} value={endTime} onChange={(e) => e.target.value && setEndTime(e.target.value)} />
              </label>
            </div>
          </details>
        ) : null}
      </div>

      {/* Conflicto / validación */}
      {conflict || validation || serverError ? (
        <div role="alert" className="rounded-2xl border border-danger/30 bg-danger-soft p-3 text-sm">
          {conflict ? (
            <>
              <p className="font-semibold text-danger">
                {room?.name} ya está ocupada {relativeDay(conflict.starts_at, now)} {fmtRangeSentence(conflict.starts_at, conflict.ends_at)}
              </p>
              <p className="mt-0.5 text-ink/80">
                La reservó {profiles.get(conflict.profile_id)?.emoji} {profiles.get(conflict.profile_id)?.name ?? 'alguien'}
                {conflict.purpose ? ` · ${conflict.purpose}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {otherFreeRoom ? (
                  <Button size="sm" variant="secondary" onClick={() => setRoomId(otherFreeRoom.id)} icon={<Sparkles className="size-4 text-free" />}>
                    Usar {otherFreeRoom.name} (libre)
                  </Button>
                ) : null}
                {nextSlot && !allDay ? (
                  <Button size="sm" variant="secondary" onClick={() => applyStart(nextSlot)} icon={<ArrowRight className="size-4" />}>
                    {relativeDay(nextSlot, now) === relativeDay(range.start, now) ? '' : `${relativeDay(nextSlot, now)} `}
                    {fmtRange(nextSlot, new Date(nextSlot.getTime() + durationMin * MINUTE))}
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="font-semibold text-danger">{validation ?? serverError?.message}</p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl bg-free-soft/60 p-3 text-sm font-semibold text-free">
          <CircleCheck className="size-4 shrink-0" aria-hidden />
          {isFetching ? 'Revisando disponibilidad…' : `Libre: ${room?.name} ${relativeDay(range.start, now)} ${fmtRangeSentence(range.start, range.end)}`}
        </div>
      )}

      {/* Detalles */}
      <div>
        <Label htmlFor="purpose" hint="Opcional">¿Para qué?</Label>
        <TextInput id="purpose" value={purpose} maxLength={80} placeholder="Ej. Noche de pelis" onChange={(e) => setPurpose(e.target.value)} />
        <div className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {PURPOSES.map((p) => (
            <Chip key={p} active={purpose === p} onClick={() => setPurpose(purpose === p ? '' : p)} className="shrink-0">
              {p}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <Label htmlFor="guests" hint="Opcional">¿Con quién?</Label>
        <TextInput id="guests" value={guests} maxLength={80} placeholder="Ej. Sofía · amigos de la escuela" onChange={(e) => setGuests(e.target.value)} />
      </div>

      <div className="flex items-center gap-2 rounded-2xl bg-surface-2 p-3 text-sm">
        <Avatar emoji={me.emoji} color={me.color} size="sm" />
        <span>
          {editing && editing.profile_id !== me.id ? (
            <>
              Reserva de <b>{profiles.get(editing.profile_id)?.name}</b> (la editas como admin)
            </>
          ) : (
            <>
              A nombre de <b>{me.name}</b>
            </>
          )}
        </span>
      </div>

      <Button type="submit" size="lg" block loading={mutation.isPending} disabled={blocked}>
        {editing ? 'Guardar cambios' : `Reservar ${room?.name ?? ''}`}
      </Button>
    </form>
  );
}

function Chip({
  children,
  active,
  onClick,
  icon,
  className,
}: {
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium transition',
        active ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink hover:brightness-95',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
