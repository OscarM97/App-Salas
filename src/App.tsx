import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Reservation, SessionInfo, SessionProfile } from '@/types';
import { AppContext, type AppActions } from '@/app-context';
import { backend, configError } from '@/lib/backend';
import { errorMessage } from '@/lib/errors';
import { qk, useActivity, useHousehold, useProfiles, useRooms, useSessionQuery } from '@/hooks/queries';
import { useHashRoute } from '@/hooks/useHashRoute';
import { useLiveUpdates } from '@/hooks/useLiveUpdates';
import { useNow } from '@/hooks/useNow';
import { hasSeenMarker, markSeen, useSeen } from '@/hooks/useSeen';
import { BookingForm, type BookingPrefill } from '@/components/BookingForm';
import { AppHeader, BottomNav, OfflineBanner, UpdatePrompt } from '@/components/layout';
import { ReservationDetail } from '@/components/ReservationDetail';
import { Sheet } from '@/components/ui/Sheet';
import { FullScreenLoader } from '@/components/ui/Spinner';
import { JoinScreen, ProfilePicker, SetPinScreen, StartupError } from '@/screens/Access';
import { ActivityScreen } from '@/screens/ActivityScreen';
import { CalendarScreen } from '@/screens/CalendarScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { ReservationsScreen } from '@/screens/ReservationsScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';

/** Decide qué mostrar: código de la casa → perfil + PIN → crear PIN → app. */
export function App() {
  const qc = useQueryClient();
  const session = useSessionQuery();
  const [lastPin, setLastPin] = useState<string | null>(null);

  if (configError) return <StartupError message={configError} onRetry={() => window.location.reload()} />;
  if (session.isLoading) return <FullScreenLoader label="Abriendo la casa…" />;
  if (session.error || !session.data) {
    return <StartupError message={errorMessage(session.error)} onRetry={() => void session.refetch()} />;
  }

  const s = session.data;
  if (!s.isMember) return <JoinScreen />;
  if (!s.profile) {
    return (
      <ProfilePicker
        onSignedIn={(next: SessionInfo, pin) => {
          setLastPin(pin);
          qc.setQueryData(qk.session, next);
        }}
      />
    );
  }
  if (s.mustChangePin) {
    return (
      <SetPinScreen
        me={s.profile}
        knownPin={lastPin}
        onDone={() => {
          setLastPin(null);
          qc.setQueryData(qk.session, { ...s, mustChangePin: false });
        }}
      />
    );
  }
  return <MainApp me={s.profile} />;
}

type SheetState =
  | { kind: 'new'; prefill?: BookingPrefill }
  | { kind: 'edit'; reservation: Reservation }
  | { kind: 'detail'; reservation: Reservation };

function MainApp({ me: sessionMe }: { me: SessionProfile }) {
  const [route, navigate] = useHashRoute();
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const now = useNow();
  const household = useHousehold();
  const profiles = useProfiles();
  const rooms = useRooms();
  const activity = useActivity();
  const live = useLiveUpdates(sessionMe.id);
  const seen = useSeen();

  // Datos frescos del perfil (si alguien cambió nombre/emoji/rol).
  const fresh = profiles.byId.get(sessionMe.id);
  const me: SessionProfile = useMemo(
    () => (fresh ? { id: fresh.id, name: fresh.name, emoji: fresh.emoji, color: fresh.color, role: fresh.role } : sessionMe),
    [fresh, sessionMe],
  );

  // Primer uso en este dispositivo: no marcar todo el historial como "nuevo".
  useEffect(() => {
    const max = activity.data?.[0]?.id;
    if (max && !hasSeenMarker()) markSeen(max);
  }, [activity.data]);

  const unread = route === 'actividad' ? 0 : (activity.data ?? []).filter((a) => a.id > seen && a.actor_id !== me.id).length;

  const openNew = useCallback((prefill?: BookingPrefill) => setSheet({ kind: 'new', prefill }), []);

  // Atajo del ícono de la app (mantener presionado → "Nueva reserva").
  useEffect(() => {
    const check = () => {
      if (/[?&]nueva=1/.test(window.location.hash)) {
        window.history.replaceState(window.history.state, '', '#inicio');
        openNew();
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [openNew]);
  const openDetail = useCallback((r: Reservation) => setSheet({ kind: 'detail', reservation: r }), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const actions: AppActions = useMemo(
    () => ({ me, isAdmin: me.role === 'admin', openNew, openDetail, navigate }),
    [me, openNew, openDetail, navigate],
  );

  const screen = {
    inicio: <HomeScreen />,
    calendario: <CalendarScreen />,
    reservas: <ReservationsScreen />,
    actividad: <ActivityScreen />,
    ajustes: <SettingsScreen />,
  }[route];

  const sheetTitle = !sheet ? '' : sheet.kind === 'new' ? 'Nueva reserva' : sheet.kind === 'edit' ? 'Editar reserva' : 'Reserva';

  return (
    <AppContext.Provider value={actions}>
      <div className="mx-auto min-h-dvh max-w-2xl pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
        <AppHeader
          route={route}
          houseName={household.data?.name ?? 'Casa'}
          live={live}
          me={me}
          demo={backend.mode === 'demo'}
          onProfile={() => navigate('ajustes')}
        />
        <OfflineBanner />
        <main className="px-4">{screen}</main>
      </div>

      <BottomNav route={route} onNavigate={navigate} onNew={() => openNew()} activityBadge={unread} />

      <Sheet open={sheet !== null} onClose={closeSheet} title={sheetTitle}>
        {sheet?.kind === 'new' || sheet?.kind === 'edit' ? (
          <BookingForm
            key={sheet.kind === 'edit' ? sheet.reservation.id : 'new'}
            me={me}
            rooms={rooms.active}
            profiles={profiles.byId}
            now={now}
            editing={sheet.kind === 'edit' ? sheet.reservation : null}
            prefill={sheet.kind === 'new' ? sheet.prefill : undefined}
            onDone={closeSheet}
          />
        ) : sheet?.kind === 'detail' ? (
          <ReservationDetail
            r={sheet.reservation}
            me={me}
            rooms={rooms.byId}
            profiles={profiles.byId}
            now={now}
            onEdit={(r) => setSheet({ kind: 'edit', reservation: r })}
            onClose={closeSheet}
          />
        ) : null}
      </Sheet>

      <UpdatePrompt />
    </AppContext.Provider>
  );
}
