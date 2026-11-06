import type { Profile, Reservation, Room, SessionProfile } from '@/types';
import { HOUR, MINUTE, toDate } from './time';

export type ReservationStatus = 'upcoming' | 'in_progress' | 'finished' | 'cancelled';

const t = (v: string | Date) => toDate(v).getTime();

/** Intervalos semiabiertos [inicio, fin): 6–8pm y 8–10pm NO se traslapan. */
export function overlaps(aStart: string | Date, aEnd: string | Date, bStart: string | Date, bEnd: string | Date): boolean {
  return t(aStart) < t(bEnd) && t(bStart) < t(aEnd);
}

export function isActive(r: Reservation): boolean {
  return r.cancelled_at === null;
}

export function statusOf(r: Reservation, now = new Date()): ReservationStatus {
  if (r.cancelled_at) return 'cancelled';
  const n = now.getTime();
  if (t(r.ends_at) <= n) return 'finished';
  if (t(r.starts_at) <= n) return 'in_progress';
  return 'upcoming';
}

export function findConflicts(
  reservations: Reservation[],
  roomId: string,
  start: Date,
  end: Date,
  excludeId?: string | null,
): Reservation[] {
  return reservations
    .filter((r) => isActive(r) && r.room_id === roomId && r.id !== excludeId && overlaps(r.starts_at, r.ends_at, start, end))
    .sort((a, b) => t(a.starts_at) - t(b.starts_at));
}

export interface RoomNow {
  current: Reservation | null;
  next: Reservation | null;
}

export function roomNow(reservations: Reservation[], roomId: string, now = new Date()): RoomNow {
  const n = now.getTime();
  const mine = reservations
    .filter((r) => isActive(r) && r.room_id === roomId && t(r.ends_at) > n)
    .sort((a, b) => t(a.starts_at) - t(b.starts_at));
  const current = mine.find((r) => t(r.starts_at) <= n) ?? null;
  const next = mine.find((r) => t(r.starts_at) > n) ?? null;
  return { current, next };
}

/**
 * Primer hueco libre de `durationMin` minutos en la sala a partir de `from`.
 * Busca hasta 7 días adelante.
 */
export function nextFreeSlot(reservations: Reservation[], roomId: string, from: Date, durationMin: number): Date | null {
  const dur = durationMin * MINUTE;
  const limit = from.getTime() + 7 * 24 * HOUR;
  const busy = reservations
    .filter((r) => isActive(r) && r.room_id === roomId && t(r.ends_at) > from.getTime())
    .sort((a, b) => t(a.starts_at) - t(b.starts_at));
  let cursor = from.getTime();
  for (const r of busy) {
    if (t(r.starts_at) - cursor >= dur) break;
    cursor = Math.max(cursor, t(r.ends_at));
  }
  return cursor <= limit ? new Date(cursor) : null;
}

export function canModify(r: Reservation, me: SessionProfile | null): boolean {
  if (!me) return false;
  return r.profile_id === me.id || me.role === 'admin';
}

export function byStart(a: Reservation, b: Reservation): number {
  return t(a.starts_at) - t(b.starts_at);
}

export function indexById<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  return new Map((items ?? []).map((i) => [i.id, i]));
}

/** Recorta una reserva a la ventana de un día para dibujarla en el timeline. */
export function clampToWindow(r: Reservation, windowStart: Date, windowEnd: Date) {
  const s = Math.max(t(r.starts_at), windowStart.getTime());
  const e = Math.min(t(r.ends_at), windowEnd.getTime());
  return {
    startMin: (s - windowStart.getTime()) / MINUTE,
    endMin: (e - windowStart.getTime()) / MINUTE,
    continuesBefore: t(r.starts_at) < windowStart.getTime(),
    continuesAfter: t(r.ends_at) > windowEnd.getTime(),
  };
}

export function profileName(profiles: Map<string, Profile>, id: string | null | undefined, fallback = 'Alguien'): string {
  return (id && profiles.get(id)?.name) || fallback;
}

export function roomName(rooms: Map<string, Room>, id: string | null | undefined, fallback = 'una sala'): string {
  return (id && rooms.get(id)?.name) || fallback;
}

/** "Sala Principal / TV" → "TV", "Sala Arriba" → "Arriba". */
export function shortRoomName(name: string): string {
  const parts = name.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1] as string;
  return name.replace(/^Sala\s+/i, '').trim() || name;
}
