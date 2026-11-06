import { useMemo } from 'react';
import { ArrowRight, CalendarDays, PartyPopper } from 'lucide-react';
import { useApp } from '@/app-context';
import { useActivity, useProfiles, useRooms, useUpcoming } from '@/hooks/queries';
import { useNow } from '@/hooks/useNow';
import { addDays, capitalize, dayStart, fmtLongDate } from '@/lib/time';
import { ActivityItem } from '@/components/ActivityItem';
import { InstallCard } from '@/components/InstallCard';
import { ReservationCard } from '@/components/ReservationCard';
import { RoomStatusCard } from '@/components/RoomStatusCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionTitle } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';

function greeting(now: Date) {
  const h = now.getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export function HomeScreen() {
  const { me, openNew, openDetail, navigate } = useApp();
  const now = useNow();
  const rooms = useRooms();
  const profiles = useProfiles();
  const upcoming = useUpcoming();
  const activity = useActivity();

  const list = upcoming.data ?? [];
  const endOfToday = useMemo(() => addDays(dayStart(now), 1), [now]);
  const today = list.filter((r) => new Date(r.starts_at) < endOfToday);
  const mine = list.filter((r) => r.profile_id === me.id).slice(0, 3);

  return (
    <div className="pb-4">
      <div className="pt-4">
        <p className="text-sm text-muted">{capitalize(fmtLongDate(now, now))}</p>
        <p className="text-2xl font-extrabold tracking-tight">
          {greeting(now)}, {me.name} <span aria-hidden>{me.emoji}</span>
        </p>
      </div>

      <SectionTitle>Ahora mismo</SectionTitle>
      {rooms.isLoading || upcoming.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner className="text-brand" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rooms.active.map((room) => (
            <RoomStatusCard
              key={room.id}
              room={room}
              reservations={list}
              profiles={profiles.byId}
              now={now}
              onOpen={openDetail}
              onBook={(roomId, start) => openNew({ roomId, start })}
            />
          ))}
        </div>
      )}

      <InstallCard />

      <SectionTitle
        action={
          <button type="button" onClick={() => navigate('calendario')} className="flex items-center gap-1 text-sm font-semibold text-brand">
            Calendario <ArrowRight className="size-4" aria-hidden />
          </button>
        }
      >
        Hoy en casa
      </SectionTitle>
      {today.length ? (
        <div className="space-y-2">
          {today.map((r) => (
            <ReservationCard key={r.id} r={r} room={rooms.byId.get(r.room_id)} owner={profiles.byId.get(r.profile_id)} now={now} isMine={r.profile_id === me.id} onOpen={openDetail} />
          ))}
        </div>
      ) : upcoming.isLoading ? null : (
        <EmptyState icon={<PartyPopper className="size-7" />} title="Hoy no hay nada reservado">
          Las salas están libres todo el día.
        </EmptyState>
      )}

      <SectionTitle
        action={
          <button type="button" onClick={() => navigate('reservas')} className="flex items-center gap-1 text-sm font-semibold text-brand">
            Ver todas <ArrowRight className="size-4" aria-hidden />
          </button>
        }
      >
        Tus próximas reservas
      </SectionTitle>
      {mine.length ? (
        <div className="space-y-2">
          {mine.map((r) => (
            <ReservationCard key={r.id} r={r} room={rooms.byId.get(r.room_id)} owner={profiles.byId.get(r.profile_id)} now={now} isMine onOpen={openDetail} />
          ))}
        </div>
      ) : upcoming.isLoading ? null : (
        <EmptyState icon={<CalendarDays className="size-7" />} title="No tienes reservas próximas">
          <button type="button" onClick={() => openNew()} className="font-semibold text-brand">
            Separar una sala
          </button>
        </EmptyState>
      )}

      <SectionTitle
        action={
          <button type="button" onClick={() => navigate('actividad')} className="flex items-center gap-1 text-sm font-semibold text-brand">
            Todo <ArrowRight className="size-4" aria-hidden />
          </button>
        }
      >
        Actividad reciente
      </SectionTitle>
      <div className="rounded-2xl border border-line bg-surface p-1">
        {(activity.data ?? []).slice(0, 3).map((a) => (
          <ActivityItem key={a.id} a={a} profiles={profiles.byId} rooms={rooms.byId} now={now} />
        ))}
        {!activity.isLoading && !activity.data?.length ? <p className="p-4 text-center text-sm text-muted">Aún no hay actividad.</p> : null}
      </div>
    </div>
  );
}
