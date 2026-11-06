import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Bell,
  ChevronRight,
  Crown,
  DoorOpen,
  House,
  KeyRound,
  LogOut,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Smartphone,
  TriangleExclamationPoint,
  Users,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Profile, Room } from '@/types';
import { useApp } from '@/app-context';
import { IS_DEMO } from '@/config';
import { backend } from '@/lib/backend';
import { PROFILE_COLORS, PROFILE_EMOJIS, ROOM_COLORS } from '@/lib/colors';
import { errorMessage } from '@/lib/errors';
import { qk, useHousehold, useProfiles, useRooms } from '@/hooks/queries';
import { ChangePinFlow } from './Access';
import { InstallCard } from '@/components/InstallCard';
import { ROOM_ICONS, RoomIcon } from '@/components/RoomIcon';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, Label, SectionTitle, TextInput } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';

export function SettingsScreen() {
  const { me, isAdmin } = useApp();
  const profiles = useProfiles();
  const current = profiles.byId.get(me.id);

  return (
    <div className="pb-8 pt-2">
      <ProfileSection me={current} fallback={me} />
      <InstallCard force />
      {isAdmin ? (
        <>
          <HouseSection />
          <RoomsSection />
          <FamilySection meId={me.id} />
          <NotificationsSection />
          <SecuritySection />
        </>
      ) : (
        <p className="mt-6 rounded-2xl bg-surface-2 p-3 text-sm text-muted">
          Las salas, la familia y los avisos los administran Papá y Mamá (admins).
        </p>
      )}
      <AppSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
function Row({ icon, title, subtitle, onClick, right, danger }: { icon: ReactNode; title: string; subtitle?: ReactNode; onClick?: () => void; right?: ReactNode; danger?: boolean }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('flex w-full items-center gap-3 px-4 py-3 text-left', onClick && 'transition active:bg-surface-2', danger && 'text-danger')}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle ? <span className="block truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
      {right ?? (onClick ? <ChevronRight className="size-4 text-muted" aria-hidden /> : null)}
    </Comp>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-line')}
    >
      <span className={cn('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', checked ? 'left-[1.4rem]' : 'left-0.5')} />
    </button>
  );
}

function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${c}`}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className="size-9 rounded-full transition active:scale-90"
          style={{ backgroundColor: c, boxShadow: value === c ? `0 0 0 3px var(--app-surface), 0 0 0 5px ${c}` : undefined }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ProfileSection({ me, fallback }: { me?: Profile; fallback: { id: string; name: string; emoji: string; color: string; role: string } }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [changingPin, setChangingPin] = useState(false);
  const toast = useToast();
  const p = me ?? (fallback as Profile);

  const signOut = useMutation({
    mutationFn: () => backend.signOut(),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.session }),
    onError: (e) => toast({ tone: 'error', title: 'No se pudo', description: errorMessage(e) }),
  });

  return (
    <>
      <Card className="mt-2 p-4">
        <div className="flex items-center gap-3">
          <Avatar emoji={p.emoji} color={p.color} name={p.name} size="lg" ring />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold">{p.name}</p>
            <p className="flex items-center gap-1 text-sm text-muted">
              {p.role === 'admin' ? <Crown className="size-3.5 text-amber-500" aria-hidden /> : null}
              {p.role === 'admin' ? 'Admin · puede editar todo' : 'Miembro de la familia'}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Button variant="secondary" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
            Editar
          </Button>
          <Button variant="secondary" size="sm" icon={<KeyRound className="size-4" />} onClick={() => setChangingPin(true)}>
            Mi PIN
          </Button>
          <Button variant="secondary" size="sm" icon={<LogOut className="size-4" />} loading={signOut.isPending} onClick={() => signOut.mutate()}>
            Salir
          </Button>
        </div>
      </Card>
      {editing && me ? <ProfileEditor profile={me} self onClose={() => setEditing(false)} /> : null}
      <Sheet open={changingPin} onClose={() => setChangingPin(false)} title="Cambiar mi PIN">
        <ChangePinFlow
          knownCurrent={null}
          onDone={() => {
            setChangingPin(false);
            toast({ tone: 'success', title: 'PIN actualizado' });
          }}
        />
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
function HouseSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useHousehold();
  const [name, setName] = useState('');
  const [tz, setTz] = useState('');
  useEffect(() => {
    if (data) {
      setName(data.name);
      setTz(data.timezone);
    }
  }, [data]);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return [] as string[];
    }
  }, []);
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const save = useMutation({
    mutationFn: () => backend.updateHousehold(name, tz),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.household });
      toast({ tone: 'success', title: 'Casa actualizada' });
    },
    onError: (e) => toast({ tone: 'error', title: 'No se pudo guardar', description: errorMessage(e) }),
  });

  const dirty = data && (name !== data.name || tz !== data.timezone);

  return (
    <>
      <SectionTitle>Casa</SectionTitle>
      <Card className="space-y-3 p-4">
        <div>
          <Label htmlFor="house-name">Nombre</Label>
          <TextInput id="house-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="house-tz" hint={tz !== deviceTz ? <button type="button" className="font-semibold text-brand" onClick={() => setTz(deviceTz)}>Usar la de este celular</button> : 'Para los avisos'}>
            Zona horaria
          </Label>
          {zones.length ? (
            <select id="house-tz" value={tz} onChange={(e) => setTz(e.target.value)} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[16px]">
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          ) : (
            <TextInput id="house-tz" value={tz} onChange={(e) => setTz(e.target.value)} />
          )}
        </div>
        <Button block disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          Guardar
        </Button>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
function RoomsSection() {
  const rooms = useRooms();
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  return (
    <>
      <SectionTitle
        action={
          <button type="button" onClick={() => setEditing('new')} className="flex items-center gap-1 text-sm font-semibold text-brand">
            <Plus className="size-4" aria-hidden /> Agregar
          </button>
        }
      >
        Salas
      </SectionTitle>
      <Card className="divide-y divide-line overflow-hidden">
        {(rooms.data ?? []).map((r) => (
          <Row
            key={r.id}
            icon={<RoomIcon icon={r.icon} color={r.color} />}
            title={r.name}
            subtitle={r.active ? r.description || 'Activa' : 'Desactivada'}
            onClick={() => setEditing(r)}
          />
        ))}
      </Card>
      {editing ? <RoomEditor room={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function RoomEditor({ room, onClose }: { room: Room | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(room?.name ?? '');
  const [description, setDescription] = useState(room?.description ?? '');
  const [icon, setIcon] = useState(room?.icon ?? 'sofa');
  const [color, setColor] = useState(room?.color ?? ROOM_COLORS[2] ?? '#0d9488');
  const [active, setActive] = useState(room?.active ?? true);

  const save = useMutation({
    mutationFn: () => backend.upsertRoom({ id: room?.id ?? null, name, description: description || null, icon, color, active }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.rooms });
      void qc.invalidateQueries({ queryKey: qk.activity });
      toast({ tone: 'success', title: room ? 'Sala actualizada' : 'Sala agregada' });
      onClose();
    },
    onError: (e) => toast({ tone: 'error', title: 'No se pudo guardar', description: errorMessage(e) }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) save.mutate();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={room ? 'Editar sala' : 'Nueva sala'}
      footer={
        <Button type="submit" form="room-form" block size="lg" loading={save.isPending} disabled={!name.trim()}>
          Guardar
        </Button>
      }
    >
      <form id="room-form" onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
          <RoomIcon icon={icon} color={color} size="lg" />
          <p className="font-semibold">{name || 'Nombre de la sala'}</p>
        </div>
        <div>
          <Label htmlFor="room-name">Nombre</Label>
          <TextInput id="room-name" value={name} maxLength={40} placeholder="Ej. Sala TV" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="room-desc" hint="Opcional">Descripción</Label>
          <TextInput id="room-desc" value={description} maxLength={120} placeholder="Ej. La de la pantalla grande" onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <Label>Ícono</Label>
          <div className="grid grid-cols-5 gap-2">
            {Object.entries(ROOM_ICONS).map(([key, { icon: Icon, label }]) => (
              <button
                key={key}
                type="button"
                aria-label={label}
                aria-pressed={icon === key}
                onClick={() => setIcon(key)}
                className={cn('flex h-12 items-center justify-center rounded-xl border-2', icon === key ? 'border-brand bg-brand/5' : 'border-line')}
              >
                <Icon className="size-5" aria-hidden />
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Color</Label>
          <Swatches colors={ROOM_COLORS} value={color} onChange={setColor} />
        </div>
        {room ? (
          <div className="flex items-center justify-between rounded-2xl border border-line p-3">
            <div>
              <p className="font-medium">Sala activa</p>
              <p className="text-xs text-muted">Si la desactivas ya no se podrá reservar.</p>
            </div>
            <Toggle checked={active} onChange={setActive} label="Sala activa" />
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
function FamilySection({ meId }: { meId: string }) {
  const profiles = useProfiles();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  return (
    <>
      <SectionTitle
        action={
          <button type="button" onClick={() => setEditing('new')} className="flex items-center gap-1 text-sm font-semibold text-brand">
            <Plus className="size-4" aria-hidden /> Agregar
          </button>
        }
      >
        Familia
      </SectionTitle>
      <Card className="divide-y divide-line overflow-hidden">
        {(profiles.data ?? []).map((p) => (
          <Row
            key={p.id}
            icon={<Avatar emoji={p.emoji} color={p.color} name={p.name} size="md" />}
            title={p.id === meId ? `${p.name} (tú)` : p.name}
            subtitle={!p.active ? 'Desactivado' : p.role === 'admin' ? 'Admin' : 'Miembro'}
            onClick={() => setEditing(p)}
          />
        ))}
      </Card>
      {editing ? <ProfileEditor profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function ProfileEditor({ profile, self, onClose }: { profile: Profile | null; self?: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { isAdmin, me } = useApp();
  const [name, setName] = useState(profile?.name ?? '');
  const [emoji, setEmoji] = useState(profile?.emoji ?? '🙂');
  const [color, setColor] = useState(profile?.color ?? PROFILE_COLORS[5] ?? '#dc2626');
  const [role, setRole] = useState(profile?.role ?? 'member');
  const [active, setActive] = useState(profile?.active ?? true);
  const [pin, setPin] = useState('');
  const [resetPin, setResetPin] = useState('');
  const canAdmin = isAdmin && !self;

  const save = useMutation({
    mutationFn: () =>
      backend.upsertProfile({
        id: profile?.id ?? null,
        name,
        emoji,
        color,
        role: canAdmin ? role : null,
        active: canAdmin && profile ? active : null,
        pin: profile ? null : pin,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
      void qc.invalidateQueries({ queryKey: qk.session });
      toast({ tone: 'success', title: profile ? 'Perfil actualizado' : `${name} ya es parte de la familia`, description: profile ? undefined : `Su PIN inicial es ${pin}; se le pedirá cambiarlo.` });
      onClose();
    },
    onError: (e) => toast({ tone: 'error', title: 'No se pudo guardar', description: errorMessage(e) }),
  });

  const reset = useMutation({
    mutationFn: () => backend.resetPin(profile!.id, resetPin),
    onSuccess: () => {
      toast({ tone: 'success', title: `PIN de ${profile?.name} restablecido`, description: `Ahora es ${resetPin}. Se le pedirá cambiarlo al entrar.` });
      setResetPin('');
    },
    onError: (e) => toast({ tone: 'error', title: 'No se pudo', description: errorMessage(e) }),
  });

  const valid = name.trim() && (profile || /^\d{4}$/.test(pin));

  return (
    <Sheet
      open
      onClose={onClose}
      title={profile ? (self ? 'Mi perfil' : `Editar a ${profile.name}`) : 'Agregar persona'}
      footer={
        <Button type="submit" form="profile-form" block size="lg" loading={save.isPending} disabled={!valid}>
          Guardar
        </Button>
      }
    >
      <form
        id="profile-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
        className="space-y-4"
      >
        <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
          <Avatar emoji={emoji} color={color} size="lg" />
          <p className="font-semibold">{name || 'Nombre'}</p>
        </div>
        <div>
          <Label htmlFor="p-name">Nombre</Label>
          <TextInput id="p-name" value={name} maxLength={30} placeholder="Ej. Diego" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label hint={<input aria-label="Otro emoji" value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 8))} className="w-14 rounded-lg border border-line bg-surface px-2 py-0.5 text-center" />}>
            Emoji
          </Label>
          <div className="grid grid-cols-8 gap-1.5">
            {PROFILE_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-pressed={emoji === e}
                className={cn('flex aspect-square items-center justify-center rounded-xl text-xl', emoji === e ? 'bg-brand/15 ring-2 ring-brand' : 'bg-surface-2')}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Color (así se verán tus reservas)</Label>
          <Swatches colors={PROFILE_COLORS} value={color} onChange={setColor} />
        </div>
        {canAdmin ? (
          <div>
            <Label>Rol</Label>
            <Segmented
              label="Rol"
              value={role}
              onChange={setRole}
              options={[
                { value: 'member', label: 'Miembro' },
                { value: 'admin', label: 'Admin (papá/mamá)' },
              ]}
            />
          </div>
        ) : null}
        {!profile ? (
          <div>
            <Label htmlFor="p-pin" hint="Se le pedirá cambiarlo">PIN inicial (4 números)</Label>
            <TextInput id="p-pin" inputMode="numeric" pattern="\d{4}" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </div>
        ) : null}
        {canAdmin && profile ? (
          <>
            {profile.id !== me.id ? (
              <div className="flex items-center justify-between rounded-2xl border border-line p-3">
                <div>
                  <p className="font-medium">Perfil activo</p>
                  <p className="text-xs text-muted">Desactívalo si ya no vive en casa.</p>
                </div>
                <Toggle checked={active} onChange={setActive} label="Perfil activo" />
              </div>
            ) : null}
            <div className="rounded-2xl border border-line p-3">
              <p className="font-medium">¿Olvidó su PIN?</p>
              <p className="mb-2 text-xs text-muted">Ponle uno temporal; al entrar se le pedirá crear el suyo.</p>
              <div className="flex gap-2">
                <TextInput
                  aria-label="PIN temporal"
                  inputMode="numeric"
                  placeholder="0000"
                  maxLength={4}
                  value={resetPin}
                  onChange={(e) => setResetPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
                <Button variant="secondary" disabled={!/^\d{4}$/.test(resetPin)} loading={reset.isPending} onClick={() => reset.mutate()}>
                  Restablecer
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
function NotificationsSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: qk.notifications, queryFn: () => backend.getNotificationSettings() });
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [webhook, setWebhook] = useState('');
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (q.data) {
      setEnabled(q.data.enabled);
      setChatId(q.data.telegramChatId ?? '');
      setWebhook(q.data.webhookUrl ?? '');
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      backend.setNotificationSettings({
        enabled,
        telegramBotToken: token.trim() ? token.trim() : null,
        telegramChatId: chatId || null,
        webhookUrl: webhook || null,
      }),
    onSuccess: (data) => {
      qc.setQueryData(qk.notifications, data);
      setToken('');
      toast({ tone: 'success', title: 'Avisos guardados' });
    },
    onError: (e) => toast({ tone: 'error', title: 'No se pudo guardar', description: errorMessage(e) }),
  });

  const test = useMutation({
    mutationFn: () => backend.testNotification(),
    onSuccess: (res) => {
      if (res.sent) toast({ tone: 'success', title: 'Mensaje de prueba enviado', description: 'Debe llegar en unos segundos.' });
      else
        toast({
          tone: 'error',
          title: 'No se envió',
          description:
            res.reason === 'pg_net_missing'
              ? 'Activa la extensión pg_net en Supabase (Database → Extensions).'
              : res.reason === 'disabled'
                ? 'Activa los avisos y guarda primero.'
                : 'Configura Telegram o un webhook y guarda primero.',
        });
    },
    onError: (e) => toast({ tone: 'error', title: 'No se pudo', description: errorMessage(e) }),
  });

  return (
    <>
      <SectionTitle>Avisos (Telegram / WhatsApp)</SectionTitle>
      <Card className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <Bell className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <p className="flex-1 text-sm text-muted">
            Cada reserva, cambio o cancelación también se manda al grupo de la familia. Ej.: <i>“✅ Hijo 1 acaba de separar Sala Lounge para este sábado de 8pm a 12am”</i>.
          </p>
          <Toggle checked={enabled} onChange={setEnabled} label="Activar avisos" />
        </div>
        {q.data && !q.data.pgNetAvailable && !IS_DEMO ? (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleExclamationPoint className="size-4 shrink-0" aria-hidden />
            Falta activar la extensión <b>pg_net</b> en Supabase → Database → Extensions.
          </p>
        ) : null}
        {IS_DEMO ? <p className="rounded-xl bg-surface-2 p-2.5 text-xs text-muted">En modo demo los avisos no se envían de verdad.</p> : null}
        <div>
          <Label htmlFor="tg-token" hint={q.data?.hasTelegramToken ? '✓ Guardado' : undefined}>Token del bot de Telegram</Label>
          <TextInput
            id="tg-token"
            type="password"
            autoComplete="off"
            placeholder={q.data?.hasTelegramToken ? '•••••••• (déjalo vacío para no cambiarlo)' : '123456789:AA…'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="tg-chat">Chat ID del grupo</Label>
          <TextInput id="tg-chat" inputMode="text" placeholder="-1001234567890" value={chatId} onChange={(e) => setChatId(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="webhook" hint="Opcional">Webhook (WhatsApp vía n8n/Make/Zapier, Discord, Slack…)</Label>
          <TextInput id="webhook" type="url" placeholder="https://…" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" icon={<Send className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>
            Probar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </div>
        <button type="button" onClick={() => setHelp((h) => !h)} className="text-sm font-semibold text-brand">
          {help ? 'Ocultar ayuda' : '¿Cómo creo el bot de Telegram? (2 min)'}
        </button>
        {help ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>
              En Telegram abre <b>@BotFather</b>, escribe <code>/newbot</code> y copia el <b>token</b>.
            </li>
            <li>Agrega tu bot al grupo de la familia y manda cualquier mensaje en el grupo.</li>
            <li>
              Abre <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> y copia el número de <code>"chat":{'{'}"id": …{'}'}</code> (empieza con <code>-100…</code>).
            </li>
            <li>Pega token y chat ID aquí, activa los avisos, guarda y toca “Probar”.</li>
            <li>
              ¿WhatsApp? Usa el webhook con n8n/Make/Zapier (o CallMeBot para mensajes a un número). Recibe JSON con <code>text</code>.
            </li>
          </ol>
        ) : null}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
function SecuritySection() {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [confirmKick, setConfirmKick] = useState(false);

  const saveCode = useMutation({
    mutationFn: () => backend.setFamilyCode(code),
    onSuccess: () => {
      toast({ tone: 'success', title: 'Código de la casa actualizado', description: 'Los celulares que ya entraron siguen dentro.' });
      setCode('');
    },
    onError: (e) => toast({ tone: 'error', title: 'No se pudo', description: errorMessage(e) }),
  });

  const kick = useMutation({
    mutationFn: () => backend.signOutOtherDevices(),
    onSuccess: (n) => {
      toast({ tone: 'success', title: 'Listo', description: `Se cerró la sesión en ${n} dispositivo${n === 1 ? '' : 's'}. Tendrán que volver a poner el código.` });
      setConfirmKick(false);
    },
    onError: (e) => toast({ tone: 'error', title: 'No se pudo', description: errorMessage(e) }),
  });

  return (
    <>
      <SectionTitle>Seguridad</SectionTitle>
      <Card className="space-y-4 p-4">
        <div>
          <Label htmlFor="family-code" hint="Mín. 6 caracteres">Nuevo código de la casa</Label>
          <div className="flex gap-2">
            <TextInput id="family-code" autoCapitalize="none" autoComplete="off" placeholder="Ej. tacos-al-pastor" value={code} onChange={(e) => setCode(e.target.value)} />
            <Button variant="secondary" disabled={code.trim().length < 6} loading={saveCode.isPending} onClick={() => saveCode.mutate()}>
              Cambiar
            </Button>
          </div>
        </div>
        <div className="border-t border-line pt-4">
          <p className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4 text-brand" aria-hidden /> ¿Se perdió un celular?
          </p>
          <p className="mb-2 text-xs text-muted">Cambia el código y cierra la sesión en todos los demás dispositivos.</p>
          {confirmKick ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirmKick(false)}>
                No
              </Button>
              <Button variant="danger" loading={kick.isPending} onClick={() => kick.mutate()}>
                Sí, sacarlos
              </Button>
            </div>
          ) : (
            <Button variant="soft-danger" block icon={<Users className="size-4" />} onClick={() => setConfirmKick(true)}>
              Cerrar sesión en los demás dispositivos
            </Button>
          )}
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
function AppSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const leave = useMutation({
    mutationFn: () => backend.leaveHousehold(),
    onSuccess: () => void qc.resetQueries(),
    onError: (e) => toast({ tone: 'error', title: 'No se pudo', description: errorMessage(e) }),
  });

  return (
    <>
      <SectionTitle>App</SectionTitle>
      <Card className="divide-y divide-line overflow-hidden">
        <Row
          icon={<House className="size-5 text-muted" />}
          title={IS_DEMO ? 'Modo demo' : 'Conectada a Supabase'}
          subtitle={IS_DEMO ? 'Los datos viven solo en este navegador' : 'Datos en tiempo real para toda la familia'}
        />
        <Row icon={<Smartphone className="size-5 text-muted" />} title="Versión" subtitle={__APP_VERSION__} />
        {confirm ? (
          <div className="space-y-2 p-4">
            <p className="text-sm">
              {IS_DEMO
                ? 'Se borrarán los datos de prueba y volverás a la pantalla de inicio.'
                : 'Este celular tendrá que volver a escribir el código de la casa. Tus reservas no se borran.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={leave.isPending} onClick={() => leave.mutate()}>
                Sí, salir
              </Button>
            </div>
          </div>
        ) : (
          <Row
            icon={<DoorOpen className="size-5" />}
            title={IS_DEMO ? 'Reiniciar demo' : 'Salir de la casa en este dispositivo'}
            danger
            onClick={() => setConfirm(true)}
          />
        )}
      </Card>
    </>
  );
}
