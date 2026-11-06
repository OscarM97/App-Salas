import { useState } from 'react';
import { CalendarClock, Clock, Lock, LockOpen, Pencil, Sparkles, Users, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Profile, Reservation, Room, SessionProfile } from '@/types';
import { backend } from '@/lib/backend';
import { errorMessage } from '@/lib/errors';
import { canModify, statusOf } from '@/lib/reservations';
import { capitalize, fmtDuration, fmtLongDate, fmtRange, relativeDay, timeAgo } from '@/lib/time';
import { qk } from '@/hooks/queries';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';
import { RoomIcon } from './RoomIcon';
import { StatusBadge } from './ReservationCard';

interface ReservationDetailProps {
  r: Reservation;
  me: SessionProfile;
  rooms: Map<string, Room>;
  profiles: Map<string, Profile>;
  now: Date;
  onEdit: (r: Reservation) => void;
  onClose: () => void;
}

export function ReservationDetail({ r, me, rooms, profiles, now, onEdit, onClose }: ReservationDetailProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const room = rooms.get(r.room_id);
  const owner = profiles.get(r.profile_id);
  const status = statusOf(r, now);
  const allowed = canModify(r, me);
  const isMine = r.profile_id === me.id;

  const action = useMutation({
    mutationFn: (kind: 'cancel' | 'release') => (kind === 'cancel' ? backend.cancelReservation(r.id) : backend.releaseReservation(r.id)),
    onSuccess: (_res, kind) => {
      void qc.invalidateQueries({ queryKey: qk.reservations });
      void qc.invalidateQueries({ queryKey: qk.activity });
      toast({
        tone: 'success',
        title: kind === 'cancel' ? 'Reserva cancelada' : `${room?.name ?? 'La sala'} quedó libre`,
        description: kind === 'cancel' ? 'Se avisó a la familia en el feed.' : '¡Gracias por liberarla!',
      });
      onClose();
    },
    onError: (err) => toast({ tone: 'error', title: 'No se pudo', description: errorMessage(err) }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {room ? <RoomIcon icon={room.icon} color={room.color} size="lg" /> : null}
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-tight">{room?.name ?? 'Sala'}</p>
          <div className="mt-1">
            <StatusBadge r={r} now={now} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-surface-2 p-4">
        <p className="flex items-center gap-2 text-sm text-muted">
          <CalendarClock className="size-4" aria-hidden />
          {capitalize(fmtLongDate(r.starts_at, now))} · {relativeDay(r.starts_at, now)}
        </p>
        <p className="mt-1 text-2xl font-bold tracking-tight">{fmtRange(r.starts_at, r.ends_at)}</p>
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Clock className="size-3.5" aria-hidden />
          {fmtDuration(r.starts_at, r.ends_at)}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Avatar emoji={owner?.emoji ?? '🙂'} color={owner?.color ?? '#64748b'} name={owner?.name} size="lg" />
        <div>
          <p className="text-xs text-muted">Reservó</p>
          <p className="font-semibold">
            {owner?.name ?? 'Alguien'} {isMine ? <span className="font-normal text-muted">(tú)</span> : null}
          </p>
        </div>
      </div>

      {r.purpose || r.guests ? (
        <dl className="space-y-2 rounded-2xl border border-line p-3 text-sm">
          {r.purpose ? (
            <div className="flex gap-2">
              <dt className="flex items-center gap-1.5 text-muted">
                <Sparkles className="size-4" aria-hidden />
                Para:
              </dt>
              <dd className="font-medium">{r.purpose}</dd>
            </div>
          ) : null}
          {r.guests ? (
            <div className="flex gap-2">
              <dt className="flex items-center gap-1.5 text-muted">
                <Users className="size-4" aria-hidden />
                Con:
              </dt>
              <dd className="font-medium">{r.guests}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <p className="text-xs text-muted">
        Creada {timeAgo(r.created_at, now)}
        {r.updated_at !== r.created_at && !r.cancelled_at ? ` · editada ${timeAgo(r.updated_at, now)}` : ''}
        {r.cancelled_at ? ` · cancelada ${timeAgo(r.cancelled_at, now)}${r.cancelled_by ? ` por ${profiles.get(r.cancelled_by)?.name ?? 'alguien'}` : ''}` : ''}
      </p>

      {status === 'upcoming' || status === 'in_progress' ? (
        allowed ? (
          <div className="space-y-2 pt-1">
            {!isMine ? (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Lock className="size-3.5" aria-hidden /> Puedes modificarla porque eres admin.
              </p>
            ) : null}
            <Button variant="secondary" block icon={<Pencil className="size-4" />} onClick={() => onEdit(r)}>
              {status === 'in_progress' ? 'Cambiar hora de fin' : 'Editar reserva'}
            </Button>
            {status === 'in_progress' ? (
              <Button
                variant="soft-danger"
                block
                icon={<LockOpen className="size-4" />}
                loading={action.isPending}
                onClick={() => action.mutate('release')}
              >
                Liberar sala ahora
              </Button>
            ) : confirming ? (
              <div className="rounded-2xl border border-danger/30 bg-danger-soft p-3">
                <p className="text-sm font-semibold text-danger">¿Seguro que quieres cancelarla?</p>
                <p className="text-xs text-ink/70">La sala quedará libre y la familia lo verá en el feed.</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setConfirming(false)}>
                    No
                  </Button>
                  <Button variant="danger" loading={action.isPending} onClick={() => action.mutate('cancel')}>
                    Sí, cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="soft-danger" block icon={<X className="size-4" />} onClick={() => setConfirming(true)}>
                Cancelar reserva
              </Button>
            )}
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-2xl bg-surface-2 p-3 text-sm text-muted">
            <Lock className="size-4 shrink-0" aria-hidden />
            Solo {owner?.name ?? 'quien la creó'} o un admin pueden cambiar o cancelar esta reserva.
          </p>
        )
      ) : null}
    </div>
  );
}
