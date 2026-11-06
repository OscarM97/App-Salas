import type {
  ActivityEntry,
  ActivityKind,
  ChangeEvent,
  ChangeTable,
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
import { DEMO_PIN } from '@/config';
import { AppError } from '../errors';
import { findConflicts, statusOf } from '../reservations';
import { HOUR, MINUTE, addDays, dayStart, fmtTime, relativeDay, roundDown } from '../time';
import type { Backend } from './types';

/**
 * Backend 100% local (localStorage + BroadcastChannel) que aplica las mismas
 * reglas que las funciones SQL de Supabase. Sirve para probar la app sin
 * configurar nada y para las pruebas automáticas.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PinState {
  pin: string;
  mustChange: boolean;
  failed: number;
  lockedUntil: string | null;
}

interface DemoData {
  household: Household;
  profiles: Profile[];
  rooms: Room[];
  reservations: Reservation[];
  activity: ActivityEntry[];
  pins: Record<string, PinState>;
  familyCode: string;
  notify: { enabled: boolean; telegramToken: string | null; telegramChatId: string | null; webhookUrl: string | null };
  nextActivityId: number;
}

interface DeviceState {
  joined: boolean;
  profileId: string | null;
  joinFailures: number[];
}

export interface DemoOptions {
  storage?: KeyValueStore;
  now?: () => Date;
  latencyMs?: number;
  seed?: boolean;
  /** Sincronizar entre pestañas con BroadcastChannel (desactívalo en pruebas). */
  broadcast?: boolean;
}

const DATA_KEY = 'salas-demo-data-v1';
const DEVICE_KEY = 'salas-demo-device-v1';
const CHANNEL = 'salas-demo';
export const DEMO_FAMILY_CODE = 'demo-casa';
const MAX_PIN_ATTEMPTS = 5;
const LOCK_MS = 5 * MINUTE;

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** localStorage puede no existir o lanzar error (modo privado, iframes). */
function safeLocalStorage(): KeyValueStore {
  try {
    const s = window.localStorage;
    s.setItem('__salas_test__', '1');
    s.removeItem('__salas_test__');
    return s;
  } catch {
    return memoryStore();
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function clean(text: string | null | undefined, max: number): string | null {
  const v = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return v || null;
}

function fail(code: ConstructorParameters<typeof AppError>[0], message: string): never {
  throw new AppError(code, message);
}

export class DemoBackend implements Backend {
  readonly mode = 'demo' as const;
  private readonly storage: KeyValueStore;
  private readonly now: () => Date;
  private readonly latency: number;
  private readonly listeners = new Set<(e: ChangeEvent) => void>();
  private channel: BroadcastChannel | null = null;

  constructor(opts: DemoOptions = {}) {
    this.storage = opts.storage ?? (typeof window !== 'undefined' ? safeLocalStorage() : memoryStore());
    this.now = opts.now ?? (() => new Date());
    this.latency = opts.latencyMs ?? 80;
    if (!this.storage.getItem(DATA_KEY)) this.write(this.seed(opts.seed ?? true));
    if ((opts.broadcast ?? true) && typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(CHANNEL);
        this.channel.onmessage = (ev: MessageEvent<ChangeEvent>) => this.listeners.forEach((l) => l(ev.data));
      } catch {
        this.channel = null; // sin sincronización entre pestañas; todo lo demás funciona
      }
    }
  }

  // ------------------------------------------------------------------ almacenamiento
  private read(): DemoData {
    return JSON.parse(this.storage.getItem(DATA_KEY) as string) as DemoData;
  }

  private write(data: DemoData): void {
    this.storage.setItem(DATA_KEY, JSON.stringify(data));
  }

  private device(): DeviceState {
    const raw = this.storage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as DeviceState) : { joined: true, profileId: null, joinFailures: [] };
  }

  private saveDevice(d: DeviceState): void {
    this.storage.setItem(DEVICE_KEY, JSON.stringify(d));
  }

  private async tick(): Promise<void> {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency));
  }

  private emit(tables: ChangeTable[], activity?: ActivityEntry): void {
    for (const table of tables) {
      const ev: ChangeEvent = table === 'activity' && activity ? { table, activity } : { table };
      this.listeners.forEach((l) => l(ev));
      this.channel?.postMessage(ev);
    }
  }

  private me(data: DemoData): Profile | null {
    const d = this.device();
    if (!d.joined || !d.profileId) return null;
    return data.profiles.find((p) => p.id === d.profileId && p.active) ?? null;
  }

  private requireProfile(data: DemoData): Profile {
    return this.me(data) ?? fail('no_profile', 'Primero elige tu perfil en este dispositivo.');
  }

  private requireAdmin(data: DemoData): Profile {
    const me = this.requireProfile(data);
    if (me.role !== 'admin') fail('forbidden', 'Solo Papá o Mamá (admins) pueden hacer esto.');
    return me;
  }

  private addActivity(data: DemoData, kind: ActivityKind, r: Reservation | null, roomId: string | null, extra: object = {}): ActivityEntry {
    const actor = this.me(data);
    const snapshot = r
      ? {
          owner_id: r.profile_id,
          owner_name: data.profiles.find((p) => p.id === r.profile_id)?.name,
          room_name: data.rooms.find((x) => x.id === r.room_id)?.name,
          starts_at: r.starts_at,
          ends_at: r.ends_at,
          purpose: r.purpose,
          guests: r.guests,
        }
      : {};
    const entry: ActivityEntry = {
      id: data.nextActivityId++,
      created_at: this.now().toISOString(),
      kind,
      actor_id: actor?.id ?? null,
      reservation_id: r?.id ?? null,
      room_id: roomId,
      data: { ...snapshot, ...extra, actor_name: actor?.name },
    };
    data.activity.push(entry);
    if (data.activity.length > 300) data.activity.splice(0, data.activity.length - 300);
    return entry;
  }

  private validate(data: DemoData, input: ReservationInput, excludeId: string | null): { start: Date; end: Date } {
    const room = data.rooms.find((r) => r.id === input.room_id && r.active);
    if (!room) fail('room_inactive', 'Esa sala no existe o está desactivada.');
    const start = new Date(Math.floor(input.starts_at.getTime() / MINUTE) * MINUTE);
    const end = new Date(Math.floor(input.ends_at.getTime() / MINUTE) * MINUTE);
    const now = this.now().getTime();
    if (end <= start) fail('invalid_range', 'La hora de fin debe ser después de la de inicio.');
    if (end.getTime() - start.getTime() < 15 * MINUTE) fail('invalid_range', 'La reserva debe durar al menos 15 minutos.');
    if (end.getTime() - start.getTime() > 24 * HOUR) fail('invalid_range', 'Una reserva puede durar máximo 24 horas.');
    if (end.getTime() <= now) fail('in_past', 'Ese horario ya pasó.');
    if (start.getTime() > now + 365 * 24 * HOUR) fail('too_far', 'Solo puedes reservar con hasta un año de anticipación.');
    const [c] = findConflicts(data.reservations, room.id, start, end, excludeId);
    if (c) {
      const owner = data.profiles.find((p) => p.id === c.profile_id)?.name ?? 'alguien';
      throw new AppError(
        'room_conflict',
        `${room.name} ya está ocupada por ${owner} ${relativeDay(c.starts_at, this.now())} de ${fmtTime(c.starts_at)} a ${fmtTime(c.ends_at)}.`,
        { reservation_id: c.id, profile_id: c.profile_id, owner_name: owner, starts_at: c.starts_at, ends_at: c.ends_at, purpose: c.purpose },
      );
    }
    return { start, end };
  }

  private loadForChange(data: DemoData, id: string): Reservation {
    const r = data.reservations.find((x) => x.id === id) ?? fail('not_found', 'Esa reserva ya no existe.');
    const me = this.requireProfile(data);
    if (r.profile_id !== me.id && me.role !== 'admin') {
      const owner = data.profiles.find((p) => p.id === r.profile_id)?.name ?? 'quien la creó';
      fail('forbidden', `Solo ${owner} o un admin pueden modificar esta reserva.`);
    }
    if (r.cancelled_at) fail('already_cancelled', 'Esa reserva ya estaba cancelada.');
    return r;
  }

  // ------------------------------------------------------------------ sesión
  async getSession(): Promise<SessionInfo> {
    await this.tick();
    const data = this.read();
    const d = this.device();
    const me = this.me(data);
    return {
      isMember: d.joined,
      profile: me ? { id: me.id, name: me.name, emoji: me.emoji, color: me.color, role: me.role } : null,
      mustChangePin: me ? data.pins[me.id]?.mustChange ?? false : false,
    };
  }

  async joinHousehold(code: string): Promise<JoinResult> {
    await this.tick();
    const d = this.device();
    if (d.joined) return { ok: true };
    const now = this.now().getTime();
    d.joinFailures = d.joinFailures.filter((t) => now - t < 10 * MINUTE);
    if (d.joinFailures.length >= 5) {
      this.saveDevice(d);
      return { ok: false, error: 'rate_limited' };
    }
    if (code.trim().toLowerCase() !== this.read().familyCode) {
      d.joinFailures.push(now);
      this.saveDevice(d);
      return { ok: false, error: 'invalid_code' };
    }
    this.saveDevice({ joined: true, profileId: null, joinFailures: [] });
    return { ok: true };
  }

  async signIn(profileId: string, pin: string): Promise<SignInResult> {
    await this.tick();
    const data = this.read();
    if (!this.device().joined) return { ok: false, error: 'not_member' };
    const profile = data.profiles.find((p) => p.id === profileId && p.active);
    const state = data.pins[profileId];
    if (!profile || !state) return { ok: false, error: 'profile_inactive' };
    const now = this.now().getTime();
    if (state.lockedUntil && new Date(state.lockedUntil).getTime() > now) {
      return { ok: false, error: 'locked', retryAt: state.lockedUntil };
    }
    if (pin !== state.pin) {
      if (state.failed + 1 >= MAX_PIN_ATTEMPTS) {
        state.failed = 0;
        state.lockedUntil = new Date(now + LOCK_MS).toISOString();
        this.write(data);
        return { ok: false, error: 'locked', retryAt: state.lockedUntil };
      }
      state.failed += 1;
      state.lockedUntil = null;
      this.write(data);
      return { ok: false, error: 'invalid_pin', remaining: MAX_PIN_ATTEMPTS - state.failed };
    }
    state.failed = 0;
    state.lockedUntil = null;
    this.write(data);
    this.saveDevice({ ...this.device(), profileId });
    return { ok: true, session: await this.getSession() };
  }

  async signOut(): Promise<void> {
    await this.tick();
    this.saveDevice({ ...this.device(), profileId: null });
  }

  /** En demo, "salir de la casa" también reinicia los datos de ejemplo. */
  async leaveHousehold(): Promise<void> {
    await this.tick();
    this.storage.removeItem(DATA_KEY);
    this.write(this.seed(true));
    this.saveDevice({ joined: false, profileId: null, joinFailures: [] });
    this.emit(['household', 'profiles', 'rooms', 'reservations', 'activity']);
  }

  async changePin(current: string, next: string): Promise<void> {
    await this.tick();
    const data = this.read();
    const me = this.requireProfile(data);
    if (!/^\d{4}$/.test(next)) fail('invalid_pin_format', 'El PIN nuevo debe tener exactamente 4 números.');
    const state = data.pins[me.id];
    if (!state || state.pin !== current) fail('invalid_pin', 'Tu PIN actual no es correcto.');
    if (next === current) fail('invalid_pin_format', 'El PIN nuevo debe ser diferente al actual.');
    data.pins[me.id] = { pin: next, mustChange: false, failed: 0, lockedUntil: null };
    this.write(data);
  }

  // ------------------------------------------------------------------ lectura
  async getHousehold(): Promise<Household> {
    await this.tick();
    return this.read().household;
  }

  async listProfiles(): Promise<Profile[]> {
    await this.tick();
    return [...this.read().profiles].sort((a, b) => a.sort_order - b.sort_order);
  }

  async listRooms(): Promise<Room[]> {
    await this.tick();
    return [...this.read().rooms].sort((a, b) => a.sort_order - b.sort_order);
  }

  async listReservations(from: Date, to: Date): Promise<Reservation[]> {
    await this.tick();
    return this.read()
      .reservations.filter((r) => !r.cancelled_at && new Date(r.starts_at) < to && new Date(r.ends_at) > from)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  async listUpcoming(): Promise<Reservation[]> {
    await this.tick();
    const now = this.now();
    return this.read()
      .reservations.filter((r) => !r.cancelled_at && new Date(r.ends_at) > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  async listHistory(limit = 60): Promise<Reservation[]> {
    await this.tick();
    const now = this.now();
    return this.read()
      .reservations.filter((r) => r.cancelled_at || new Date(r.ends_at) <= now)
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
      .slice(0, limit);
  }

  async listActivity(limit = 60): Promise<ActivityEntry[]> {
    await this.tick();
    return [...this.read().activity].sort((a, b) => b.id - a.id).slice(0, limit);
  }

  // ------------------------------------------------------------------ reservas
  async createReservation(input: ReservationInput): Promise<Reservation> {
    await this.tick();
    const data = this.read();
    const me = this.requireProfile(data);
    const { start, end } = this.validate(data, input, null);
    const ts = this.now().toISOString();
    const r: Reservation = {
      id: uid(),
      room_id: input.room_id,
      profile_id: me.id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      purpose: clean(input.purpose, 80),
      guests: clean(input.guests, 80),
      created_at: ts,
      updated_at: ts,
      cancelled_at: null,
      cancelled_by: null,
    };
    data.reservations.push(r);
    const a = this.addActivity(data, 'reservation.created', r, r.room_id);
    this.write(data);
    this.emit(['reservations', 'activity'], a);
    return r;
  }

  async updateReservation(id: string, input: ReservationInput): Promise<Reservation> {
    await this.tick();
    const data = this.read();
    const r = this.loadForChange(data, id);
    if (new Date(r.ends_at).getTime() <= this.now().getTime()) fail('in_past', 'Esa reserva ya terminó; ya no se puede editar.');
    const { start, end } = this.validate(data, input, id);
    const previous = {
      room_id: r.room_id,
      room_name: data.rooms.find((x) => x.id === r.room_id)?.name,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
    };
    Object.assign(r, {
      room_id: input.room_id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      purpose: clean(input.purpose, 80),
      guests: clean(input.guests, 80),
      updated_at: this.now().toISOString(),
    });
    const a = this.addActivity(data, 'reservation.updated', r, r.room_id, { previous });
    this.write(data);
    this.emit(['reservations', 'activity'], a);
    return { ...r };
  }

  async cancelReservation(id: string): Promise<Reservation> {
    await this.tick();
    const data = this.read();
    const r = this.loadForChange(data, id);
    const status = statusOf(r, this.now());
    if (status === 'finished') fail('in_past', 'Esa reserva ya terminó.');
    if (status === 'in_progress') fail('in_progress', 'Esta reserva ya empezó: usa "Liberar sala" para terminarla antes.');
    const me = this.requireProfile(data);
    r.cancelled_at = this.now().toISOString();
    r.cancelled_by = me.id;
    r.updated_at = r.cancelled_at;
    const a = this.addActivity(data, 'reservation.cancelled', r, r.room_id);
    this.write(data);
    this.emit(['reservations', 'activity'], a);
    return { ...r };
  }

  async releaseReservation(id: string): Promise<Reservation> {
    await this.tick();
    const data = this.read();
    const r = this.loadForChange(data, id);
    const status = statusOf(r, this.now());
    if (status === 'upcoming') fail('not_started', 'Esta reserva aún no empieza: mejor cancélala.');
    if (status === 'finished') fail('in_past', 'Esa reserva ya terminó.');
    const now = this.now();
    r.ends_at = new Date(Math.max(now.getTime(), new Date(r.starts_at).getTime() + MINUTE)).toISOString();
    r.updated_at = now.toISOString();
    const a = this.addActivity(data, 'reservation.released', r, r.room_id);
    this.write(data);
    this.emit(['reservations', 'activity'], a);
    return { ...r };
  }

  // ------------------------------------------------------------------ ajustes
  async updateHousehold(name: string, timezone: string): Promise<Household> {
    await this.tick();
    const data = this.read();
    this.requireAdmin(data);
    const n = clean(name, 40) ?? fail('invalid_input', 'Escribe un nombre para la casa.');
    data.household = { name: n, timezone };
    this.write(data);
    this.emit(['household']);
    return data.household;
  }

  async upsertRoom(input: RoomInput): Promise<Room> {
    await this.tick();
    const data = this.read();
    this.requireAdmin(data);
    const name = clean(input.name, 40) ?? fail('invalid_input', 'Escribe un nombre para la sala.');
    if (!input.id) {
      const room: Room = {
        id: uid(),
        name,
        description: clean(input.description, 120),
        icon: input.icon || 'sofa',
        color: input.color || '#4f46e5',
        sort_order: Math.max(0, ...data.rooms.map((r) => r.sort_order)) + 1,
        active: true,
      };
      data.rooms.push(room);
      const a = this.addActivity(data, 'room.created', null, room.id, { room_name: room.name });
      this.write(data);
      this.emit(['rooms', 'activity'], a);
      return room;
    }
    const room = data.rooms.find((r) => r.id === input.id) ?? fail('not_found', 'Esa sala no existe.');
    if (room.active && !input.active) {
      if (!data.rooms.some((r) => r.active && r.id !== room.id)) fail('invalid_input', 'Debe quedar al menos una sala activa.');
      const upcoming = data.reservations.filter(
        (r) => r.room_id === room.id && !r.cancelled_at && new Date(r.ends_at) > this.now(),
      ).length;
      if (upcoming) fail('has_reservations', `Esta sala tiene ${upcoming} reserva(s) próximas. Cancélalas antes de desactivarla.`);
    }
    const oldName = room.name;
    const oldActive = room.active;
    Object.assign(room, { name, description: clean(input.description, 120), icon: input.icon, color: input.color, active: input.active });
    let a: ActivityEntry | undefined;
    if (oldName !== room.name || oldActive !== room.active) {
      a = this.addActivity(data, 'room.updated', null, room.id, { room_name: room.name, old_name: oldName, active: room.active });
    }
    this.write(data);
    this.emit(a ? ['rooms', 'activity'] : ['rooms'], a);
    return { ...room };
  }

  async upsertProfile(input: ProfileInput): Promise<Profile> {
    await this.tick();
    const data = this.read();
    const me = this.requireProfile(data);
    const isAdmin = me.role === 'admin';
    const name = clean(input.name, 30) ?? fail('invalid_input', 'Escribe un nombre.');
    if (!input.id) {
      if (!isAdmin) fail('forbidden', 'Solo Papá o Mamá (admins) pueden agregar personas.');
      if (!input.pin || !/^\d{4}$/.test(input.pin)) fail('invalid_pin_format', 'El PIN inicial debe tener 4 números.');
      const p: Profile = {
        id: uid(),
        name,
        emoji: input.emoji.trim() || '🙂',
        color: input.color,
        role: input.role ?? 'member',
        sort_order: Math.max(0, ...data.profiles.map((x) => x.sort_order)) + 1,
        active: true,
      };
      data.profiles.push(p);
      data.pins[p.id] = { pin: input.pin, mustChange: true, failed: 0, lockedUntil: null };
      this.write(data);
      this.emit(['profiles']);
      return p;
    }
    const p = data.profiles.find((x) => x.id === input.id) ?? fail('not_found', 'Ese perfil no existe.');
    const role = input.role ?? p.role;
    const active = input.active ?? p.active;
    if (!isAdmin) {
      if (p.id !== me.id) fail('forbidden', 'Solo puedes editar tu propio perfil.');
      if (role !== p.role || active !== p.active) {
        fail('forbidden', 'Solo Papá o Mamá (admins) pueden cambiar roles o desactivar perfiles.');
      }
    }
    if (p.role === 'admin' && p.active && (role !== 'admin' || !active)) {
      if (!data.profiles.some((x) => x.role === 'admin' && x.active && x.id !== p.id)) {
        fail('last_admin', 'Debe quedar al menos un admin activo.');
      }
    }
    if (p.active && !active) {
      const upcoming = data.reservations.filter(
        (r) => r.profile_id === p.id && !r.cancelled_at && new Date(r.ends_at) > this.now(),
      ).length;
      if (upcoming) {
        fail('has_reservations', `${p.name} tiene ${upcoming} reserva(s) próximas. Cancélalas antes de desactivar el perfil.`);
      }
    }
    Object.assign(p, { name, emoji: input.emoji.trim() || p.emoji, color: input.color || p.color, role, active });
    this.write(data);
    this.emit(['profiles']);
    return { ...p };
  }

  async resetPin(profileId: string, pin: string): Promise<void> {
    await this.tick();
    const data = this.read();
    this.requireAdmin(data);
    if (!/^\d{4}$/.test(pin)) fail('invalid_pin_format', 'El PIN debe tener 4 números.');
    data.pins[profileId] = { pin, mustChange: true, failed: 0, lockedUntil: null };
    this.write(data);
  }

  async setFamilyCode(code: string): Promise<void> {
    await this.tick();
    const data = this.read();
    this.requireAdmin(data);
    if (code.trim().length < 6) fail('invalid_input', 'El código de la casa debe tener al menos 6 caracteres.');
    data.familyCode = code.trim().toLowerCase();
    this.write(data);
  }

  async signOutOtherDevices(): Promise<number> {
    await this.tick();
    this.requireAdmin(this.read());
    return 0;
  }

  private notificationView(data: DemoData): NotificationSettings {
    return {
      enabled: data.notify.enabled,
      hasTelegramToken: Boolean(data.notify.telegramToken),
      telegramChatId: data.notify.telegramChatId,
      webhookUrl: data.notify.webhookUrl,
      pgNetAvailable: false,
    };
  }

  async getNotificationSettings(): Promise<NotificationSettings> {
    await this.tick();
    const data = this.read();
    this.requireAdmin(data);
    return this.notificationView(data);
  }

  async setNotificationSettings(input: NotificationSettingsInput): Promise<NotificationSettings> {
    await this.tick();
    const data = this.read();
    this.requireAdmin(data);
    const token = input.telegramBotToken?.trim();
    if (token && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
      fail('invalid_input', 'El token del bot de Telegram no tiene el formato correcto (123456:ABC…).');
    }
    const url = input.webhookUrl?.trim() || null;
    if (url && !/^https:\/\/\S+$/.test(url)) fail('invalid_input', 'El webhook debe ser una URL https://');
    data.notify = {
      enabled: input.enabled,
      telegramToken: token === undefined || input.telegramBotToken === null ? data.notify.telegramToken : token || null,
      telegramChatId: input.telegramChatId?.trim() || null,
      webhookUrl: url,
    };
    this.write(data);
    return this.notificationView(data);
  }

  async testNotification(): Promise<TestNotificationResult> {
    await this.tick();
    this.requireAdmin(this.read());
    return { sent: false, reason: 'pg_net_missing' };
  }

  // ------------------------------------------------------------------ tiempo real
  subscribe(onChange: (e: ChangeEvent) => void, onStatus: (s: LiveStatus) => void): () => void {
    this.listeners.add(onChange);
    onStatus('live');
    return () => {
      this.listeners.delete(onChange);
    };
  }

  // ------------------------------------------------------------------ datos de ejemplo
  private seed(withSamples: boolean): DemoData {
    const profiles: Profile[] = [
      { id: uid(), name: 'Papá', emoji: '👨', color: '#2563eb', role: 'admin', sort_order: 1, active: true },
      { id: uid(), name: 'Mamá', emoji: '👩', color: '#db2777', role: 'admin', sort_order: 2, active: true },
      { id: uid(), name: 'Hijo 1', emoji: '🧑', color: '#d97706', role: 'member', sort_order: 3, active: true },
      { id: uid(), name: 'Hijo 2', emoji: '👦', color: '#7c3aed', role: 'member', sort_order: 4, active: true },
      { id: uid(), name: 'Hijo 3', emoji: '👧', color: '#0891b2', role: 'member', sort_order: 5, active: true },
    ];
    const rooms: Room[] = [
      { id: uid(), name: 'Sala Principal / TV', description: 'La sala grande con la pantalla', icon: 'tv', color: '#4f46e5', sort_order: 1, active: true },
      { id: uid(), name: 'Sala Lounge / Terraza', description: 'La sala chica junto a la terraza', icon: 'sofa', color: '#ea580c', sort_order: 2, active: true },
    ];
    const data: DemoData = {
      household: { name: 'Casa (demo)', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City' },
      profiles,
      rooms,
      reservations: [],
      activity: [],
      pins: Object.fromEntries(profiles.map((p) => [p.id, { pin: DEMO_PIN, mustChange: false, failed: 0, lockedUntil: null }])),
      familyCode: DEMO_FAMILY_CODE,
      notify: { enabled: false, telegramToken: null, telegramChatId: null, webhookUrl: null },
      nextActivityId: 1,
    };
    if (!withSamples) return data;

    const now = this.now();
    const today = dayStart(now);
    const [papa, mama, hijo1, hijo2, hijo3] = profiles as [Profile, Profile, Profile, Profile, Profile];
    const [tv, lounge] = rooms as [Room, Room];
    const daysToSaturday = (6 - today.getDay() + 7) % 7 || 7;
    const at = (dayOffset: number, hour: number, minute = 0) =>
      new Date(addDays(today, dayOffset).getTime() + hour * HOUR + minute * MINUTE);
    const nowStart = roundDown(new Date(now.getTime() - 40 * MINUTE), 15);

    const samples: Array<[Profile, Room, Date, Date, string | null, string | null, number]> = [
      [hijo3, lounge, nowStart, new Date(nowStart.getTime() + 2 * HOUR), 'Estudio para examen', 'Valeria', 180],
      [papa, tv, at(0, 20), at(0, 22, 30), 'Partido de fútbol ⚽', null, 120],
      [hijo1, lounge, at(0, 21), at(1, 0), 'Noche de juegos de mesa', 'Sofía', 95],
      [mama, lounge, at(1, 10), at(1, 12), 'Café con mis amigas', null, 70],
      [hijo2, tv, at(1, 16), at(1, 19), 'Videojuegos 🎮', 'Amigos de la escuela', 45],
      [hijo3, tv, at(daysToSaturday, 20), at(daysToSaturday + 1, 0), 'Noche de pelis 🍿', 'Andrés', 20],
      [hijo1, lounge, at(daysToSaturday, 18), at(daysToSaturday, 22), 'Cena con amigos', 'Sofía y 3 amigos', 8],
    ];
    for (const [who, room, start, end, purpose, guests, minutesAgo] of samples) {
      if (end <= now) continue;
      if (findConflicts(data.reservations, room.id, start, end).length) continue;
      const created = new Date(now.getTime() - minutesAgo * MINUTE).toISOString();
      const r: Reservation = {
        id: uid(),
        room_id: room.id,
        profile_id: who.id,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        purpose,
        guests,
        created_at: created,
        updated_at: created,
        cancelled_at: null,
        cancelled_by: null,
      };
      data.reservations.push(r);
      data.activity.push({
        id: data.nextActivityId++,
        created_at: created,
        kind: 'reservation.created',
        actor_id: who.id,
        reservation_id: r.id,
        room_id: room.id,
        data: {
          owner_id: who.id, owner_name: who.name, actor_name: who.name, room_name: room.name,
          starts_at: r.starts_at, ends_at: r.ends_at, purpose, guests,
        },
      });
    }
    data.activity.sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach((a, i) => (a.id = i + 1));
    data.nextActivityId = data.activity.length + 1;
    return data;
  }
}
