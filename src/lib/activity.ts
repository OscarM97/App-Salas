import type { ActivityEntry, Profile, Room } from '@/types';
import { fmtRangeSentence, relativeDay } from './time';

export interface ActivityView {
  actor: Profile | null;
  text: string;
  tone: 'created' | 'updated' | 'cancelled' | 'released' | 'room';
}

/**
 * Texto del feed: "Hijo 1 separó Sala Lounge para este sábado de 8pm a 12am · Noche de pelis · con Sofía".
 * Usa los nombres actuales (por id) y, si ya no existen, la foto guardada en el evento.
 */
export function describeActivity(
  a: ActivityEntry,
  profiles: Map<string, Profile>,
  rooms: Map<string, Room>,
  now = new Date(),
  opts: { live?: boolean } = {},
): ActivityView {
  const d = a.data ?? {};
  const actor = (a.actor_id && profiles.get(a.actor_id)) || null;
  const actorName = actor?.name ?? d.actor_name ?? 'Alguien';
  const ownerName = (d.owner_id && profiles.get(d.owner_id)?.name) || d.owner_name || 'alguien';
  const room = (a.room_id && rooms.get(a.room_id)?.name) || d.room_name || 'una sala';
  const own = !d.owner_id || d.owner_id === a.actor_id;
  const when = d.starts_at && d.ends_at ? `${relativeDay(d.starts_at, now)} ${fmtRangeSentence(d.starts_at, d.ends_at)}` : '';
  const extra = [d.purpose, d.guests ? `con ${d.guests}` : null].filter(Boolean).join(' · ');
  const tail = extra ? ` · ${extra}` : '';

  switch (a.kind) {
    case 'reservation.created':
      return { actor, tone: 'created', text: `${actorName} ${opts.live ? 'acaba de separar' : 'separó'} ${room} para ${when}${tail}` };
    case 'reservation.updated': {
      const who = own ? 'cambió su reserva' : `cambió la reserva de ${ownerName}`;
      const moved = d.previous?.room_name && d.previous.room_name !== d.room_name ? ` (antes en ${d.previous.room_name})` : '';
      return { actor, tone: 'updated', text: `${actorName} ${who}: ${room} ${when}${moved}${tail}` };
    }
    case 'reservation.cancelled': {
      const who = own ? `canceló su reserva de ${room}` : `canceló la reserva de ${ownerName} en ${room}`;
      return { actor, tone: 'cancelled', text: `${actorName} ${who} (${when})` };
    }
    case 'reservation.released':
      return { actor, tone: 'released', text: `${actorName} liberó ${room}. ¡Ya está disponible!` };
    case 'room.created':
      return { actor, tone: 'room', text: `${actorName} agregó la sala ${d.room_name ?? room}` };
    case 'room.updated': {
      const renamed = d.old_name && d.room_name && d.old_name !== d.room_name;
      if (d.active === false) return { actor, tone: 'room', text: `${actorName} desactivó la sala ${d.room_name ?? room}` };
      return {
        actor,
        tone: 'room',
        text: renamed ? `${actorName} renombró "${d.old_name}" a "${d.room_name}"` : `${actorName} actualizó la sala ${room}`,
      };
    }
    default:
      return { actor, tone: 'room', text: `${actorName} hizo un cambio` };
  }
}
