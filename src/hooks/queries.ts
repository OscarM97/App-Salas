import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { backend } from '@/lib/backend';
import { indexById } from '@/lib/reservations';
import { addDays, dayStart } from '@/lib/time';

export const qk = {
  session: ['session'] as const,
  household: ['household'] as const,
  profiles: ['profiles'] as const,
  rooms: ['rooms'] as const,
  reservations: ['reservations'] as const,
  range: (from: Date, to: Date) => ['reservations', 'range', from.getTime(), to.getTime()] as const,
  upcoming: ['reservations', 'upcoming'] as const,
  history: ['reservations', 'history'] as const,
  activity: ['activity'] as const,
  notifications: ['notifications'] as const,
};

export function useSessionQuery() {
  return useQuery({ queryKey: qk.session, queryFn: () => backend.getSession(), staleTime: 60_000, retry: 1 });
}

export function useHousehold() {
  return useQuery({ queryKey: qk.household, queryFn: () => backend.getHousehold(), staleTime: 5 * 60_000 });
}

export function useProfiles() {
  const q = useQuery({ queryKey: qk.profiles, queryFn: () => backend.listProfiles(), staleTime: 5 * 60_000 });
  const byId = useMemo(() => indexById(q.data), [q.data]);
  const active = useMemo(() => (q.data ?? []).filter((p) => p.active), [q.data]);
  return { ...q, byId, active };
}

export function useRooms() {
  const q = useQuery({ queryKey: qk.rooms, queryFn: () => backend.listRooms(), staleTime: 5 * 60_000 });
  const byId = useMemo(() => indexById(q.data), [q.data]);
  const active = useMemo(() => (q.data ?? []).filter((r) => r.active), [q.data]);
  return { ...q, byId, active };
}

/** Reservas activas de [from, to). */
export function useReservationsRange(from: Date, to: Date) {
  return useQuery({
    queryKey: qk.range(from, to),
    queryFn: () => backend.listReservations(from, to),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** Reservas de un día completo, incluyendo las que vienen de la noche anterior. */
export function useDayReservations(day: Date) {
  const from = useMemo(() => dayStart(day), [day]);
  const to = useMemo(() => addDays(from, 1), [from]);
  return useReservationsRange(from, to);
}

export function useUpcoming() {
  return useQuery({ queryKey: qk.upcoming, queryFn: () => backend.listUpcoming(), staleTime: 30_000 });
}

export function useHistory() {
  return useQuery({ queryKey: qk.history, queryFn: () => backend.listHistory(60), staleTime: 60_000 });
}

export function useActivity() {
  return useQuery({ queryKey: qk.activity, queryFn: () => backend.listActivity(60), staleTime: 30_000 });
}
