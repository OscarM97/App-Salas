import type { Reservation } from '@/types';
import { dayStart, toDateInput } from './time';

export interface DayGroup<T> {
  key: string;
  date: Date;
  items: T[];
}

/** Agrupa por día (local) conservando el orden de entrada. */
export function groupByDay<T>(items: T[], dateOf: (item: T) => string): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>();
  for (const item of items) {
    const d = dayStart(new Date(dateOf(item)));
    const key = toDateInput(d);
    let g = groups.get(key);
    if (!g) {
      g = { key, date: d, items: [] };
      groups.set(key, g);
    }
    g.items.push(item);
  }
  return [...groups.values()];
}

export const byStartDate = (r: Reservation) => r.starts_at;
