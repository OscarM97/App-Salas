import { useSyncExternalStore } from 'react';

const KEY = 'salas:activity-seen';
const listeners = new Set<() => void>();

export function hasSeenMarker(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return true;
  }
}

export function getSeen(): number {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Guarda el último evento de actividad visto (para el globito de "nuevo"). */
export function markSeen(id: number): void {
  if (hasSeenMarker() && id <= getSeen()) return;
  try {
    localStorage.setItem(KEY, String(id));
  } catch {
    /* ignorar */
  }
  listeners.forEach((l) => l());
}

export function useSeen(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSeen,
    () => 0,
  );
}
