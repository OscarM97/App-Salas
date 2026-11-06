import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityEntry,
  Household,
  JoinResult,
  NotificationSettings,
  Profile,
  Reservation,
  Room,
  SessionInfo,
  SignInResult,
  TestNotificationResult,
} from '@/types';
import { AppError, toAppError } from '../errors';
import type { Backend } from './types';

interface RawSession {
  is_member: boolean;
  profile: SessionInfo['profile'];
  must_change_pin: boolean;
}

const RESERVATION_COLUMNS =
  'id, room_id, profile_id, starts_at, ends_at, purpose, guests, created_at, updated_at, cancelled_at, cancelled_by';

function mapSession(raw: RawSession | null | undefined): SessionInfo {
  return {
    isMember: Boolean(raw?.is_member),
    profile: raw?.profile ?? null,
    mustChangePin: Boolean(raw?.must_change_pin),
  };
}

function mapNotifications(raw: Record<string, unknown>): NotificationSettings {
  return {
    enabled: Boolean(raw.enabled),
    hasTelegramToken: Boolean(raw.has_telegram_token),
    telegramChatId: (raw.telegram_chat_id as string | null) ?? null,
    webhookUrl: (raw.webhook_url as string | null) ?? null,
    pgNetAvailable: Boolean(raw.pg_net_available),
  };
}

function isAuthError(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  return err.code === 'PGRST301' || err.code === 'PGRST303' || /JWT|jwt|refresh token/i.test(err.message ?? '');
}

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const;
  private readonly db: SupabaseClient;

  constructor(url: string, key: string) {
    this.db = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'salas-casa-auth',
      },
    });
  }

  /** Ejecuta una RPC y convierte el error de Postgres en un AppError legible. */
  private async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw toAppError(error);
    return data as T;
  }

  private async select<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
    const { data, error } = await query;
    if (error) throw toAppError(error);
    return (data ?? []) as T;
  }

  // ------------------------------------------------------------------ sesión
  async getSession(): Promise<SessionInfo> {
    const {
      data: { session },
    } = await this.db.auth.getSession();
    if (!session) return mapSession(null);
    const { data, error } = await this.db.rpc('get_session');
    if (error) {
      if (isAuthError(error)) {
        // La sesión anónima ya no es válida (p. ej. se borró el usuario): empezar de cero.
        await this.db.auth.signOut({ scope: 'local' });
        return mapSession(null);
      }
      throw toAppError(error);
    }
    return mapSession(data as RawSession);
  }

  async joinHousehold(code: string): Promise<JoinResult> {
    const {
      data: { session },
    } = await this.db.auth.getSession();
    if (!session) {
      const { error } = await this.db.auth.signInAnonymously();
      if (error) {
        if (/anonymous/i.test(error.message)) return { ok: false, error: 'anonymous_disabled' };
        throw toAppError(error);
      }
    }
    const res = await this.rpc<{ ok: boolean; error?: string }>('join_household', { p_code: code });
    if (res.ok) return { ok: true };
    return { ok: false, error: (res.error as 'invalid_code' | 'rate_limited' | 'no_session') ?? 'invalid_code' };
  }

  async signIn(profileId: string, pin: string): Promise<SignInResult> {
    const res = await this.rpc<{
      ok: boolean;
      error?: string;
      remaining?: number;
      retry_at?: string;
      session?: RawSession;
    }>('sign_in', { p_profile_id: profileId, p_pin: pin });
    if (res.ok) return { ok: true, session: mapSession(res.session) };
    if (res.error === 'invalid_pin') return { ok: false, error: 'invalid_pin', remaining: res.remaining ?? 0 };
    if (res.error === 'locked') return { ok: false, error: 'locked', retryAt: res.retry_at ?? new Date().toISOString() };
    return { ok: false, error: res.error === 'not_member' ? 'not_member' : 'profile_inactive' };
  }

  async signOut(): Promise<void> {
    await this.rpc('sign_out');
  }

  async leaveHousehold(): Promise<void> {
    try {
      await this.rpc('leave_household');
    } finally {
      await this.db.auth.signOut({ scope: 'local' });
    }
  }

  async changePin(current: string, next: string): Promise<void> {
    await this.rpc('change_pin', { p_current: current, p_new: next });
  }

  // ------------------------------------------------------------------ lectura
  async getHousehold(): Promise<Household> {
    const rows = await this.select<Household[]>(this.db.from('household').select('name, timezone').limit(1));
    return rows[0] ?? { name: 'Mi casa', timezone: 'America/Mexico_City' };
  }

  listProfiles(): Promise<Profile[]> {
    return this.select<Profile[]>(
      this.db.from('profiles').select('id, name, emoji, color, role, sort_order, active').order('sort_order').order('name'),
    );
  }

  listRooms(): Promise<Room[]> {
    return this.select<Room[]>(
      this.db.from('rooms').select('id, name, description, icon, color, sort_order, active').order('sort_order').order('name'),
    );
  }

  listReservations(from: Date, to: Date): Promise<Reservation[]> {
    return this.select<Reservation[]>(
      this.db
        .from('reservations')
        .select(RESERVATION_COLUMNS)
        .is('cancelled_at', null)
        .lt('starts_at', to.toISOString())
        .gt('ends_at', from.toISOString())
        .order('starts_at'),
    );
  }

  listUpcoming(): Promise<Reservation[]> {
    return this.select<Reservation[]>(
      this.db
        .from('reservations')
        .select(RESERVATION_COLUMNS)
        .is('cancelled_at', null)
        .gt('ends_at', new Date().toISOString())
        .order('starts_at')
        .limit(300),
    );
  }

  listHistory(limit = 60): Promise<Reservation[]> {
    return this.select<Reservation[]>(
      this.db
        .from('reservations')
        .select(RESERVATION_COLUMNS)
        .or(`cancelled_at.not.is.null,ends_at.lte."${new Date().toISOString()}"`)
        .order('starts_at', { ascending: false })
        .limit(limit),
    );
  }

  listActivity(limit = 60): Promise<ActivityEntry[]> {
    return this.select<ActivityEntry[]>(
      this.db
        .from('activity')
        .select('id, created_at, kind, actor_id, reservation_id, room_id, data')
        .order('created_at', { ascending: false })
        .limit(limit),
    );
  }

  // ------------------------------------------------------------------ reservas
  createReservation(input: Parameters<Backend['createReservation']>[0]): Promise<Reservation> {
    return this.rpc<Reservation>('create_reservation', {
      p_room_id: input.room_id,
      p_starts_at: input.starts_at.toISOString(),
      p_ends_at: input.ends_at.toISOString(),
      p_purpose: input.purpose,
      p_guests: input.guests,
    });
  }

  updateReservation(id: string, input: Parameters<Backend['updateReservation']>[1]): Promise<Reservation> {
    return this.rpc<Reservation>('update_reservation', {
      p_id: id,
      p_room_id: input.room_id,
      p_starts_at: input.starts_at.toISOString(),
      p_ends_at: input.ends_at.toISOString(),
      p_purpose: input.purpose,
      p_guests: input.guests,
    });
  }

  cancelReservation(id: string): Promise<Reservation> {
    return this.rpc<Reservation>('cancel_reservation', { p_id: id });
  }

  releaseReservation(id: string): Promise<Reservation> {
    return this.rpc<Reservation>('release_reservation', { p_id: id });
  }

  // ------------------------------------------------------------------ ajustes
  updateHousehold(name: string, timezone: string): Promise<Household> {
    return this.rpc<Household>('update_household', { p_name: name, p_timezone: timezone });
  }

  upsertRoom(input: Parameters<Backend['upsertRoom']>[0]): Promise<Room> {
    return this.rpc<Room>('upsert_room', {
      p_id: input.id,
      p_name: input.name,
      p_description: input.description,
      p_icon: input.icon,
      p_color: input.color,
      p_active: input.active,
    });
  }

  upsertProfile(input: Parameters<Backend['upsertProfile']>[0]): Promise<Profile> {
    return this.rpc<Profile>('upsert_profile', {
      p_id: input.id,
      p_name: input.name,
      p_emoji: input.emoji,
      p_color: input.color,
      p_role: input.role ?? null,
      p_active: input.active ?? null,
      p_pin: input.pin ?? null,
    });
  }

  async resetPin(profileId: string, pin: string): Promise<void> {
    await this.rpc('reset_pin', { p_profile_id: profileId, p_new_pin: pin });
  }

  async setFamilyCode(code: string): Promise<void> {
    await this.rpc('set_family_code', { p_code: code });
  }

  signOutOtherDevices(): Promise<number> {
    return this.rpc<number>('sign_out_other_devices');
  }

  async getNotificationSettings(): Promise<NotificationSettings> {
    return mapNotifications(await this.rpc<Record<string, unknown>>('get_notification_settings'));
  }

  async setNotificationSettings(input: Parameters<Backend['setNotificationSettings']>[0]): Promise<NotificationSettings> {
    return mapNotifications(
      await this.rpc<Record<string, unknown>>('set_notification_settings', {
        p_enabled: input.enabled,
        p_telegram_bot_token: input.telegramBotToken,
        p_telegram_chat_id: input.telegramChatId,
        p_webhook_url: input.webhookUrl,
      }),
    );
  }

  testNotification(): Promise<TestNotificationResult> {
    return this.rpc<TestNotificationResult>('test_notification');
  }

  // ------------------------------------------------------------------ tiempo real
  subscribe(...[onChange, onStatus]: Parameters<Backend['subscribe']>): () => void {
    onStatus('connecting');
    const channel = this.db.channel('casa-cambios');
    const simple = ['household', 'profiles', 'rooms', 'reservations'] as const;
    for (const table of simple) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange({ table }));
    }
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, (payload) =>
      onChange({ table: 'activity', activity: payload.new as ActivityEntry }),
    );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus('live');
      else if (status === 'CLOSED') onStatus('offline');
      else onStatus('connecting'); // CHANNEL_ERROR / TIMED_OUT: el cliente reintenta solo
    });
    return () => {
      void this.db.removeChannel(channel);
    };
  }
}

export function assertConfigured(url: string, key: string): void {
  if (!/^https:\/\/.+/.test(url)) {
    throw new AppError('config', 'VITE_SUPABASE_URL no es válida. Revisa las variables de entorno.');
  }
  if (key.length < 20) {
    throw new AppError('config', 'VITE_SUPABASE_ANON_KEY no es válida. Revisa las variables de entorno.');
  }
}
