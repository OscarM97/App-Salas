import { createContext, useContext } from 'react';
import type { Reservation, SessionProfile } from '@/types';
import type { BookingPrefill } from '@/components/BookingForm';
import type { Route } from '@/hooks/useHashRoute';

export interface AppActions {
  me: SessionProfile;
  isAdmin: boolean;
  openNew: (prefill?: BookingPrefill) => void;
  openDetail: (r: Reservation) => void;
  navigate: (r: Route) => void;
}

export const AppContext = createContext<AppActions | null>(null);

export function useApp(): AppActions {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp fuera de <AppContext>');
  return ctx;
}
