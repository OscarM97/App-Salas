import { useCallback, useSyncExternalStore } from 'react';

export type Route = 'inicio' | 'calendario' | 'reservas' | 'actividad' | 'ajustes';
const ROUTES: Route[] = ['inicio', 'calendario', 'reservas', 'actividad', 'ajustes'];

function read(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] as Route;
  return ROUTES.includes(h) ? h : 'inicio';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

/** Router mínimo por hash (#calendario): funciona en cualquier hosting estático sin reglas extra. */
export function useHashRoute(): [Route, (r: Route) => void] {
  const route = useSyncExternalStore(subscribe, read, () => 'inicio' as Route);
  const navigate = useCallback((r: Route) => {
    if (read() !== r) window.location.hash = r;
    window.scrollTo({ top: 0 });
  }, []);
  return [route, navigate];
}
