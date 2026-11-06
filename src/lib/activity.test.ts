import { describe, expect, it } from 'vitest';
import type { ActivityEntry, Profile, Room } from '@/types';
import { describeActivity } from './activity';
import { indexById } from './reservations';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const NOW = at(5, 18); // jueves 5 nov

const profiles = indexById<Profile>([
  { id: 'h1', name: 'Hijo 1', emoji: '🧑', color: '#d97706', role: 'member', sort_order: 3, active: true },
  { id: 'papa', name: 'Papá', emoji: '👨', color: '#2563eb', role: 'admin', sort_order: 1, active: true },
]);
const rooms = indexById<Room>([{ id: 's2', name: 'Sala 2', description: null, icon: 'sofa', color: '#ea580c', sort_order: 2, active: true }]);

function entry(kind: ActivityEntry['kind'], actor: string, data: ActivityEntry['data']): ActivityEntry {
  return { id: 1, created_at: NOW.toISOString(), kind, actor_id: actor, reservation_id: 'r1', room_id: 's2', data };
}

describe('feed de actividad', () => {
  const base = { owner_id: 'h1', starts_at: at(7, 20).toISOString(), ends_at: at(8, 0).toISOString() };

  it('el ejemplo de la familia', () => {
    const v = describeActivity(entry('reservation.created', 'h1', base), profiles, rooms, NOW, { live: true });
    expect(v.text).toBe('Hijo 1 acaba de separar Sala 2 para este sábado de 8pm a 12am');
  });

  it('incluye motivo y acompañantes', () => {
    const v = describeActivity(entry('reservation.created', 'h1', { ...base, purpose: 'Noche de pelis', guests: 'Sofía' }), profiles, rooms, NOW);
    expect(v.text).toBe('Hijo 1 separó Sala 2 para este sábado de 8pm a 12am · Noche de pelis · con Sofía');
  });

  it('cancelación por un admin menciona al dueño', () => {
    const v = describeActivity(entry('reservation.cancelled', 'papa', base), profiles, rooms, NOW);
    expect(v.text).toBe('Papá canceló la reserva de Hijo 1 en Sala 2 (este sábado de 8pm a 12am)');
    expect(v.tone).toBe('cancelled');
  });

  it('usa la foto guardada si la persona ya no existe', () => {
    const v = describeActivity(
      { ...entry('reservation.created', 'borrado', { ...base, actor_name: 'Abuela', room_name: 'Terraza' }), room_id: null },
      profiles,
      rooms,
      NOW,
    );
    expect(v.text.startsWith('Abuela separó Terraza')).toBe(true);
  });

  it('renombrar sala', () => {
    const v = describeActivity(entry('room.updated', 'papa', { room_name: 'Sala TV', old_name: 'Sala 1' }), profiles, rooms, NOW);
    expect(v.text).toBe('Papá renombró "Sala 1" a "Sala TV"');
  });
});
