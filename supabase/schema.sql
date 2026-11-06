-- =============================================================================
--  🛋️  SALAS DE LA CASA — Script de inicialización de base de datos (Supabase)
-- =============================================================================
--  Cómo usarlo (2 minutos):
--   1. Edita los valores de "CONFIGURACIÓN INICIAL" justo aquí abajo.
--   2. Supabase → SQL Editor → New query → pega TODO este archivo → Run.
--   3. Supabase → Authentication → Sign In / Providers →
--      activa "Allow anonymous sign-ins".
--
--  Modelo de seguridad:
--   • Cada celular entra 1 sola vez con el "código de la casa" (sesión anónima
--     de Supabase Auth que queda recordada en el dispositivo).
--   • Después cada quien elige su perfil y escribe su PIN de 4 dígitos.
--   • Solo los dispositivos de la casa pueden LEER (RLS). Nadie escribe directo
--     a las tablas: todo pasa por funciones (RPC) que validan perfil, permisos
--     y traslapes. Además, una restricción EXCLUDE en Postgres hace imposible
--     guardar dos reservas encimadas en la misma sala, aunque lleguen al mismo
--     milisegundo.
--
--  Es idempotente: puedes volver a correrlo (p. ej. al actualizar la app) y NO
--  borra reservas, perfiles ni PINs. Los valores iniciales solo se usan la
--  primera vez.
-- =============================================================================


-- ✏️ CONFIGURACIÓN INICIAL ----------------------------------------------------
drop table if exists pg_temp._setup;
create temp table _setup as select
  'mi-casa-2026'::text        as family_code,  -- Código de la casa (mín. 6 caracteres, no distingue mayúsculas).
  '0000'::text                as initial_pin,  -- PIN inicial de TODOS los perfiles (al entrar se pide cambiarlo).
  'Mi casa'::text             as house_name,   -- Nombre que se ve arriba en la app.
  'America/Mexico_City'::text as timezone;     -- Zona horaria de la casa (para los avisos de Telegram/Webhook).
-- Los perfiles (Papá, Mamá, Cecy…) y las salas se definen en la sección 9.
-- También puedes cambiarlos después desde la app → Ajustes.
-- -----------------------------------------------------------------------------


-- =============================================================================
-- 1. Extensiones
-- =============================================================================
create schema if not exists extensions;
create extension if not exists pgcrypto   with schema extensions;  -- hash de PINs (bcrypt)
create extension if not exists btree_gist with schema extensions;  -- EXCLUDE (sala =, horario &&)

-- pg_net permite mandar avisos HTTP (Telegram / Webhook) desde la base de datos.
-- Es opcional: si no está disponible, la app funciona igual sin avisos externos.
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net no disponible (%). Los avisos a Telegram/Webhook quedarán desactivados.', sqlerrm;
end
$$;


-- =============================================================================
-- 2. Esquema privado (NO expuesto por la API): secretos, PINs y dispositivos
-- =============================================================================
create schema if not exists private;
revoke all on schema private from public;
do $$
begin
  execute 'revoke all on schema private from anon, authenticated';
exception when undefined_object then null;
end
$$;


-- =============================================================================
-- 3. Tablas públicas (lectura solo para dispositivos de la casa)
-- =============================================================================
create table if not exists public.household (
  id          smallint primary key default 1 check (id = 1),
  name        text not null default 'Mi casa' check (char_length(btrim(name)) between 1 and 40),
  timezone    text not null default 'America/Mexico_City',
  updated_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 30),
  emoji       text not null default '🙂' check (char_length(emoji) between 1 and 16),
  color       text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  role        text not null default 'member' check (role in ('admin', 'member')),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  description text check (description is null or char_length(description) <= 120),
  icon        text not null default 'sofa' check (icon ~ '^[a-z0-9-]{1,30}$'),
  color       text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.reservations (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms (id),
  profile_id    uuid not null references public.profiles (id),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  purpose       text check (purpose is null or char_length(purpose) <= 80),
  guests        text check (guests is null or char_length(guests) <= 80),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references public.profiles (id),
  constraint reservations_time_order   check (ends_at > starts_at),
  constraint reservations_max_duration check (ends_at - starts_at <= interval '24 hours'),
  -- 🔒 Conflict resolution a prueba de carreras: dos reservas activas de la
  -- misma sala nunca pueden encimarse. '[)' = el fin es exclusivo, así que
  -- 6pm–8pm y 8pm–10pm sí pueden convivir.
  constraint reservations_no_overlap exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (cancelled_at is null)
);
create index if not exists reservations_starts_at_idx on public.reservations (starts_at);
create index if not exists reservations_ends_at_idx   on public.reservations (ends_at);
create index if not exists reservations_profile_idx   on public.reservations (profile_id, starts_at);

create table if not exists public.activity (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  kind            text not null check (kind in (
                    'reservation.created', 'reservation.updated', 'reservation.cancelled',
                    'reservation.released', 'room.created', 'room.updated')),
  actor_id        uuid references public.profiles (id),
  reservation_id  uuid references public.reservations (id) on delete set null,
  room_id         uuid references public.rooms (id) on delete set null,
  data            jsonb not null default '{}'::jsonb
);
create index if not exists activity_created_at_idx on public.activity (created_at desc);


-- =============================================================================
-- 4. Tablas privadas
-- =============================================================================
create table if not exists private.secrets (
  id                  smallint primary key default 1 check (id = 1),
  family_code_hash    text not null,
  notify_enabled      boolean not null default false,
  telegram_bot_token  text,
  telegram_chat_id    text,
  webhook_url         text
);

create table if not exists private.pins (
  profile_id       uuid primary key references public.profiles (id) on delete cascade,
  pin_hash         text not null,
  must_change      boolean not null default true,
  failed_attempts  integer not null default 0,
  locked_until     timestamptz
);

-- Un "dispositivo" = una sesión anónima de Supabase Auth que ya dio el código
-- de la casa. profile_id es el perfil que tiene abierto en este momento.
create table if not exists private.devices (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  profile_id    uuid references public.profiles (id) on delete set null,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table if not exists private.join_attempts (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  success     boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists join_attempts_created_at_idx on private.join_attempts (created_at);


-- =============================================================================
-- 5. Funciones auxiliares
-- =============================================================================

-- ¿Quién soy? (perfil activo en este dispositivo). Se usa en RLS y en RPCs.
create or replace function public.current_profile_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select d.profile_id
  from private.devices d
  join public.profiles p on p.id = d.profile_id and p.active
  where d.user_id = auth.uid()
$$;

create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.devices d where d.user_id = auth.uid())
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from private.devices d
    join public.profiles p on p.id = d.profile_id
    where d.user_id = auth.uid() and p.active and p.role = 'admin'
  )
$$;

-- Lanza un error legible para la familia. "hint" lleva un código para la app.
create or replace function private.fail(p_message text, p_code text, p_detail jsonb default null)
returns void
language plpgsql set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_message,
    hint    = p_code,
    detail  = coalesce(p_detail::text, '');
end
$$;

create or replace function private.require_profile()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile uuid := public.current_profile_id();
begin
  if v_profile is null then
    perform private.fail('Primero elige tu perfil en este dispositivo.', 'no_profile');
  end if;
  return v_profile;
end
$$;

create or replace function private.require_admin()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_profile uuid := private.require_profile();
begin
  if not public.is_admin() then
    perform private.fail('Solo Papá o Mamá (admins) pueden hacer esto.', 'forbidden');
  end if;
  return v_profile;
end
$$;

create or replace function private.clean_text(p_text text, p_max integer)
returns text
language sql immutable set search_path = ''
as $$
  select nullif(left(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')), p_max), '')
$$;

create or replace function private.house_tz()
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select h.timezone from public.household h where h.id = 1), 'America/Mexico_City')
$$;

-- "8pm", "8:30pm", "12am"
create or replace function private.fmt_time(p_ts timestamptz, p_tz text)
returns text
language sql stable set search_path = ''
as $$
  select ltrim(to_char(p_ts at time zone p_tz, 'HH12'), '0')
      || case when extract(minute from p_ts at time zone p_tz) <> 0
              then to_char(p_ts at time zone p_tz, ':MI') else '' end
      || case when extract(hour from p_ts at time zone p_tz) < 12 then 'am' else 'pm' end
$$;

-- "de 8pm a 10pm" o "todo el día" (12am a 12am del día siguiente)
create or replace function private.fmt_span(p_start timestamptz, p_end timestamptz, p_tz text)
returns text
language sql stable set search_path = ''
as $$
  select case
    when (p_start at time zone p_tz)::time = time '00:00'
     and (p_end at time zone p_tz) = (p_start at time zone p_tz) + interval '1 day'
    then 'todo el día'
    else 'de ' || private.fmt_time(p_start, p_tz) || ' a ' || private.fmt_time(p_end, p_tz)
  end
$$;

-- "hoy", "mañana", "este sábado", "el sábado 21 de noviembre"
create or replace function private.fmt_day(p_ts timestamptz, p_tz text)
returns text
language plpgsql stable set search_path = ''
as $$
declare
  d      date := (p_ts at time zone p_tz)::date;
  today  date := (now() at time zone p_tz)::date;
  dias   text[] := array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  meses  text[] := array['enero','febrero','marzo','abril','mayo','junio','julio',
                         'agosto','septiembre','octubre','noviembre','diciembre'];
  dia    text := dias[extract(dow from d)::int + 1];
begin
  if d = today then return 'hoy';
  elsif d = today + 1 then return 'mañana';
  elsif d = today - 1 then return 'ayer';
  elsif d > today and d <= today + 6 then return 'este ' || dia;
  end if;
  return 'el ' || dia || ' ' || extract(day from d)::int || ' de ' || meses[extract(month from d)::int]
      || case when extract(year from d) <> extract(year from today) then ' de ' || extract(year from d)::int else '' end;
end
$$;

create or replace function private.has_pg_net()
returns boolean
language sql stable set search_path = ''
as $$
  select exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname = 'http_post'
  )
$$;

-- Texto de un evento de actividad (para Telegram / Webhook).
create or replace function private.activity_text(a public.activity, p_tz text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  d       jsonb := coalesce(a.data, '{}'::jsonb);
  v_owner uuid := nullif(d ->> 'owner_id', '')::uuid;
  actor   text := coalesce((select p.name from public.profiles p where p.id = a.actor_id), d ->> 'actor_name', 'Alguien');
  owner   text := coalesce((select p.name from public.profiles p where p.id = v_owner), d ->> 'owner_name', 'alguien');
  room    text := coalesce((select r.name from public.rooms r where r.id = a.room_id), d ->> 'room_name', 'una sala');
  s       timestamptz := nullif(d ->> 'starts_at', '')::timestamptz;
  e       timestamptz := nullif(d ->> 'ends_at', '')::timestamptz;
  own     boolean := a.actor_id is not distinct from v_owner;
  whn     text := '';
  extra   text := '';
begin
  if s is not null and e is not null then
    whn := private.fmt_day(s, p_tz) || ' ' || private.fmt_span(s, e, p_tz);
  end if;
  if coalesce(d ->> 'purpose', '') <> '' then extra := extra || ' · ' || (d ->> 'purpose'); end if;
  if coalesce(d ->> 'guests', '')  <> '' then extra := extra || ' · con ' || (d ->> 'guests'); end if;

  return case a.kind
    when 'reservation.created' then
      '✅ ' || actor || ' acaba de separar ' || room || ' para ' || whn || extra
    when 'reservation.updated' then
      '✏️ ' || actor || case when own then ' cambió su reserva: ' else ' cambió la reserva de ' || owner || ': ' end
            || room || ', ' || whn || extra
    when 'reservation.cancelled' then
      '❌ ' || actor || case when own then ' canceló su reserva de ' else ' canceló la reserva de ' || owner || ' en ' end
            || room || ' (' || whn || ')'
    when 'reservation.released' then
      '🔓 ' || actor || ' liberó ' || room || '. ¡Ya está disponible!'
    when 'room.created' then
      '🏠 ' || actor || ' agregó la sala ' || room
    when 'room.updated' then
      '🏠 ' || actor || ' actualizó la sala ' || coalesce(d ->> 'old_name', room)
            || case when (d ->> 'old_name') is distinct from (d ->> 'room_name')
                    then ' (ahora "' || (d ->> 'room_name') || '")' else '' end
    when 'test' then
      '🔔 ¡Listo! Los avisos de Salas de la Casa llegarán a este chat.'
    else '🔔 ' || actor || ': ' || a.kind
  end;
end
$$;

-- Envía el aviso (Telegram y/o Webhook). Nunca rompe una reserva si falla.
create or replace function private.notify(a public.activity)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  s      private.secrets;
  v_text text;
  v_sent boolean := false;
begin
  select * into s from private.secrets where id = 1;
  if not found or not s.notify_enabled or not private.has_pg_net() then
    return false;
  end if;

  v_text := private.activity_text(a, private.house_tz());

  if s.telegram_bot_token is not null and s.telegram_chat_id is not null then
    execute 'select net.http_post(url := $1, body := $2)'
      using 'https://api.telegram.org/bot' || s.telegram_bot_token || '/sendMessage',
            jsonb_build_object('chat_id', s.telegram_chat_id, 'text', v_text,
                               'disable_web_page_preview', true);
    v_sent := true;
  end if;

  if s.webhook_url is not null then
    -- "text" sirve para Slack / Google Chat, "content" para Discord, y
    -- "event"/"data" para n8n, Make, Zapier, CallMeBot, etc.
    execute 'select net.http_post(url := $1, body := $2)'
      using s.webhook_url,
            jsonb_build_object('text', v_text, 'content', v_text, 'event', a.kind,
                               'data', a.data, 'created_at', a.created_at);
    v_sent := true;
  end if;

  return v_sent;
exception when others then
  raise warning 'No se pudo enviar el aviso: %', sqlerrm;
  return false;
end
$$;

create or replace function private.add_activity(
  p_kind text, p_reservation_id uuid, p_room_id uuid, p_data jsonb
) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_row   public.activity;
begin
  insert into public.activity (kind, actor_id, reservation_id, room_id, data)
  values (p_kind, v_actor, p_reservation_id, p_room_id,
          p_data || jsonb_build_object('actor_name', (select p.name from public.profiles p where p.id = v_actor)))
  returning * into v_row;
  perform private.notify(v_row);
end
$$;

-- Foto de la reserva para el feed (los nombres quedan aunque luego cambien).
create or replace function private.reservation_snapshot(r public.reservations)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'owner_id',   r.profile_id,
    'owner_name', (select p.name from public.profiles p where p.id = r.profile_id),
    'room_name',  (select x.name from public.rooms x where x.id = r.room_id),
    'starts_at',  r.starts_at,
    'ends_at',    r.ends_at,
    'purpose',    r.purpose,
    'guests',     r.guests
  )
$$;

create or replace function private.raise_conflict(
  p_room_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude uuid
) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  c    record;
  v_tz text := private.house_tz();
begin
  select r.id, r.starts_at, r.ends_at, r.purpose, r.profile_id, p.name as owner_name, x.name as room_name
    into c
  from public.reservations r
  join public.profiles p on p.id = r.profile_id
  join public.rooms x on x.id = r.room_id
  where r.room_id = p_room_id
    and r.cancelled_at is null
    and (p_exclude is null or r.id <> p_exclude)
    and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  order by r.starts_at
  limit 1;

  if found then
    perform private.fail(
      c.room_name || ' ya está ocupada por ' || c.owner_name || ' ' || private.fmt_day(c.starts_at, v_tz)
        || ' ' || private.fmt_span(c.starts_at, c.ends_at, v_tz) || '.',
      'room_conflict',
      jsonb_build_object('reservation_id', c.id, 'profile_id', c.profile_id, 'owner_name', c.owner_name,
                         'starts_at', c.starts_at, 'ends_at', c.ends_at, 'purpose', c.purpose));
  end if;
  -- Si llegamos aquí por una carrera que ya se resolvió, igual avisamos.
  perform private.fail('Alguien acaba de reservar ese horario. Intenta de nuevo.', 'room_conflict');
end
$$;

create or replace function private.validate_reservation(
  p_room_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude uuid
) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_room_id is null or p_starts_at is null or p_ends_at is null then
    perform private.fail('Faltan datos: sala, inicio y fin.', 'invalid_input');
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.active) then
    perform private.fail('Esa sala no existe o está desactivada.', 'room_inactive');
  end if;
  if p_ends_at <= p_starts_at then
    perform private.fail('La hora de fin debe ser después de la de inicio.', 'invalid_range');
  end if;
  if p_ends_at - p_starts_at < interval '15 minutes' then
    perform private.fail('La reserva debe durar al menos 15 minutos.', 'invalid_range');
  end if;
  if p_ends_at - p_starts_at > interval '24 hours' then
    perform private.fail('Una reserva puede durar máximo 24 horas.', 'invalid_range');
  end if;
  if p_ends_at <= now() then
    perform private.fail('Ese horario ya pasó.', 'in_past');
  end if;
  if p_starts_at > now() + interval '365 days' then
    perform private.fail('Solo puedes reservar con hasta un año de anticipación.', 'too_far');
  end if;
  if exists (
    select 1 from public.reservations r
    where r.room_id = p_room_id
      and r.cancelled_at is null
      and (p_exclude is null or r.id <> p_exclude)
      and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    perform private.raise_conflict(p_room_id, p_starts_at, p_ends_at, p_exclude);
  end if;
end
$$;

create or replace function private.require_owner_or_admin(r public.reservations)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if r.profile_id is distinct from public.current_profile_id() and not public.is_admin() then
    perform private.fail(
      'Solo ' || coalesce((select p.name from public.profiles p where p.id = r.profile_id), 'quien la creó')
        || ' o un admin pueden modificar esta reserva.',
      'forbidden');
  end if;
end
$$;


-- =============================================================================
-- 6. RPC — Sesión: código de la casa, perfiles y PIN
-- =============================================================================
create or replace function public.get_session()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  update private.devices set last_seen_at = now() where user_id = v_uid;

  select jsonb_build_object(
           'is_member', d.user_id is not null,
           'profile', case when p.id is null then null else jsonb_build_object(
             'id', p.id, 'name', p.name, 'emoji', p.emoji, 'color', p.color, 'role', p.role) end,
           'must_change_pin', coalesce(pin.must_change, false))
    into v_res
  from (select 1) x
  left join private.devices d on d.user_id = v_uid
  left join public.profiles p on p.id = d.profile_id and p.active
  left join private.pins pin on pin.profile_id = p.id;

  return v_res;
end
$$;

-- Devuelve {ok:true} o {ok:false, error:'invalid_code'|'rate_limited'|'no_session'}.
-- (No lanza error a propósito: así el intento fallido sí queda registrado.)
create or replace function public.join_household(p_code text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_hash text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_session');
  end if;
  if exists (select 1 from private.devices where user_id = v_uid) then
    return jsonb_build_object('ok', true);
  end if;

  delete from private.join_attempts where created_at < now() - interval '1 day';

  if (select count(*) from private.join_attempts
       where not success and created_at > now() - interval '10 minutes') >= 20
     or (select count(*) from private.join_attempts
       where not success and user_id = v_uid and created_at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select family_code_hash into v_hash from private.secrets where id = 1;
  if v_hash is null or extensions.crypt(lower(btrim(coalesce(p_code, ''))), v_hash) <> v_hash then
    insert into private.join_attempts (user_id, success) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  insert into private.join_attempts (user_id, success) values (v_uid, true);
  insert into private.devices (user_id) values (v_uid) on conflict (user_id) do nothing;
  return jsonb_build_object('ok', true);
end
$$;

-- Devuelve {ok:true, session} o {ok:false, error:'invalid_pin', remaining} /
-- {ok:false, error:'locked', retry_at} / {ok:false, error:'not_member'|'profile_inactive'}.
create or replace function public.sign_in(p_profile_id uuid, p_pin text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  c_max_attempts constant integer  := 5;
  c_lock         constant interval := interval '5 minutes';
  v_uid uuid := auth.uid();
  v_pin private.pins;
begin
  if not public.is_member() then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and active) then
    return jsonb_build_object('ok', false, 'error', 'profile_inactive');
  end if;

  select * into v_pin from private.pins where profile_id = p_profile_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'profile_inactive');
  end if;

  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'retry_at', v_pin.locked_until);
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$'
     or extensions.crypt(p_pin, v_pin.pin_hash) <> v_pin.pin_hash then
    if v_pin.failed_attempts + 1 >= c_max_attempts then
      update private.pins set failed_attempts = 0, locked_until = now() + c_lock
       where profile_id = p_profile_id;
      return jsonb_build_object('ok', false, 'error', 'locked', 'retry_at', now() + c_lock);
    end if;
    update private.pins set failed_attempts = failed_attempts + 1, locked_until = null
     where profile_id = p_profile_id;
    return jsonb_build_object('ok', false, 'error', 'invalid_pin',
                              'remaining', c_max_attempts - v_pin.failed_attempts - 1);
  end if;

  update private.pins set failed_attempts = 0, locked_until = null where profile_id = p_profile_id;
  update private.devices set profile_id = p_profile_id, last_seen_at = now() where user_id = v_uid;
  return jsonb_build_object('ok', true, 'session', public.get_session());
end
$$;

create or replace function public.sign_out()
returns void
language sql volatile security definer set search_path = ''
as $$
  update private.devices set profile_id = null where user_id = auth.uid();
$$;

create or replace function public.leave_household()
returns void
language sql volatile security definer set search_path = ''
as $$
  delete from private.devices where user_id = auth.uid();
$$;

create or replace function public.change_pin(p_current text, p_new text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_profile uuid := private.require_profile();
  v_hash    text;
begin
  if p_new is null or p_new !~ '^[0-9]{4}$' then
    perform private.fail('El PIN nuevo debe tener exactamente 4 números.', 'invalid_pin_format');
  end if;
  select pin_hash into v_hash from private.pins where profile_id = v_profile;
  if v_hash is null or p_current is null
     or extensions.crypt(p_current, v_hash) is distinct from v_hash then
    perform private.fail('Tu PIN actual no es correcto.', 'invalid_pin');
  end if;
  if p_new = p_current then
    perform private.fail('El PIN nuevo debe ser diferente al actual.', 'invalid_pin_format');
  end if;
  update private.pins
     set pin_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 8)),
         must_change = false, failed_attempts = 0, locked_until = null
   where profile_id = v_profile;
end
$$;


-- =============================================================================
-- 7. RPC — Reservas
-- =============================================================================
create or replace function public.create_reservation(
  p_room_id   uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_purpose   text default null,
  p_guests    text default null
) returns public.reservations
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_profile uuid := private.require_profile();
  v_start   timestamptz := date_trunc('minute', p_starts_at);
  v_end     timestamptz := date_trunc('minute', p_ends_at);
  v_row     public.reservations;
begin
  perform private.validate_reservation(p_room_id, v_start, v_end, null);
  begin
    insert into public.reservations (room_id, profile_id, starts_at, ends_at, purpose, guests)
    values (p_room_id, v_profile, v_start, v_end,
            private.clean_text(p_purpose, 80), private.clean_text(p_guests, 80))
    returning * into v_row;
  exception when exclusion_violation then
    perform private.raise_conflict(p_room_id, v_start, v_end, null);
  end;
  perform private.add_activity('reservation.created', v_row.id, v_row.room_id,
                               private.reservation_snapshot(v_row));
  return v_row;
end
$$;

create or replace function public.update_reservation(
  p_id        uuid,
  p_room_id   uuid,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_purpose   text default null,
  p_guests    text default null
) returns public.reservations
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_old   public.reservations;
  v_row   public.reservations;
  v_start timestamptz := date_trunc('minute', p_starts_at);
  v_end   timestamptz := date_trunc('minute', p_ends_at);
begin
  perform private.require_profile();
  select * into v_old from public.reservations where id = p_id for update;
  if not found then
    perform private.fail('Esa reserva ya no existe.', 'not_found');
  end if;
  perform private.require_owner_or_admin(v_old);
  if v_old.cancelled_at is not null then
    perform private.fail('Esa reserva ya fue cancelada.', 'already_cancelled');
  end if;
  if v_old.ends_at <= now() then
    perform private.fail('Esa reserva ya terminó; ya no se puede editar.', 'in_past');
  end if;

  perform private.validate_reservation(p_room_id, v_start, v_end, p_id);
  begin
    update public.reservations
       set room_id = p_room_id, starts_at = v_start, ends_at = v_end,
           purpose = private.clean_text(p_purpose, 80), guests = private.clean_text(p_guests, 80),
           updated_at = now()
     where id = p_id
    returning * into v_row;
  exception when exclusion_violation then
    perform private.raise_conflict(p_room_id, v_start, v_end, p_id);
  end;

  perform private.add_activity('reservation.updated', v_row.id, v_row.room_id,
    private.reservation_snapshot(v_row) || jsonb_build_object('previous', jsonb_build_object(
      'room_id',   v_old.room_id,
      'room_name', (select x.name from public.rooms x where x.id = v_old.room_id),
      'starts_at', v_old.starts_at,
      'ends_at',   v_old.ends_at)));
  return v_row;
end
$$;

create or replace function public.cancel_reservation(p_id uuid)
returns public.reservations
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_profile uuid := private.require_profile();
  v_old     public.reservations;
  v_row     public.reservations;
begin
  select * into v_old from public.reservations where id = p_id for update;
  if not found then
    perform private.fail('Esa reserva ya no existe.', 'not_found');
  end if;
  perform private.require_owner_or_admin(v_old);
  if v_old.cancelled_at is not null then
    perform private.fail('Esa reserva ya estaba cancelada.', 'already_cancelled');
  end if;
  if v_old.ends_at <= now() then
    perform private.fail('Esa reserva ya terminó.', 'in_past');
  end if;
  if v_old.starts_at <= now() then
    perform private.fail('Esta reserva ya empezó: usa "Liberar sala" para terminarla antes.', 'in_progress');
  end if;

  update public.reservations
     set cancelled_at = now(), cancelled_by = v_profile, updated_at = now()
   where id = p_id
  returning * into v_row;
  perform private.add_activity('reservation.cancelled', v_row.id, v_row.room_id,
                               private.reservation_snapshot(v_row));
  return v_row;
end
$$;

-- Terminar antes una reserva que ya está en curso ("ya nos salimos").
create or replace function public.release_reservation(p_id uuid)
returns public.reservations
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_old public.reservations;
  v_row public.reservations;
begin
  perform private.require_profile();
  select * into v_old from public.reservations where id = p_id for update;
  if not found then
    perform private.fail('Esa reserva ya no existe.', 'not_found');
  end if;
  perform private.require_owner_or_admin(v_old);
  if v_old.cancelled_at is not null then
    perform private.fail('Esa reserva ya estaba cancelada.', 'already_cancelled');
  end if;
  if v_old.starts_at > now() then
    perform private.fail('Esta reserva aún no empieza: mejor cancélala.', 'not_started');
  end if;
  if v_old.ends_at <= now() then
    perform private.fail('Esa reserva ya terminó.', 'in_past');
  end if;

  update public.reservations
     set ends_at = greatest(now(), starts_at + interval '1 minute'), updated_at = now()
   where id = p_id
  returning * into v_row;
  perform private.add_activity('reservation.released', v_row.id, v_row.room_id,
                               private.reservation_snapshot(v_row));
  return v_row;
end
$$;


-- =============================================================================
-- 8. RPC — Ajustes (salas, perfiles, casa, avisos)
-- =============================================================================
create or replace function public.update_household(p_name text, p_timezone text)
returns public.household
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_row public.household;
begin
  perform private.require_admin();
  if private.clean_text(p_name, 40) is null then
    perform private.fail('Escribe un nombre para la casa.', 'invalid_input');
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    perform private.fail('Zona horaria no válida.', 'invalid_input');
  end if;
  update public.household
     set name = private.clean_text(p_name, 40), timezone = p_timezone, updated_at = now()
   where id = 1
  returning * into v_row;
  return v_row;
end
$$;

create or replace function public.upsert_room(
  p_id          uuid,
  p_name        text,
  p_description text default null,
  p_icon        text default 'sofa',
  p_color       text default '#4f46e5',
  p_active      boolean default true
) returns public.rooms
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_old public.rooms;
  v_row public.rooms;
  v_upcoming integer;
begin
  perform private.require_admin();
  if private.clean_text(p_name, 40) is null then
    perform private.fail('Escribe un nombre para la sala.', 'invalid_input');
  end if;

  if p_id is null then
    insert into public.rooms (name, description, icon, color, sort_order)
    values (private.clean_text(p_name, 40), private.clean_text(p_description, 120),
            coalesce(p_icon, 'sofa'), coalesce(p_color, '#4f46e5'),
            coalesce((select max(sort_order) from public.rooms), 0) + 1)
    returning * into v_row;
    perform private.add_activity('room.created', null, v_row.id, jsonb_build_object('room_name', v_row.name));
    return v_row;
  end if;

  select * into v_old from public.rooms where id = p_id for update;
  if not found then
    perform private.fail('Esa sala no existe.', 'not_found');
  end if;

  if v_old.active and not coalesce(p_active, true) then
    if (select count(*) from public.rooms where active and id <> p_id) = 0 then
      perform private.fail('Debe quedar al menos una sala activa.', 'invalid_input');
    end if;
    select count(*) into v_upcoming from public.reservations
     where room_id = p_id and cancelled_at is null and ends_at > now();
    if v_upcoming > 0 then
      perform private.fail('Esta sala tiene ' || v_upcoming || ' reserva(s) próximas. Cancélalas antes de desactivarla.', 'has_reservations');
    end if;
  end if;

  update public.rooms
     set name = private.clean_text(p_name, 40),
         description = private.clean_text(p_description, 120),
         icon = coalesce(p_icon, icon),
         color = coalesce(p_color, color),
         active = coalesce(p_active, active)
   where id = p_id
  returning * into v_row;

  if v_old.name is distinct from v_row.name or v_old.active is distinct from v_row.active then
    perform private.add_activity('room.updated', null, v_row.id,
      jsonb_build_object('room_name', v_row.name, 'old_name', v_old.name, 'active', v_row.active));
  end if;
  return v_row;
end
$$;

-- Admin: crea/edita a cualquiera. Cada quien: puede editar su nombre, emoji y color.
create or replace function public.upsert_profile(
  p_id     uuid,
  p_name   text,
  p_emoji  text,
  p_color  text,
  p_role   text default null,
  p_active boolean default null,
  p_pin    text default null
) returns public.profiles
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me       uuid := private.require_profile();
  v_admin    boolean := public.is_admin();
  v_old      public.profiles;
  v_row      public.profiles;
  v_upcoming integer;
begin
  if private.clean_text(p_name, 30) is null then
    perform private.fail('Escribe un nombre.', 'invalid_input');
  end if;
  if p_role is not null and p_role not in ('admin', 'member') then
    perform private.fail('Rol no válido.', 'invalid_input');
  end if;

  if p_id is null then
    if not v_admin then
      perform private.fail('Solo Papá o Mamá (admins) pueden agregar personas.', 'forbidden');
    end if;
    if p_pin is null or p_pin !~ '^[0-9]{4}$' then
      perform private.fail('El PIN inicial debe tener 4 números.', 'invalid_pin_format');
    end if;
    insert into public.profiles (name, emoji, color, role, sort_order)
    values (private.clean_text(p_name, 30), coalesce(nullif(btrim(p_emoji), ''), '🙂'),
            coalesce(p_color, '#2563eb'), coalesce(p_role, 'member'),
            coalesce((select max(sort_order) from public.profiles), 0) + 1)
    returning * into v_row;
    insert into private.pins (profile_id, pin_hash, must_change)
    values (v_row.id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), true);
    return v_row;
  end if;

  select * into v_old from public.profiles where id = p_id for update;
  if not found then
    perform private.fail('Ese perfil no existe.', 'not_found');
  end if;
  if not v_admin then
    if p_id <> v_me then
      perform private.fail('Solo puedes editar tu propio perfil.', 'forbidden');
    end if;
    if (p_role is not null and p_role <> v_old.role) or (p_active is not null and p_active <> v_old.active) then
      perform private.fail('Solo Papá o Mamá (admins) pueden cambiar roles o desactivar perfiles.', 'forbidden');
    end if;
  end if;

  -- Debe quedar al menos un admin activo.
  if v_old.role = 'admin' and v_old.active
     and (coalesce(p_role, v_old.role) <> 'admin' or not coalesce(p_active, v_old.active))
     and (select count(*) from public.profiles where role = 'admin' and active and id <> p_id) = 0 then
    perform private.fail('Debe quedar al menos un admin activo.', 'last_admin');
  end if;

  if v_old.active and not coalesce(p_active, true) then
    select count(*) into v_upcoming from public.reservations
     where profile_id = p_id and cancelled_at is null and ends_at > now();
    if v_upcoming > 0 then
      perform private.fail(v_old.name || ' tiene ' || v_upcoming || ' reserva(s) próximas. Cancélalas antes de desactivar el perfil.', 'has_reservations');
    end if;
    update private.devices set profile_id = null where profile_id = p_id;
  end if;

  update public.profiles
     set name   = private.clean_text(p_name, 30),
         emoji  = coalesce(nullif(btrim(p_emoji), ''), emoji),
         color  = coalesce(p_color, color),
         role   = coalesce(p_role, role),
         active = coalesce(p_active, active)
   where id = p_id
  returning * into v_row;
  return v_row;
end
$$;

create or replace function public.reset_pin(p_profile_id uuid, p_new_pin text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    perform private.fail('El PIN debe tener 4 números.', 'invalid_pin_format');
  end if;
  insert into private.pins (profile_id, pin_hash, must_change)
  values (p_profile_id, extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)), true)
  on conflict (profile_id) do update
    set pin_hash = excluded.pin_hash, must_change = true, failed_attempts = 0, locked_until = null;
end
$$;

create or replace function public.set_family_code(p_code text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_code is null or char_length(btrim(p_code)) < 6 then
    perform private.fail('El código de la casa debe tener al menos 6 caracteres.', 'invalid_input');
  end if;
  update private.secrets
     set family_code_hash = extensions.crypt(lower(btrim(p_code)), extensions.gen_salt('bf', 8))
   where id = 1;
end
$$;

create or replace function public.sign_out_other_devices()
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_admin();
  delete from private.devices where user_id <> auth.uid();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create or replace function public.get_notification_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s private.secrets;
begin
  perform private.require_admin();
  select * into s from private.secrets where id = 1;
  return jsonb_build_object(
    'enabled',            coalesce(s.notify_enabled, false),
    'has_telegram_token', s.telegram_bot_token is not null,
    'telegram_chat_id',   s.telegram_chat_id,
    'webhook_url',        s.webhook_url,
    'pg_net_available',   private.has_pg_net());
end
$$;

-- p_telegram_bot_token: null = no cambiar, '' = borrar.
create or replace function public.set_notification_settings(
  p_enabled            boolean,
  p_telegram_bot_token text default null,
  p_telegram_chat_id   text default null,
  p_webhook_url        text default null
) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_token text := btrim(p_telegram_bot_token);
  v_chat  text := nullif(btrim(coalesce(p_telegram_chat_id, '')), '');
  v_url   text := nullif(btrim(coalesce(p_webhook_url, '')), '');
begin
  perform private.require_admin();
  if v_token is not null and v_token <> '' and v_token !~ '^[0-9]{5,}:[A-Za-z0-9_-]{20,}$' then
    perform private.fail('El token del bot de Telegram no tiene el formato correcto (123456:ABC…).', 'invalid_input');
  end if;
  if v_chat is not null and v_chat !~ '^(-?[0-9]{3,}|@[A-Za-z0-9_]{4,})$' then
    perform private.fail('El chat ID de Telegram debe ser un número (p. ej. -1001234567890) o @canal.', 'invalid_input');
  end if;
  if v_url is not null and v_url !~ '^https://[^\s]+$' then
    perform private.fail('El webhook debe ser una URL https://', 'invalid_input');
  end if;

  update private.secrets
     set notify_enabled     = coalesce(p_enabled, false),
         telegram_bot_token = case when v_token is null then telegram_bot_token
                                   else nullif(v_token, '') end,
         telegram_chat_id   = v_chat,
         webhook_url        = v_url
   where id = 1;
  return public.get_notification_settings();
end
$$;

create or replace function public.test_notification()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_a public.activity;
  s   private.secrets;
begin
  perform private.require_admin();
  select * into s from private.secrets where id = 1;
  if not private.has_pg_net() then
    return jsonb_build_object('sent', false, 'reason', 'pg_net_missing');
  end if;
  if not coalesce(s.notify_enabled, false) then
    return jsonb_build_object('sent', false, 'reason', 'disabled');
  end if;
  if (s.telegram_bot_token is null or s.telegram_chat_id is null) and s.webhook_url is null then
    return jsonb_build_object('sent', false, 'reason', 'not_configured');
  end if;
  v_a.kind := 'test';
  v_a.created_at := now();
  v_a.actor_id := public.current_profile_id();
  v_a.data := '{}'::jsonb;
  return jsonb_build_object('sent', private.notify(v_a));
end
$$;


-- Mantener vivo el proyecto gratuito (Supabase pausa proyectos sin uso ~7 días).
-- La llama .github/workflows/keep-alive.yml. No expone ningún dato.
create or replace function public.ping()
returns text
language sql stable set search_path = ''
as $$
  select 'pong ' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
$$;


-- =============================================================================
-- 9. Datos iniciales (solo se insertan si las tablas están vacías)
-- =============================================================================
do $$
declare
  v_code text := (select family_code from _setup);
begin
  if char_length(btrim(v_code)) < 6 then
    raise exception 'El código de la casa (family_code) debe tener al menos 6 caracteres.';
  end if;
  if (select initial_pin from _setup) !~ '^[0-9]{4}$' then
    raise exception 'El PIN inicial (initial_pin) debe tener exactamente 4 números.';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = (select timezone from _setup)) then
    raise exception 'Zona horaria no válida: %', (select timezone from _setup);
  end if;
end
$$;

insert into public.household (id, name, timezone)
select 1, house_name, timezone from _setup
on conflict (id) do nothing;

insert into private.secrets (id, family_code_hash)
select 1, extensions.crypt(lower(btrim(family_code)), extensions.gen_salt('bf', 8)) from _setup
on conflict (id) do nothing;

-- ✏️ Perfiles iniciales: (nombre, emoji, color, rol, orden). Rol 'admin' = puede
-- editar/cancelar cualquier reserva y cambiar ajustes.
insert into public.profiles (name, emoji, color, role, sort_order)
select v.name, v.emoji, v.color, v.role, v.sort_order
from (values
  ('Papá',   '👨', '#2563eb', 'admin',  1),
  ('Mamá',   '👩', '#db2777', 'admin',  2),
  ('Cecy', '🧑', '#d97706', 'member', 3),
  ('Jorge', '👦', '#7c3aed', 'member', 4),
  ('Andy', '👧', '#0891b2', 'member', 5)
) as v (name, emoji, color, role, sort_order)
where not exists (select 1 from public.profiles);

insert into private.pins (profile_id, pin_hash, must_change)
select p.id, extensions.crypt((select initial_pin from _setup), extensions.gen_salt('bf', 8)), true
from public.profiles p
where not exists (select 1 from private.pins x where x.profile_id = p.id);

-- ✏️ Salas iniciales: (nombre, descripción, ícono, color, orden).
-- Íconos: tv, sofa, trees, gamepad, music, book, coffee, sun, popcorn, home.
insert into public.rooms (name, description, icon, color, sort_order)
select v.name, v.description, v.icon, v.color, v.sort_order
from (values
  ('Sala Arriba', 'Planta alta', 'tv',   '#4f46e5', 1),
  ('Sala Abajo',  'Planta baja', 'sofa', '#ea580c', 2)
) as v (name, description, icon, color, sort_order)
where not exists (select 1 from public.rooms);

drop table if exists pg_temp._setup;


-- =============================================================================
-- 10. Seguridad: RLS + permisos (defensa en profundidad)
-- =============================================================================
alter table public.household    enable row level security;
alter table public.profiles     enable row level security;
alter table public.rooms        enable row level security;
alter table public.reservations enable row level security;
alter table public.activity     enable row level security;

drop policy if exists "Casa: leer"          on public.household;
drop policy if exists "Perfiles: leer"      on public.profiles;
drop policy if exists "Salas: leer"         on public.rooms;
drop policy if exists "Reservas: leer"      on public.reservations;
drop policy if exists "Actividad: leer"     on public.activity;

create policy "Casa: leer"      on public.household    for select to authenticated using ((select public.is_member()));
create policy "Perfiles: leer"  on public.profiles     for select to authenticated using ((select public.is_member()));
create policy "Salas: leer"     on public.rooms        for select to authenticated using ((select public.is_member()));
create policy "Reservas: leer"  on public.reservations for select to authenticated using ((select public.is_member()));
create policy "Actividad: leer" on public.activity     for select to authenticated using ((select public.is_member()));
-- Sin políticas de INSERT/UPDATE/DELETE: toda escritura pasa por las RPC de arriba.

revoke all on public.household, public.profiles, public.rooms, public.reservations, public.activity
  from public, anon, authenticated;
grant select on public.household, public.profiles, public.rooms, public.reservations, public.activity
  to authenticated;

-- Funciones: nadie las ejecuta salvo lo que se concede explícitamente.
revoke execute on all functions in schema private from public;
do $$
begin
  execute 'revoke execute on all functions in schema private from anon, authenticated';
exception when undefined_object then null;
end
$$;

revoke execute on function
  public.current_profile_id(), public.is_member(), public.is_admin(),
  public.get_session(), public.join_household(text), public.sign_in(uuid, text),
  public.sign_out(), public.leave_household(), public.change_pin(text, text),
  public.create_reservation(uuid, timestamptz, timestamptz, text, text),
  public.update_reservation(uuid, uuid, timestamptz, timestamptz, text, text),
  public.cancel_reservation(uuid), public.release_reservation(uuid),
  public.update_household(text, text),
  public.upsert_room(uuid, text, text, text, text, boolean),
  public.upsert_profile(uuid, text, text, text, text, boolean, text),
  public.reset_pin(uuid, text), public.set_family_code(text), public.sign_out_other_devices(),
  public.get_notification_settings(), public.set_notification_settings(boolean, text, text, text),
  public.test_notification()
from public, anon;

grant execute on function
  public.current_profile_id(), public.is_member(), public.is_admin(),
  public.get_session(), public.join_household(text), public.sign_in(uuid, text),
  public.sign_out(), public.leave_household(), public.change_pin(text, text),
  public.create_reservation(uuid, timestamptz, timestamptz, text, text),
  public.update_reservation(uuid, uuid, timestamptz, timestamptz, text, text),
  public.cancel_reservation(uuid), public.release_reservation(uuid),
  public.update_household(text, text),
  public.upsert_room(uuid, text, text, text, text, boolean),
  public.upsert_profile(uuid, text, text, text, text, boolean, text),
  public.reset_pin(uuid, text), public.set_family_code(text), public.sign_out_other_devices(),
  public.get_notification_settings(), public.set_notification_settings(boolean, text, text, text),
  public.test_notification()
to authenticated;


-- =============================================================================
-- 11. Tiempo real (Supabase Realtime)
-- =============================================================================
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No existe la publicación supabase_realtime; se omite tiempo real.';
    return;
  end if;
  foreach t in array array['household', 'profiles', 'rooms', 'reservations', 'activity'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- ✅ Listo. Ahora activa "Allow anonymous sign-ins" en Authentication y
--    pega la URL + Publishable (anon) key en Vercel. Ver README.md.
