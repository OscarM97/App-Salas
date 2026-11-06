import type {
  ActivityEntry,
  ChangeEvent,
  Household,
  JoinResult,
  LiveStatus,
  NotificationSettings,
  NotificationSettingsInput,
  Profile,
  ProfileInput,
  Reservation,
  ReservationInput,
  Room,
  RoomInput,
  SessionInfo,
  SignInResult,
  TestNotificationResult,
} from '@/types';

/**
 * Contrato único entre la UI y el almacenamiento. Hay dos implementaciones:
 *  - SupabaseBackend: producción (Postgres + RLS + Realtime).
 *  - DemoBackend: todo en localStorage, para probar sin configurar nada.
 * Ambas aplican las mismas reglas (traslapes, permisos, PIN).
 */
export interface Backend {
  readonly mode: 'supabase' | 'demo';

  // Sesión
  getSession(): Promise<SessionInfo>;
  joinHousehold(code: string): Promise<JoinResult>;
  signIn(profileId: string, pin: string): Promise<SignInResult>;
  signOut(): Promise<void>;
  leaveHousehold(): Promise<void>;
  changePin(current: string, next: string): Promise<void>;

  // Lectura
  getHousehold(): Promise<Household>;
  listProfiles(): Promise<Profile[]>;
  listRooms(): Promise<Room[]>;
  /** Reservas activas que tocan el rango [from, to). */
  listReservations(from: Date, to: Date): Promise<Reservation[]>;
  /** Reservas activas que aún no terminan, ordenadas por inicio. */
  listUpcoming(): Promise<Reservation[]>;
  /** Reservas terminadas o canceladas, de la más reciente a la más vieja. */
  listHistory(limit?: number): Promise<Reservation[]>;
  listActivity(limit?: number): Promise<ActivityEntry[]>;

  // Reservas
  createReservation(input: ReservationInput): Promise<Reservation>;
  updateReservation(id: string, input: ReservationInput): Promise<Reservation>;
  cancelReservation(id: string): Promise<Reservation>;
  releaseReservation(id: string): Promise<Reservation>;

  // Ajustes
  updateHousehold(name: string, timezone: string): Promise<Household>;
  upsertRoom(input: RoomInput): Promise<Room>;
  upsertProfile(input: ProfileInput): Promise<Profile>;
  resetPin(profileId: string, pin: string): Promise<void>;
  setFamilyCode(code: string): Promise<void>;
  signOutOtherDevices(): Promise<number>;
  getNotificationSettings(): Promise<NotificationSettings>;
  setNotificationSettings(input: NotificationSettingsInput): Promise<NotificationSettings>;
  testNotification(): Promise<TestNotificationResult>;

  // Tiempo real
  subscribe(onChange: (e: ChangeEvent) => void, onStatus: (s: LiveStatus) => void): () => void;
}
