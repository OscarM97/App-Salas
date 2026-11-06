import { CalendarDays, House, ListChecks, Plus, Activity as ActivityIcon, RefreshCw, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { LiveStatus, SessionProfile } from '@/types';
import type { Route } from '@/hooks/useHashRoute';
import { useOnline } from '@/hooks/useOnline';
import { Avatar } from './ui/Avatar';
import { cn } from './ui/cn';

const TITLES: Record<Route, string> = {
  inicio: 'Inicio',
  calendario: 'Calendario',
  reservas: 'Reservas',
  actividad: 'Actividad',
  ajustes: 'Ajustes',
};

export function AppHeader({
  route,
  houseName,
  live,
  me,
  demo,
  onProfile,
}: {
  route: Route;
  houseName: string;
  live: LiveStatus;
  me: SessionProfile;
  demo: boolean;
  onProfile: () => void;
}) {
  const online = useOnline();
  const status = !online ? 'offline' : live;
  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line/60 bg-bg/85 backdrop-blur-md">
      <div className="flex h-14 items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-extrabold leading-tight tracking-tight">{TITLES[route]}</h1>
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <span
              className={cn(
                'size-1.5 rounded-full',
                status === 'live' ? 'bg-free' : status === 'connecting' ? 'animate-pulse-soft bg-amber-500' : 'bg-muted',
              )}
            />
            <span className="truncate">
              {houseName} · {status === 'live' ? 'En vivo' : status === 'connecting' ? 'Conectando…' : 'Sin conexión'}
              {demo ? ' · Modo demo' : ''}
            </span>
          </p>
        </div>
        <button type="button" onClick={onProfile} aria-label={`Tu perfil: ${me.name}. Abrir ajustes`} className="rounded-full">
          <Avatar emoji={me.emoji} color={me.color} name={me.name} size="md" ring />
        </button>
      </div>
    </header>
  );
}

export function BottomNav({
  route,
  onNavigate,
  onNew,
  activityBadge,
}: {
  route: Route;
  onNavigate: (r: Route) => void;
  onNew: () => void;
  activityBadge: number;
}) {
  const item = (r: Route, label: string, Icon: typeof House, badge?: number) => (
    <button
      type="button"
      onClick={() => onNavigate(r)}
      aria-current={route === r ? 'page' : undefined}
      className={cn('relative flex flex-1 flex-col items-center gap-0.5 pb-1 pt-2 text-[11px] font-semibold transition', route === r ? 'text-brand' : 'text-muted')}
    >
      <Icon className="size-6" aria-hidden strokeWidth={route === r ? 2.4 : 2} />
      {label}
      {badge ? (
        <span className="absolute right-[calc(50%-1.25rem)] top-1 min-w-4 rounded-full bg-danger px-1 text-[10px] leading-4 text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
  return (
    <nav aria-label="Navegación principal" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-2xl items-end px-2">
        {item('inicio', 'Inicio', House)}
        {item('calendario', 'Calendario', CalendarDays)}
        <div className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={onNew}
            aria-label="Nueva reserva"
            className="-mt-6 mb-1 flex size-15 items-center justify-center rounded-full bg-brand text-brand-ink shadow-lg shadow-brand/30 ring-4 ring-bg transition active:scale-95"
          >
            <Plus className="size-7" strokeWidth={2.6} />
          </button>
        </div>
        {item('reservas', 'Reservas', ListChecks)}
        {item('actividad', 'Actividad', ActivityIcon, activityBadge)}
      </div>
    </nav>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-sm text-muted" role="status">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      Sin internet. Verás lo último cargado; para reservar necesitas conexión.
    </div>
  );
}

/** Aviso de nueva versión (service worker en modo "prompt"). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Revisar si hay versión nueva cada hora mientras la app esté abierta.
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink p-3 text-sm text-bg shadow-xl">
      <RefreshCw className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">Hay una versión nueva de la app.</span>
      <button type="button" className="font-semibold text-bg/70" onClick={() => setNeedRefresh(false)}>
        Luego
      </button>
      <button type="button" className="rounded-xl bg-bg px-3 py-1.5 font-semibold text-ink" onClick={() => void updateServiceWorker(true)}>
        Actualizar
      </button>
    </div>
  );
}
