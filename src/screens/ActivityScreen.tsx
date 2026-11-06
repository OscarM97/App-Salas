import { useEffect, useState } from 'react';
import { Bell, Send } from 'lucide-react';
import { useApp } from '@/app-context';
import { useActivity, useProfiles, useRooms, useUpcoming } from '@/hooks/queries';
import { useNow } from '@/hooks/useNow';
import { getSeen, markSeen } from '@/hooks/useSeen';
import { groupByDay } from '@/lib/group';
import { dayHeading } from '@/lib/time';
import { ActivityItem } from '@/components/ActivityItem';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';

export function ActivityScreen() {
  const { me, isAdmin, navigate, openDetail } = useApp();
  const now = useNow();
  const activity = useActivity();
  const profiles = useProfiles();
  const rooms = useRooms();
  const upcoming = useUpcoming();
  const [seenAtOpen] = useState(getSeen);

  const items = activity.data ?? [];
  useEffect(() => {
    const max = items[0]?.id;
    if (max) markSeen(max);
  }, [items]);

  if (activity.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-brand" />
      </div>
    );
  }

  return (
    <div className="pb-4 pt-3">
      <p className="px-1 text-sm text-muted">Todo lo que pasa con las salas, en tiempo real, visible para toda la familia.</p>
      {items.length === 0 ? (
        <div className="mt-4">
          <EmptyState icon={<Bell className="size-7" />} title="Aún no hay actividad">
            Cuando alguien reserve, cambie o cancele, aparecerá aquí.
          </EmptyState>
        </div>
      ) : (
        groupByDay(items, (a) => a.created_at).map((g) => (
          <section key={g.key}>
            <h2 className="mb-1 mt-5 px-1 text-[13px] font-bold uppercase tracking-wide text-muted">{dayHeading(g.date, now)}</h2>
            <div className="rounded-2xl border border-line bg-surface p-1">
              {g.items.map((a) => (
                <ActivityItem
                  key={a.id}
                  a={a}
                  profiles={profiles.byId}
                  rooms={rooms.byId}
                  now={now}
                  unread={a.id > seenAtOpen && a.actor_id !== me.id}
                  onClick={(() => {
                    const r = a.reservation_id ? upcoming.data?.find((x) => x.id === a.reservation_id) : undefined;
                    return r ? () => openDetail(r) : undefined;
                  })()}
                />
              ))}
            </div>
          </section>
        ))
      )}
      {isAdmin ? (
        <button
          type="button"
          onClick={() => navigate('ajustes')}
          className="mt-6 flex w-full items-center gap-3 rounded-2xl border border-dashed border-line p-3 text-left text-sm text-muted"
        >
          <Send className="size-5 shrink-0 text-brand" aria-hidden />
          <span>
            <b className="text-ink">¿Avisos en Telegram o WhatsApp?</b> Configúralos en Ajustes → Avisos.
          </span>
        </button>
      ) : null}
    </div>
  );
}
