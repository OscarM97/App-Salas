import { useState } from 'react';
import { CalendarDays, History } from 'lucide-react';
import { useApp } from '@/app-context';
import { useHistory, useProfiles, useRooms, useUpcoming } from '@/hooks/queries';
import { useNow } from '@/hooks/useNow';
import { byStartDate, groupByDay } from '@/lib/group';
import { dayHeading } from '@/lib/time';
import { ReservationCard } from '@/components/ReservationCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Segmented } from '@/components/ui/Segmented';
import { Spinner } from '@/components/ui/Spinner';

type Tab = 'proximas' | 'mias' | 'historial';

export function ReservationsScreen() {
  const { me, openDetail, openNew } = useApp();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('proximas');
  const rooms = useRooms();
  const profiles = useProfiles();
  const upcoming = useUpcoming();
  const history = useHistory();

  const upcomingList = upcoming.data ?? [];
  const mine = upcomingList.filter((r) => r.profile_id === me.id);
  const list = tab === 'proximas' ? upcomingList : tab === 'mias' ? mine : history.data ?? [];
  const loading = tab === 'historial' ? history.isLoading : upcoming.isLoading;
  const groups = groupByDay(list, byStartDate);

  return (
    <div className="space-y-3 pb-4 pt-3">
      <Segmented
        label="Filtrar reservas"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'proximas', label: 'Próximas' },
          { value: 'mias', label: 'Mías', badge: mine.length || undefined },
          { value: 'historial', label: 'Historial' },
        ]}
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner className="text-brand" />
        </div>
      ) : groups.length === 0 ? (
        tab === 'historial' ? (
          <EmptyState icon={<History className="size-7" />} title="Todavía no hay historial" />
        ) : (
          <EmptyState icon={<CalendarDays className="size-7" />} title={tab === 'mias' ? 'No tienes reservas próximas' : 'No hay reservas próximas'}>
            <button type="button" onClick={() => openNew()} className="font-semibold text-brand">
              Reservar una sala
            </button>
          </EmptyState>
        )
      ) : (
        groups.map((g) => (
          <section key={g.key}>
            <h2 className="mb-1.5 mt-4 px-1 text-[13px] font-bold uppercase tracking-wide text-muted">{dayHeading(g.date, now)}</h2>
            <div className="space-y-2">
              {g.items.map((r) => (
                <ReservationCard
                  key={r.id}
                  r={r}
                  room={rooms.byId.get(r.room_id)}
                  owner={profiles.byId.get(r.profile_id)}
                  now={now}
                  isMine={r.profile_id === me.id}
                  onOpen={openDetail}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
