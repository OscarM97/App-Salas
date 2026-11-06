import { describe, expect, it } from 'vitest';
import type { Reservation } from '@/types';
import { canModify, findConflicts, nextFreeSlot, overlaps, roomNow, shortRoomName, statusOf } from './reservations';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
let n = 0;
function res(room: string, start: Date, end: Date, extra: Partial<Reservation> = {}): Reservation {
  n += 1;
  return {
    id: `r${n}`,
    room_id: room,
    profile_id: 'p1',
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    purpose: null,
    guests: null,
    created_at: start.toISOString(),
    updated_at: start.toISOString(),
    cancelled_at: null,
    cancelled_by: null,
    ...extra,
  };
}

describe('traslapes', () => {
  it('el fin es exclusivo: 6–8pm y 8–10pm conviven', () => {
    expect(overlaps(at(6, 18), at(6, 20), at(6, 20), at(6, 22))).toBe(false);
    expect(overlaps(at(6, 18), at(6, 20), at(6, 19, 59), at(6, 22))).toBe(true);
    expect(overlaps(at(6, 18), at(6, 23), at(6, 19), at(6, 20))).toBe(true);
  });

  it('findConflicts ignora canceladas, otras salas y la propia reserva', () => {
    const a = res('tv', at(6, 20), at(6, 22));
    const b = res('tv', at(6, 21), at(6, 23), { cancelled_at: at(6, 10).toISOString() });
    const c = res('lounge', at(6, 20), at(6, 22));
    const list = [a, b, c];
    expect(findConflicts(list, 'tv', at(6, 21), at(6, 22)).map((r) => r.id)).toEqual([a.id]);
    expect(findConflicts(list, 'tv', at(6, 21), at(6, 22), a.id)).toEqual([]);
    expect(findConflicts(list, 'lounge', at(6, 22), at(6, 23))).toEqual([]);
  });
});

describe('estado de las salas', () => {
  const now = at(6, 21);
  const current = res('tv', at(6, 20), at(6, 22));
  const next = res('tv', at(6, 23), at(7, 1));
  it('ahora y siguiente', () => {
    expect(roomNow([next, current], 'tv', now)).toEqual({ current, next });
    expect(roomNow([next, current], 'lounge', now)).toEqual({ current: null, next: null });
  });
  it('status', () => {
    expect(statusOf(current, now)).toBe('in_progress');
    expect(statusOf(next, now)).toBe('upcoming');
    expect(statusOf(res('tv', at(6, 10), at(6, 11)), now)).toBe('finished');
  });
  it('siguiente hueco libre', () => {
    // Libre a las 10pm por 1 h (hueco 10–11pm)
    expect(nextFreeSlot([current, next], 'tv', at(6, 21), 60)).toEqual(at(6, 22));
    // Para 2 h no cabe antes de las 11pm → después de la 1am
    expect(nextFreeSlot([current, next], 'tv', at(6, 21), 120)).toEqual(at(7, 1));
  });
});

describe('permisos', () => {
  const r = res('tv', at(6, 20), at(6, 22), { profile_id: 'hijo1' });
  it('dueño o admin', () => {
    expect(canModify(r, { id: 'hijo1', name: 'Hijo 1', emoji: '', color: '', role: 'member' })).toBe(true);
    expect(canModify(r, { id: 'hijo2', name: 'Hijo 2', emoji: '', color: '', role: 'member' })).toBe(false);
    expect(canModify(r, { id: 'papa', name: 'Papá', emoji: '', color: '', role: 'admin' })).toBe(true);
    expect(canModify(r, null)).toBe(false);
  });
});

it('nombre corto de sala', () => {
  expect(shortRoomName('Sala Principal / TV')).toBe('TV');
  expect(shortRoomName('Sala Lounge')).toBe('Lounge');
  expect(shortRoomName('Cuarto de juegos')).toBe('Cuarto de juegos');
});
