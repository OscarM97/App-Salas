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
    const id = byName('Cecy').id;
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
    await signIn('Cecy');
    await be.createReservation({ room_id: tv.id, starts_at: at(6, 20), ends_at: at(6, 23), purpose: 'Pelis', guests: 'Sofía' });
    await signIn('Jorge');
    const p = be.createReservation({ room_id: tv.id, starts_at: at(6, 22), ends_at: at(7, 0), purpose: null, guests: null });
    await expectCode(p, 'room_conflict');
    await p.catch((e: AppError) => {
      expect(e.message).toBe('Sala Arriba ya está ocupada por Cecy hoy de 8pm a 11pm.');
      expect(e.detail?.owner_name).toBe('Cecy');
    });
    // pegada al final y otra sala: OK
    await be.createReservation({ room_id: tv.id, starts_at: at(6, 23), ends_at: at(7, 1), purpose: null, guests: null });
    await be.createReservation({ room_id: lounge.id, starts_at: at(6, 20), ends_at: at(6, 23), purpose: null, guests: null });
    expect(await be.listUpcoming()).toHaveLength(3);
  });

  it('si alguien tiene 6 a 10pm, nadie más puede separar 5 a 10pm (ni nada encimado)', async () => {
    const tv = rooms[0]!;
    await signIn('Cecy');
    await be.createReservation({ room_id: tv.id, starts_at: at(6, 18), ends_at: at(6, 22), purpose: null, guests: null });
    await signIn('Jorge');
    const mk = (s: Date, e: Date) => be.createReservation({ room_id: tv.id, starts_at: s, ends_at: e, purpose: null, guests: null });
    await expectCode(mk(at(6, 17), at(6, 22)), 'room_conflict'); // 5 a 10
    await expectCode(mk(at(6, 17), at(6, 18, 30)), 'room_conflict'); // 5 a 6:30
    await expectCode(mk(at(6, 21), at(6, 23)), 'room_conflict'); // 9 a 11
    await expectCode(mk(at(6, 19), at(6, 20)), 'room_conflict'); // dentro
    await mk(at(6, 17), at(6, 18)); // 5 a 6: justo antes, sí se puede
    await mk(at(6, 22), at(6, 23)); // 10 a 11: justo después, sí se puede
  });

  it('todo el día bloquea cualquier hora de ese día', async () => {
    const tv = rooms[0]!;
    await signIn('Andy');
    await be.createReservation({ room_id: tv.id, starts_at: at(7, 0), ends_at: at(8, 0), purpose: 'Cumpleaños', guests: null });
    await signIn('Cecy');
    const p = be.createReservation({ room_id: tv.id, starts_at: at(7, 15), ends_at: at(7, 16), purpose: null, guests: null });
    await expectCode(p, 'room_conflict');
    await p.catch((e: AppError) => expect(e.message).toBe('Sala Arriba ya está ocupada por Andy mañana todo el día.'));
  });

  it('solo el dueño o un admin pueden cancelar; cancelar libera el horario', async () => {
    const tv = rooms[0]!;
    await signIn('Cecy');
    const r = await be.createReservation({ room_id: tv.id, starts_at: at(6, 20), ends_at: at(6, 22), purpose: null, guests: null });
    await signIn('Jorge');
    await expectCode(be.cancelReservation(r.id), 'forbidden');
    await expectCode(be.updateReservation(r.id, { room_id: tv.id, starts_at: at(6, 19), ends_at: at(6, 21), purpose: null, guests: null }), 'forbidden');
    await signIn('Mamá');
    const c = await be.cancelReservation(r.id);
    expect(c.cancelled_by).toBe(byName('Mamá').id);
    await signIn('Jorge');
    await be.createReservation({ room_id: tv.id, starts_at: at(6, 20), ends_at: at(6, 22), purpose: null, guests: null });
    const feed = await be.listActivity();
    expect(feed.map((a) => a.kind)).toEqual(['reservation.created', 'reservation.cancelled', 'reservation.created']);
  });

  it('editar no choca consigo misma; en curso se libera en vez de cancelar', async () => {
    const tv = rooms[0]!;
    await signIn('Andy');
    const r = await be.createReservation({ room_id: tv.id, starts_at: at(6, 16, 30), ends_at: at(6, 18), purpose: null, guests: null });
    const moved = await be.updateReservation(r.id, { room_id: tv.id, starts_at: at(6, 16, 30), ends_at: at(6, 19), purpose: 'Tarea', guests: null });
    expect(moved.purpose).toBe('Tarea');
    await expectCode(be.cancelReservation(r.id), 'in_progress');
    const released = await be.releaseReservation(r.id);
    expect(new Date(released.ends_at).getTime()).toBe(now.getTime());
  });

  it('valida horarios', async () => {
    const tv = rooms[0]!;
    await signIn('Cecy');
    const mk = (s: Date, e: Date) => be.createReservation({ room_id: tv.id, starts_at: s, ends_at: e, purpose: null, guests: null });
    await expectCode(mk(at(6, 10), at(6, 12)), 'in_past');
    await expectCode(mk(at(6, 20), at(6, 20, 10)), 'invalid_range');
    await expectCode(mk(at(6, 20), at(7, 21)), 'invalid_range');
  });

  it('ajustes solo para admins y siempre queda un admin', async () => {
    await signIn('Cecy');
    await expectCode(be.upsertRoom({ id: rooms[0]!.id, name: 'Mía', description: null, icon: 'tv', color: '#000000', active: true }), 'forbidden');
    await signIn('Papá');
    await be.upsertProfile({ id: byName('Mamá').id, name: 'Mamá', emoji: '👩', color: '#db2777', role: 'member' });
    await expectCode(be.upsertProfile({ id: byName('Papá').id, name: 'Papá', emoji: '👨', color: '#2563eb', role: 'member' }), 'last_admin');
    const room = await be.upsertRoom({ id: rooms[0]!.id, name: 'Sala TV', description: null, icon: 'tv', color: '#4f46e5', active: true });
    expect(room.name).toBe('Sala TV');
  });
});
