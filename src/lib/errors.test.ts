import { describe, expect, it } from 'vitest';
import { toAppError } from './errors';

describe('errores de Supabase → mensajes para la familia', () => {
  it('lee el código del hint y el detalle del conflicto', () => {
    const e = toAppError({
      message: 'Sala TV ya está ocupada por Mamá hoy de 8pm a 10pm.',
      hint: 'room_conflict',
      details: '{"owner_name":"Mamá","starts_at":"2026-11-07T02:00:00Z"}',
      code: 'P0001',
    });
    expect(e.code).toBe('room_conflict');
    expect(e.message).toContain('Mamá');
    expect(e.detail?.owner_name).toBe('Mamá');
  });

  it('exclusion_violation de Postgres = conflicto', () => {
    expect(toAppError({ code: '23P01', message: 'conflicting key value' }).code).toBe('room_conflict');
  });

  it('errores de red', () => {
    expect(toAppError(new TypeError('Failed to fetch')).code).toBe('network');
  });
});
