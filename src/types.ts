export type Role = 'admin' | 'member';

export interface Profile {
  id: string;
  name: string;
  emoji: string;
  color: string;
  role: Role;
  sort_order: number;
  active: boolean;
}

export interface Room {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  sort_order: number;
  active: boolean;
}

export interface Household {
  name: string;
  timezone: string;
}

export interface Reservation {
  id: string;
  room_id: string;
  profile_id: string;
  starts_at: string; // ISO
  ends_at: string; // ISO
  purpose: string | null;
  guests: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

export type ActivityKind =
  | 'reservation.created'
  | 'reservation.updated'
  | 'reservation.cancelled'
  | 'reservation.released'
  | 'room.created'
  | 'room.updated';

export interface ActivityData {
  owner_id?: string;
  owner_name?: string;
  actor_name?: string;
  room_name?: string;
  old_name?: string;
  active?: boolean;
  starts_at?: string;
  ends_at?: string;
  purpose?: string | null;
  guests?: string | null;
  previous?: { room_id?: string; room_name?: string; starts_at?: string; ends_at?: string };
}

export interface ActivityEntry {
  id: number;
  created_at: string;
  kind: ActivityKind;
  actor_id: string | null;
  reservation_id: string | null;
  room_id: string | null;
  data: ActivityData;
}

export interface SessionProfile {
  id: string;
  name: string;
  emoji: string;
  color: string;
  role: Role;
}

export interface SessionInfo {
  isMember: boolean;
  profile: SessionProfile | null;
  mustChangePin: boolean;
}

export type JoinResult =
  | { ok: true }
  | { ok: false; error: 'invalid_code' | 'rate_limited' | 'no_session' | 'anonymous_disabled' };

export type SignInResult =
  | { ok: true; session: SessionInfo }
  | { ok: false; error: 'invalid_pin'; remaining: number }
  | { ok: false; error: 'locked'; retryAt: string }
  | { ok: false; error: 'not_member' | 'profile_inactive' };

export interface ReservationInput {
  room_id: string;
  starts_at: Date;
  ends_at: Date;
  purpose: string | null;
  guests: string | null;
}

export interface RoomInput {
  id: string | null;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  active: boolean;
}

export interface ProfileInput {
  id: string | null;
  name: string;
  emoji: string;
  color: string;
  role?: Role | null;
  active?: boolean | null;
  pin?: string | null;
}

export interface NotificationSettings {
  enabled: boolean;
  hasTelegramToken: boolean;
  telegramChatId: string | null;
  webhookUrl: string | null;
  pgNetAvailable: boolean;
}

export interface NotificationSettingsInput {
  enabled: boolean;
  /** null = no cambiar, '' = borrar */
  telegramBotToken: string | null;
  telegramChatId: string | null;
  webhookUrl: string | null;
}

export type TestNotificationResult = { sent: boolean; reason?: 'pg_net_missing' | 'disabled' | 'not_configured' };

export type ChangeTable = 'household' | 'profiles' | 'rooms' | 'reservations' | 'activity';

export interface ChangeEvent {
  table: ChangeTable;
  /** Solo para inserciones en `activity` */
  activity?: ActivityEntry;
}

export type LiveStatus = 'live' | 'connecting' | 'offline';
