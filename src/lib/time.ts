import {
  addDays,
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  isSameYear,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { es } from 'date-fns/locale';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "8pm", "8:30pm", "12am" (estilo de la familia). */
export function fmtTime(value: string | Date): string {
  const d = toDate(value);
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

/** Reserva de 12am a 12am del día siguiente. */
export function isAllDay(start: string | Date, end: string | Date): boolean {
  const s = toDate(start);
  const e = toDate(end);
  return s.getHours() === 0 && s.getMinutes() === 0 && e.getTime() === addDays(s, 1).getTime();
}

/** "8pm – 12am" o "Todo el día" */
export function fmtRange(start: string | Date, end: string | Date): string {
  if (isAllDay(start, end)) return 'Todo el día';
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

/** "de 8pm a 12am" o "todo el día" */
export function fmtRangeSentence(start: string | Date, end: string | Date): string {
  if (isAllDay(start, end)) return 'todo el día';
  return `de ${fmtTime(start)} a ${fmtTime(end)}`;
}

/** Para botones: "½ h", "1 h", "1½ h", "45 min" */
export function fmtDurationShort(start: string | Date, end: string | Date): string {
  const mins = Math.round(differenceInMinutes(toDate(end), toDate(start)));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h} h`;
  if (m === 30) return h ? `${h}½ h` : '½ h';
  return h ? `${h} h ${m}` : `${m} min`;
}

/** "2 h", "1 h 30 min", "45 min" */
export function fmtDuration(start: string | Date, end: string | Date): string {
  const mins = Math.max(0, Math.round(differenceInMinutes(toDate(end), toDate(start))));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/** "sáb 7 nov" */
export function fmtShortDate(value: string | Date): string {
  return format(toDate(value), 'EEE d MMM', { locale: es }).replace(/\./g, '');
}

/** "sábado 7 de noviembre" */
export function fmtLongDate(value: string | Date, now = new Date()): string {
  const d = toDate(value);
  const base = format(d, "EEEE d 'de' MMMM", { locale: es });
  return isSameYear(d, now) ? base : `${base} de ${d.getFullYear()}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Día relativo para frases: "hoy", "mañana", "ayer", "este sábado",
 * "el sábado 21 de noviembre".
 */
export function relativeDay(value: string | Date, now = new Date()): string {
  const d = toDate(value);
  const diff = differenceInCalendarDays(d, now);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  const weekday = format(d, 'EEEE', { locale: es });
  if (diff > 1 && diff <= 6) return `este ${weekday}`;
  return `el ${fmtLongDate(d, now)}`;
}

/** Encabezado de día: "Hoy", "Mañana", "Sáb 7 nov". */
export function dayHeading(value: string | Date, now = new Date()): string {
  const diff = differenceInCalendarDays(toDate(value), now);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  return capitalize(fmtShortDate(value));
}

/** "hace un momento", "hace 5 min", "hace 2 h", "ayer 8:15pm", "mié 4 nov" */
export function timeAgo(value: string | Date, now = new Date()): string {
  const d = toDate(value);
  const mins = Math.round((now.getTime() - d.getTime()) / MINUTE);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const days = differenceInCalendarDays(now, d);
  if (days === 0) return `hace ${Math.floor(mins / 60)} h`;
  if (days === 1) return `ayer ${fmtTime(d)}`;
  return fmtShortDate(d);
}

export function toDateInput(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export function toTimeInput(d: Date): string {
  return format(d, 'HH:mm');
}

/** Combina "2026-11-07" + "20:30" en hora local. */
export function combineDateTime(date: string, time: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0, 0);
}

/**
 * Convierte fecha + hora inicio/fin en un rango. Si el fin es igual o
 * anterior al inicio se asume que termina al día siguiente (p. ej. 10pm–1am).
 */
export function resolveRange(date: string, startTime: string, endTime: string): { start: Date; end: Date; nextDay: boolean } {
  const start = combineDateTime(date, startTime);
  let end = combineDateTime(date, endTime);
  let nextDay = false;
  if (end.getTime() <= start.getTime()) {
    end = addDays(end, 1);
    nextDay = true;
  }
  return { start, end, nextDay };
}

/** Redondea hacia arriba al siguiente múltiplo de `step` minutos. */
export function roundUp(d: Date, step = 30): Date {
  const ms = step * MINUTE;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

export function roundDown(d: Date, step = 15): Date {
  const ms = step * MINUTE;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}

export function dayStart(d: Date): Date {
  return startOfDay(d);
}

export function weekStart(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 });
}

export function daysFrom(start: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(startOfDay(start), i));
}

export { addDays };
