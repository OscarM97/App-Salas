import { beforeEach, describe, expect, it } from 'vitest';
import type { Profile, Room } from '@/types';
import { AppError } from '../errors';
import { DemoBackend, type KeyValueStore } from './demo';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);

function memory(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(AppError);
  await p.catch((e: AppError) => expect(e.code).toBe(code));
}

describe('DemoBackend aplica las mismas reglas que Supabase', () => {
  let now: Date;
  let be: DemoBackend;
  let profiles: Profile[];
  let rooms: Room[];
  const byName = (name: string) => profiles.find((p) => p.name === name)!;

  beforeEach(async () => {
    now = at(6, 17);
    be = new DemoBackend({ storage: memory(), now: () => now, latencyMs: 0, seed: false, broadcast: false });
    profiles = await be.listProfiles();
    rooms = await be.listRooms();
  });

  const signIn = async (name: string) => {
    const r = await be.signIn(byName(name).id, '1234');
    expect(r.ok).toBe(true);
  };

  it('sin perfil no se puede reservar', async () => {
    await expectCode(be.createReservation({ room_id: rooms[0]!.id, starts_at: at(6, 20), ends_at: at(6, 22), purpose: null, guests: null }), 'no_profile');
  });

  it('PIN: intentos restantes y bloqueo', async () => {
    const id = byName('Hijo 1').id;
    const first = await be.signIn(id, '0000');
    expect(first).toEqual({ ok: false, error: 'invalid_pin', remaining: 4 });
    for (let i = 0; i < 3; i++) await be.signIn(id, '0000');
    const locked = await be.signIn(id, '0000');
    expect(locked.ok).toBe(false);
    expect(!locked.ok && locked.error).toBe('locked');
    expect((await be.signIn(id, '1234')).ok).toBe(false);
    now = at(6, 17, 6); // pasaron 6 minutos
    expect((await be.signIn(id, '1234')).ok).toBe(true);
  });

  it('bloquea traslapes y sugiere quién la tiene', async () => {
    const [tv, lounge] = rooms as [Room, Room];
    await signIn('Hijo 1');
    await be.createReservation({ room_id: tv.id, starts_at: at(6, 20), ends_at: at(6, 23), purpose: 'Pelis', guests: 'Sofía' });
    await signIn('Hijo 2');
    const p = be.createReservation({ room_id: tv.id, starts_at: at(6, 22), ends_at: at(7, 0), purpose: null, guests: null });
    await expectCode(p, 'room_conflict');
    await p.catch((e: AppError) => {
      expect(e.message).toBe('Sala Principal / TV ya está ocupada por Hijo 1 hoy de 8pm a 11pm.');
      expect(e.detail?.owner_name).toBe('Hijo 1');
    });
    // pegada al final y otra sala: OK
    await be.createReservation({ room_id: tv.id, starts_at: at(6, 23), ends_at: at(7, 1), purpose: null, guests: null });
    await be.createReservation({ room_id: lounge.id, starts_at: at(6, 20), ends_at: at(6, 23), purpose: null, guests: null });
    expect(await be.listUpcoming()).toHaveLength(3);
  });

  it('solo el dueño o un admin pueden cancelar; cancelar libera el horario', async () => {
    const tv = rooms[0]!;
    await signIn('Hijo 1');
    const r = await be.createReservation({ room_id: tv.id, starts_at: at(6, 20), ends_at: at(6, 22), purpose: null, guests: null });
    await signIn('Hijo 2');
    await expectCode(be.cancelReservation(r.id), 'forbidden');
    await expectCode(be.updateReservation(r.id, { room_id: tv.id, starts_at: at(6, 19), ends_at: at(6, 21), purpose: null, guests: null }), 'forbidden');
    await signIn('Mamá');
    const c = await be.cancelReservation(r.id);
    expect(c.cancelled_by).toBe(byName('Mamá').id);
    await signIn('Hijo 2');
    await be.createReservation({ room_id: tv.id, starts_at: at(6, 20), ends_at: at(6, 22), purpose: null, guests: null });
    const feed = await be.listActivity();
    expect(feed.map((a) => a.kind)).toEqual(['reservation.created', 'reservation.cancelled', 'reservation.created']);
  });

  it('editar no choca consigo misma; en curso se libera en vez de cancelar', async () => {
    const tv = rooms[0]!;
    await signIn('Hijo 3');
    const r = await be.createReservation({ room_id: tv.id, starts_at: at(6, 16, 30), ends_at: at(6, 18), purpose: null, guests: null });
    const moved = await be.updateReservation(r.id, { room_id: tv.id, starts_at: at(6, 16, 30), ends_at: at(6, 19), purpose: 'Tarea', guests: null });
    expect(moved.purpose).toBe('Tarea');
    await expectCode(be.cancelReservation(r.id), 'in_progress');
    const released = await be.releaseReservation(r.id);
    expect(new Date(released.ends_at).getTime()).toBe(now.getTime());
  });

  it('valida horarios', async () => {
    const tv = rooms[0]!;
    await signIn('Hijo 1');
    const mk = (s: Date, e: Date) => be.createReservation({ room_id: tv.id, starts_at: s, ends_at: e, purpose: null, guests: null });
    await expectCode(mk(at(6, 10), at(6, 12)), 'in_past');
    await expectCode(mk(at(6, 20), at(6, 20, 10)), 'invalid_range');
    await expectCode(mk(at(6, 20), at(7, 21)), 'invalid_range');
  });

  it('ajustes solo para admins y siempre queda un admin', async () => {
    await signIn('Hijo 1');
    await expectCode(be.upsertRoom({ id: rooms[0]!.id, name: 'Mía', description: null, icon: 'tv', color: '#000000', active: true }), 'forbidden');
    await signIn('Papá');
    await be.upsertProfile({ id: byName('Mamá').id, name: 'Mamá', emoji: '👩', color: '#db2777', role: 'member' });
    await expectCode(be.upsertProfile({ id: byName('Papá').id, name: 'Papá', emoji: '👨', color: '#2563eb', role: 'member' }), 'last_admin');
    const room = await be.upsertRoom({ id: rooms[0]!.id, name: 'Sala TV', description: null, icon: 'tv', color: '#4f46e5', active: true });
    expect(room.name).toBe('Sala TV');
  });
});
