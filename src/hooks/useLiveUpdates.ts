import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { createElement } from 'react';
import type { LiveStatus, Profile, Room } from '@/types';
import { backend } from '@/lib/backend';
import { describeActivity } from '@/lib/activity';
import { indexById } from '@/lib/reservations';
import { useToast } from '@/components/ui/Toast';
import { qk } from './queries';

/**
 * Se suscribe a los cambios en tiempo real: refresca los datos y muestra un
 * aviso cuando OTRA persona reserva, cambia o cancela.
 */
export function useLiveUpdates(meId: string): LiveStatus {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const meRef = useRef(meId);
  meRef.current = meId;

  useEffect(() => {
    let dropped = false;
    const unsubscribe = backend.subscribe(
      (e) => {
        switch (e.table) {
          case 'reservations':
            void qc.invalidateQueries({ queryKey: qk.reservations });
            break;
          case 'activity': {
            void qc.invalidateQueries({ queryKey: qk.activity });
            const a = e.activity;
            if (a && a.actor_id !== meRef.current) {
              const profiles = indexById(qc.getQueryData<Profile[]>(qk.profiles));
              const rooms = indexById(qc.getQueryData<Room[]>(qk.rooms));
              const view = describeActivity(a, profiles, rooms, new Date(), { live: true });
              toast({
                tone: view.tone === 'cancelled' ? 'error' : 'info',
                title: view.actor ? `${view.actor.emoji} ${view.actor.name}` : 'Novedad en casa',
                description: view.text.replace(new RegExp(`^${escapeRegExp(view.actor?.name ?? '')}\\s*`), ''),
                icon: createElement(CalendarPlus, { className: 'size-5' }),
              });
            }
            break;
          }
          case 'rooms':
            void qc.invalidateQueries({ queryKey: qk.rooms });
            break;
          case 'profiles':
            void qc.invalidateQueries({ queryKey: qk.profiles });
            void qc.invalidateQueries({ queryKey: qk.session });
            break;
          case 'household':
            void qc.invalidateQueries({ queryKey: qk.household });
            break;
        }
      },
      (s) => {
        setStatus(s);
        if (s !== 'live') dropped = true;
        else if (dropped) {
          // Reconectado: pudimos perder eventos mientras tanto.
          dropped = false;
          void qc.invalidateQueries();
        }
      },
    );
    return unsubscribe;
  }, [qc, toast]);

  return status;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
