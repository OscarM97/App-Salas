import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtDurationShort, fmtRange, fmtRangeSentence, fmtTime, isAllDay, relativeDay, resolveRange, roundUp, timeAgo } from './time';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m); // nov 2026 (vie 6 = hoy)
const NOW = at(6, 17, 10);

describe('formato de horas estilo familia', () => {
  it('usa am/pm compacto', () => {
    expect(fmtTime(at(6, 20))).toBe('8pm');
    expect(fmtTime(at(6, 20, 30))).toBe('8:30pm');
    expect(fmtTime(at(7, 0))).toBe('12am');
    expect(fmtTime(at(6, 12))).toBe('12pm');
    expect(fmtTime(at(6, 9, 5))).toBe('9:05am');
    expect(fmtRange(at(6, 20), at(7, 0))).toBe('8pm – 12am');
  });

  it('todo el día', () => {
    expect(isAllDay(at(7, 0), at(8, 0))).toBe(true);
    expect(fmtRange(at(7, 0), at(8, 0))).toBe('Todo el día');
    expect(fmtRangeSentence(at(7, 0), at(8, 0))).toBe('todo el día');
    // Desde ahora hasta medianoche no es "todo el día"
    expect(isAllDay(at(6, 17), at(7, 0))).toBe(false);
    expect(fmtRange(at(6, 17), at(7, 0))).toBe('5pm – 12am');
  });

  it('duraciones cortas para los botones', () => {
    expect(fmtDurationShort(at(6, 20), at(6, 20, 30))).toBe('½ h');
    expect(fmtDurationShort(at(6, 20), at(6, 21, 30))).toBe('1½ h');
    expect(fmtDurationShort(at(6, 20), at(6, 22))).toBe('2 h');
    expect(fmtDurationShort(at(6, 20), at(6, 20, 45))).toBe('45 min');
  });

  it('duraciones', () => {
    expect(fmtDuration(at(6, 20), at(6, 22, 30))).toBe('2 h 30 min');
    expect(fmtDuration(at(6, 20), at(6, 20, 45))).toBe('45 min');
    expect(fmtDuration(at(6, 20), at(7, 0))).toBe('4 h');
  });
});

describe('días relativos', () => {
  it('hoy / mañana / este sábado / fecha', () => {
    expect(relativeDay(at(6, 20), NOW)).toBe('hoy');
    expect(relativeDay(at(7, 20), NOW)).toBe('mañana');
    expect(relativeDay(at(5, 20), NOW)).toBe('ayer');
    expect(relativeDay(at(10, 20), NOW)).toBe('este martes');
    expect(relativeDay(at(21, 20), NOW)).toBe('el sábado 21 de noviembre');
  });

  it('hace cuánto', () => {
    expect(timeAgo(new Date(NOW.getTime() - 20_000), NOW)).toBe('hace un momento');
    expect(timeAgo(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe('hace 5 min');
    expect(timeAgo(at(6, 14), NOW)).toBe('hace 3 h');
    expect(timeAgo(at(5, 20, 15), NOW)).toBe('ayer 8:15pm');
  });
});

describe('rangos', () => {
  it('si el fin es antes del inicio, termina al día siguiente', () => {
    const r = resolveRange('2026-11-06', '22:00', '01:00');
    expect(r.nextDay).toBe(true);
    expect(r.start).toEqual(at(6, 22));
    expect(r.end).toEqual(at(7, 1));
  });

  it('rango normal', () => {
    const r = resolveRange('2026-11-06', '18:00', '20:30');
    expect(r.nextDay).toBe(false);
    expect(r.end).toEqual(at(6, 20, 30));
  });

  it('redondea a la siguiente media hora', () => {
    expect(roundUp(at(6, 17, 10))).toEqual(at(6, 17, 30));
    expect(roundUp(at(6, 17, 30))).toEqual(at(6, 17, 30));
  });
});
