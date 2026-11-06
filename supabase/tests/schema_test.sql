-- Pruebas de integración de supabase/schema.sql (RLS, RPC, traslapes, PINs).
-- Se corre con: npm run test:db
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Utilidades de prueba
-- ---------------------------------------------------------------------------
create schema tests;
create table tests.ids (name text primary key, id uuid not null);

create function tests.id(p_name text) returns uuid
language sql stable as $$ select id from tests.ids where name = p_name $$;

create function tests.act_as(p_name text) returns void
language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', tests.id(p_name), 'role', 'authenticated')::text, false)
$$;

create function tests.ok(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if not coalesce(p_cond, false) then
    raise exception 'FALLÓ: %', p_msg;
  end if;
  raise notice '✓ %', p_msg;
end $$;

create function tests.expect_hint(p_sql text, p_hint text, p_msg text) returns void
language plpgsql as $$
declare
  v_hint text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    if v_hint is distinct from p_hint then
      raise exception 'FALLÓ: % — esperaba hint "%", obtuve "%" (%)', p_msg, p_hint, v_hint, v_msg;
    end if;
    raise notice '✓ % → "%"', p_msg, v_msg;
    return;
  end;
  raise exception 'FALLÓ: % — esperaba error "%" pero no hubo error', p_msg, p_hint;
end $$;

create function tests.expect_state(p_sql text, p_state text, p_msg text) returns void
language plpgsql as $$
declare
  v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> p_state then
      raise exception 'FALLÓ: % — esperaba SQLSTATE %, obtuve % (%)', p_msg, p_state, v_state, sqlerrm;
    end if;
    raise notice '✓ % (SQLSTATE %)', p_msg, v_state;
    return;
  end;
  raise exception 'FALLÓ: % — esperaba SQLSTATE % pero no hubo error', p_msg, p_state;
end $$;

-- Hora local de la casa: mañana a las HH:MM
create function tests.tomorrow_at(p_hhmm text) returns timestamptz
language sql stable as $$
  select (((now() at time zone 'America/Mexico_City')::date + 1) + p_hhmm::time) at time zone 'America/Mexico_City'
$$;

grant usage on schema tests to anon, authenticated;
grant select, insert on tests.ids to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-00000000000d'),
  ('00000000-0000-0000-0000-00000000000e');
insert into tests.ids values
  ('dev_papa',  '00000000-0000-0000-0000-00000000000a'),
  ('dev_hijo1', '00000000-0000-0000-0000-00000000000b'),
  ('dev_hijo2', '00000000-0000-0000-0000-00000000000c'),
  ('intruso',   '00000000-0000-0000-0000-00000000000d'),
  ('dev_nuevo', '00000000-0000-0000-0000-00000000000e');
insert into tests.ids select 'papa',  id from public.profiles where name = 'Papá';
insert into tests.ids select 'mama',  id from public.profiles where name = 'Mamá';
insert into tests.ids select 'hijo1', id from public.profiles where name = 'Hijo 1';
insert into tests.ids select 'hijo2', id from public.profiles where name = 'Hijo 2';
insert into tests.ids select 'hijo3', id from public.profiles where name = 'Hijo 3';
insert into tests.ids select 'sala1', id from public.rooms where sort_order = 1;
insert into tests.ids select 'sala2', id from public.rooms where sort_order = 2;

select tests.ok((select count(*) from tests.ids) = 12, 'datos iniciales: 5 perfiles y 2 salas sembrados una sola vez');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime') = 5,
                'tablas publicadas en Supabase Realtime');

-- ---------------------------------------------------------------------------
\echo '— Seguridad: anon e intrusos'
-- ---------------------------------------------------------------------------
set role anon;
select tests.expect_state('select count(*) from public.reservations', '42501', 'anon no puede leer reservas');
select tests.expect_state($$select public.join_household('mi-casa-2026')$$, '42501', 'anon no puede ejecutar RPC');
select tests.ok(public.ping() like 'pong %', 'anon solo puede hacer ping (keep-alive)');
reset role;

set role authenticated;
select tests.act_as('intruso');
select tests.ok((select count(*) from public.profiles) = 0, 'sesión sin código de la casa no ve perfiles (RLS)');
select tests.ok((select count(*) from public.reservations) = 0, 'sesión sin código de la casa no ve reservas (RLS)');
select tests.expect_state('select * from private.pins', '42501', 'nadie puede leer la tabla de PINs');
select tests.expect_state('select * from private.secrets', '42501', 'nadie puede leer secretos');
select tests.expect_state(
  format($$insert into public.reservations (room_id, profile_id, starts_at, ends_at) values (%L, %L, now(), now() + interval '1 hour')$$,
         tests.id('sala1'), tests.id('papa')),
  '42501', 'no se puede insertar directo en reservations (solo vía RPC)');
select tests.expect_state(format($$update public.rooms set name = 'hack' where id = %L$$, tests.id('sala1')),
  '42501', 'no se puede actualizar directo una sala');
select tests.ok(public.join_household('incorrecto') ->> 'error' = 'invalid_code', 'código de la casa incorrecto');
select public.join_household('x1'), public.join_household('x2'), public.join_household('x3'), public.join_household('x4') \gset
select tests.ok(public.join_household('mi-casa-2026') ->> 'error' = 'rate_limited', 'tras 5 intentos fallidos se bloquea ese dispositivo');
select tests.ok(not public.is_member(), 'el intruso sigue fuera');
select tests.ok(public.sign_in(tests.id('papa'), '0000') ->> 'error' = 'not_member', 'sin código de la casa no se puede usar un PIN');

-- ---------------------------------------------------------------------------
\echo '— Código de la casa + PIN'
-- ---------------------------------------------------------------------------
select tests.act_as('dev_papa');
select tests.ok((public.join_household('  MI-CASA-2026 ') ->> 'ok')::boolean, 'código correcto (ignora mayúsculas y espacios)');
select tests.ok((public.get_session() ->> 'is_member')::boolean and public.get_session() -> 'profile' = 'null'::jsonb,
                'dispositivo dentro de la casa, sin perfil aún');
select tests.ok((select count(*) from public.profiles) = 5, 'miembro ve los 5 perfiles');
select tests.ok((select count(*) from public.rooms) = 2, 'miembro ve las 2 salas');
select tests.expect_hint(
  format($$select public.create_reservation(%L, now() + interval '1 hour', now() + interval '2 hours')$$, tests.id('sala1')),
  'no_profile', 'sin perfil no se puede reservar');
select tests.ok((public.sign_in(tests.id('papa'), '9999') ->> 'remaining')::int = 4, 'PIN incorrecto: quedan 4 intentos');
select tests.ok((public.sign_in(tests.id('papa'), '0000') -> 'session' ->> 'must_change_pin')::boolean,
                'PIN inicial correcto → se pide cambiarlo');
select tests.expect_hint($$select public.change_pin('1111', '4321')$$, 'invalid_pin', 'cambiar PIN exige el PIN actual');
select tests.expect_hint($$select public.change_pin('0000', '12a4')$$, 'invalid_pin_format', 'PIN nuevo debe ser de 4 números');
select public.change_pin('0000', '4321');
select tests.ok(not (public.get_session() ->> 'must_change_pin')::boolean, 'PIN cambiado');
select tests.ok(public.is_admin(), 'Papá es admin');

select tests.act_as('dev_hijo1');
select public.join_household('mi-casa-2026');
select tests.ok((public.sign_in(tests.id('hijo1'), '0000') ->> 'ok')::boolean, 'Hijo 1 entra con su PIN');
select tests.ok(not public.is_admin(), 'Hijo 1 no es admin');

select tests.act_as('dev_hijo2');
select public.join_household('mi-casa-2026');
select tests.ok((public.sign_in(tests.id('hijo2'), '0000') ->> 'ok')::boolean, 'Hijo 2 entra con su PIN');

-- Bloqueo por PIN (perfil Hijo 3, desde el celular de Hijo 2)
select public.sign_in(tests.id('hijo3'), '1111'), public.sign_in(tests.id('hijo3'), '1112'),
       public.sign_in(tests.id('hijo3'), '1113'), public.sign_in(tests.id('hijo3'), '1114') \gset
select tests.ok(public.sign_in(tests.id('hijo3'), '1115') ->> 'error' = 'locked', '5 PIN incorrectos → perfil bloqueado 5 min');
select tests.ok(public.sign_in(tests.id('hijo3'), '0000') ->> 'error' = 'locked', 'bloqueado aunque el PIN sea correcto');
select tests.ok(public.current_profile_id() = tests.id('hijo2'), 'el dispositivo sigue con su perfil anterior');

-- ---------------------------------------------------------------------------
\echo '— Reservas y conflictos'
-- ---------------------------------------------------------------------------
select tests.act_as('dev_hijo1');
select id as r_hijo1 from public.create_reservation(tests.id('sala1'), tests.tomorrow_at('20:00'), tests.tomorrow_at('23:00'),
                                                    '  Noche   de pelis ', 'Sofía') \gset
insert into tests.ids values ('r_hijo1', :'r_hijo1');
select tests.ok((select purpose from public.reservations where id = tests.id('r_hijo1')) = 'Noche de pelis',
                'Hijo 1 reserva Sala 1 mañana 8pm–11pm (texto normalizado)');

select tests.act_as('dev_hijo2');
select tests.expect_hint(
  format($$select public.create_reservation(%L, tests.tomorrow_at('22:00'), tests.tomorrow_at('23:59'))$$, tests.id('sala1')),
  'room_conflict', 'traslape en la misma sala se bloquea');
select tests.expect_hint(
  format($$select public.create_reservation(%L, tests.tomorrow_at('19:00'), tests.tomorrow_at('23:30'))$$, tests.id('sala1')),
  'room_conflict', 'reserva que envuelve a otra se bloquea');
select id as r_hijo2_s1 from public.create_reservation(tests.id('sala1'), tests.tomorrow_at('23:00'),
                                                       tests.tomorrow_at('23:00') + interval '2 hours') \gset
insert into tests.ids values ('r_hijo2_s1', :'r_hijo2_s1');
select tests.ok(true, 'reserva pegada (11pm–1am) sí se permite: el fin es exclusivo y cruza medianoche');
select id as r_hijo2_s2 from public.create_reservation(tests.id('sala2'), tests.tomorrow_at('20:00'), tests.tomorrow_at('23:00'),
                                                       'Videojuegos', null) \gset
insert into tests.ids values ('r_hijo2_s2', :'r_hijo2_s2');
select tests.ok(true, 'misma hora en la otra sala sí se permite');

select tests.expect_hint(format($$select public.cancel_reservation(%L)$$, tests.id('r_hijo1')),
  'forbidden', 'Hijo 2 no puede cancelar la reserva de Hijo 1');
select tests.expect_hint(
  format($$select public.update_reservation(%L, %L, tests.tomorrow_at('18:00'), tests.tomorrow_at('19:00'))$$,
         tests.id('r_hijo1'), tests.id('sala1')),
  'forbidden', 'Hijo 2 no puede editar la reserva de Hijo 1');

select tests.act_as('dev_hijo1');
select public.update_reservation(tests.id('r_hijo1'), tests.id('sala1'), tests.tomorrow_at('19:00'), tests.tomorrow_at('22:30'),
                                 'Noche de pelis', 'Sofía y Ana');
select tests.ok((select starts_at from public.reservations where id = tests.id('r_hijo1')) = tests.tomorrow_at('19:00'),
                'editar la propia reserva no choca consigo misma');
select tests.expect_hint(
  format($$select public.update_reservation(%L, %L, tests.tomorrow_at('19:00'), tests.tomorrow_at('23:30'))$$,
         tests.id('r_hijo1'), tests.id('sala1')),
  'room_conflict', 'editar hacia un horario ocupado se bloquea');
select tests.expect_hint(
  format($$select public.create_reservation(%L, now() - interval '3 hours', now() - interval '1 hour')$$, tests.id('sala2')),
  'in_past', 'no se puede reservar en el pasado');
select tests.expect_hint(
  format($$select public.create_reservation(%L, tests.tomorrow_at('10:00'), tests.tomorrow_at('09:00'))$$, tests.id('sala2')),
  'invalid_range', 'fin antes del inicio');
select tests.expect_hint(
  format($$select public.create_reservation(%L, tests.tomorrow_at('10:00'), tests.tomorrow_at('10:10'))$$, tests.id('sala2')),
  'invalid_range', 'mínimo 15 minutos');
select tests.expect_hint(
  format($$select public.create_reservation(%L, tests.tomorrow_at('10:00'), tests.tomorrow_at('10:00') + interval '25 hours')$$, tests.id('sala2')),
  'invalid_range', 'máximo 24 horas');

-- Admin
select tests.act_as('dev_papa');
select public.cancel_reservation(tests.id('r_hijo2_s2'));
select tests.ok((select cancelled_by from public.reservations where id = tests.id('r_hijo2_s2')) = tests.id('papa'),
                'Papá (admin) cancela la reserva de Hijo 2');
select tests.expect_hint(format($$select public.cancel_reservation(%L)$$, tests.id('r_hijo2_s2')),
  'already_cancelled', 'no se cancela dos veces');

select tests.act_as('dev_hijo1');
select public.create_reservation(tests.id('sala2'), tests.tomorrow_at('20:00'), tests.tomorrow_at('23:00'), null, null);
select tests.ok(true, 'el horario cancelado queda libre para otra persona');

-- En curso: liberar sala
select id as r_now from public.create_reservation(tests.id('sala2'), now() - interval '30 minutes', now() + interval '1 hour') \gset
insert into tests.ids values ('r_now', :'r_now');
select tests.expect_hint(format($$select public.cancel_reservation(%L)$$, tests.id('r_now')),
  'in_progress', 'una reserva en curso no se cancela, se libera');
select public.release_reservation(tests.id('r_now'));
select tests.ok((select ends_at <= now() from public.reservations where id = tests.id('r_now')), 'liberar sala termina la reserva ya');

-- La restricción EXCLUDE protege aunque alguien se salte las RPC (p. ej. carreras)
reset role;
select tests.expect_state(
  format($$insert into public.reservations (room_id, profile_id, starts_at, ends_at) values (%L, %L, tests.tomorrow_at('20:30'), tests.tomorrow_at('21:00'))$$,
         tests.id('sala1'), tests.id('papa')),
  '23P01', 'EXCLUDE de Postgres impide traslapes aun con escritura directa');

-- ---------------------------------------------------------------------------
\echo '— Feed de actividad'
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.act_as('dev_hijo2');
select tests.ok((select count(*) from public.activity) = 8, 'cada acción quedó en el feed (8 eventos)');
select tests.ok((select string_agg(kind, ',' order by id) from public.activity) =
  'reservation.created,reservation.created,reservation.created,reservation.updated,reservation.cancelled,reservation.created,reservation.created,reservation.released',
  'tipos de evento correctos')
  ;
reset role;
select tests.ok(
  private.activity_text(a, 'America/Mexico_City') = '✅ Hijo 1 acaba de separar Sala Principal / TV para mañana de 8pm a 11pm · Noche de pelis · con Sofía',
  'texto del aviso: ' || private.activity_text(a, 'America/Mexico_City'))
from public.activity a order by id limit 1;
select tests.ok(
  private.activity_text(a, 'America/Mexico_City') like '❌ Papá canceló la reserva de Hijo 2 en Sala Lounge / Terraza (mañana de 8pm a 11pm)',
  'texto de cancelación por admin: ' || private.activity_text(a, 'America/Mexico_City'))
from public.activity a where kind = 'reservation.cancelled';
select tests.ok(private.fmt_time('2026-11-07 06:00:00+00', 'America/Mexico_City') = '12am', 'medianoche = 12am');
select tests.ok(private.fmt_time('2026-11-07 02:30:00+00', 'America/Mexico_City') = '8:30pm', 'formato 8:30pm');

-- ---------------------------------------------------------------------------
\echo '— Ajustes y permisos de admin'
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.act_as('dev_hijo2');
select tests.expect_hint(format($$select public.upsert_room(%L, 'Mi cuarto')$$, tests.id('sala1')), 'forbidden', 'un hijo no puede renombrar salas');
select tests.expect_hint($$select public.set_family_code('nuevo-codigo')$$, 'forbidden', 'un hijo no puede cambiar el código');
select tests.expect_hint(format($$select public.reset_pin(%L, '1234')$$, tests.id('papa')), 'forbidden', 'un hijo no puede resetear PINs');
select tests.expect_hint($$select public.get_notification_settings()$$, 'forbidden', 'un hijo no ve la config de avisos');
select public.upsert_profile(tests.id('hijo2'), 'Diego', '🎮', '#7c3aed', null, null, null);
select tests.ok((select name from public.profiles where id = tests.id('hijo2')) = 'Diego', 'cada quien puede editar su nombre/emoji');
select tests.expect_hint(format($$select public.upsert_profile(%L, 'Diego', '🎮', '#7c3aed', 'admin', null, null)$$, tests.id('hijo2')),
  'forbidden', 'un hijo no puede hacerse admin');
select tests.expect_hint(format($$select public.upsert_profile(%L, 'Hackeado', '🎮', '#7c3aed', null, null, null)$$, tests.id('hijo1')),
  'forbidden', 'un hijo no puede editar a otro');

select tests.act_as('dev_papa');
select public.upsert_room(tests.id('sala1'), 'Sala TV', 'Con Netflix', 'tv', '#4f46e5', true);
select tests.ok((select kind from public.activity order by id desc limit 1) = 'room.updated', 'renombrar sala aparece en el feed');
select tests.expect_hint(format($$select public.upsert_room(%L, 'Sala TV', null, 'tv', '#4f46e5', false)$$, tests.id('sala1')),
  'has_reservations', 'no se desactiva una sala con reservas próximas');
select public.upsert_room(null, 'Cuarto de juegos', null, 'gamepad', '#16a34a', true);
select tests.ok((select count(*) from public.rooms where active) = 3, 'admin puede agregar una sala');
select public.upsert_profile(tests.id('mama'), 'Mamá', '👩', '#db2777', 'member', null, null);
select tests.expect_hint(format($$select public.upsert_profile(%L, 'Papá', '👨', '#2563eb', 'member', null, null)$$, tests.id('papa')),
  'last_admin', 'debe quedar al menos un admin');
select public.upsert_profile(tests.id('mama'), 'Mamá', '👩', '#db2777', 'admin', null, null);
select public.upsert_profile(null, 'Abuela', '👵', '#0d9488', 'member', true, '2468');
select tests.ok((select count(*) from public.profiles) = 6, 'admin puede agregar personas (Abuela)');
select public.reset_pin(tests.id('hijo3'), '7777');
select tests.expect_hint($$select public.set_family_code('corto')$$, 'invalid_input', 'código de la casa mínimo 6 caracteres');
select public.set_family_code('Tacos-Al-Pastor');
select tests.expect_hint($$select public.set_notification_settings(true, 'token-malo', null, null)$$, 'invalid_input', 'valida token de Telegram');
select tests.expect_hint($$select public.set_notification_settings(true, null, null, 'http://inseguro.com')$$, 'invalid_input', 'webhook debe ser https');
select tests.ok((public.set_notification_settings(true, '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', '-1001234567890', null)
                 ->> 'has_telegram_token')::boolean, 'guarda Telegram (el token nunca se devuelve)');
select tests.ok(public.get_notification_settings() ->> 'telegram_chat_id' = '-1001234567890', 'lee chat id');
select tests.ok(public.test_notification() ->> 'reason' = 'pg_net_missing', 'sin pg_net la prueba de aviso lo indica');

-- Nuevo dispositivo con el nuevo código; Hijo 3 con PIN reseteado
select tests.act_as('dev_nuevo');
select tests.ok(public.join_household('mi-casa-2026') ->> 'error' = 'invalid_code', 'el código viejo ya no sirve');
select tests.ok((public.join_household('tacos-al-pastor') ->> 'ok')::boolean, 'el código nuevo sí');
-- (el bloqueo de Hijo 3 se limpió con reset_pin)
select tests.ok((public.sign_in(tests.id('hijo3'), '7777') -> 'session' ->> 'must_change_pin')::boolean,
                'PIN reseteado por admin funciona y pide cambio');
select public.sign_out();
select tests.ok(public.current_profile_id() is null, 'cambiar de perfil cierra el perfil del dispositivo');

select tests.act_as('dev_papa');
select tests.ok(public.sign_out_other_devices() = 3, 'admin puede sacar a los demás dispositivos');
select tests.act_as('dev_hijo1');
select tests.ok(not public.is_member(), 'dispositivo expulsado ya no es miembro');
select tests.ok((select count(*) from public.reservations) = 0, 'y ya no puede leer reservas');
reset role;

-- ---------------------------------------------------------------------------
\echo '— Avisos (Telegram / Webhook) con un pg_net simulado'
-- ---------------------------------------------------------------------------
create schema net;
create table net.calls (id serial primary key, url text, body jsonb);
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                              headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql as $$ insert into net.calls (url, body) values (url, body) returning id::bigint $$;

set role authenticated;
select tests.act_as('dev_papa');
select tests.ok((public.test_notification() ->> 'sent')::boolean, 'mensaje de prueba enviado');
select public.set_notification_settings(true, null, '-1001234567890', 'https://hooks.example.com/salas');
select public.create_reservation(tests.id('sala2'), tests.tomorrow_at('15:00'), tests.tomorrow_at('17:00'), 'Junta', null);
reset role;
select tests.ok((select count(*) from net.calls) = 3, 'prueba + reserva → Telegram y Webhook');
select tests.ok((select url from net.calls order by id limit 1) like 'https://api.telegram.org/bot123456789:%/sendMessage',
                'URL de Telegram correcta');
select tests.ok((select body ->> 'text' from net.calls where url like 'https://api.telegram.org%' order by id desc limit 1)
                = '✅ Papá acaba de separar Sala Lounge / Terraza para mañana de 3pm a 5pm · Junta',
                'mensaje de Telegram: ' || (select body ->> 'text' from net.calls order by id desc limit 1));
select tests.ok((select body ->> 'event' from net.calls where url = 'https://hooks.example.com/salas') = 'reservation.created',
                'el webhook recibe el evento en JSON');
set role authenticated;
select tests.act_as('dev_papa');
select public.set_notification_settings(false, '', null, null);
reset role;
select tests.ok((select telegram_bot_token is null and not notify_enabled from private.secrets), 'avisos desactivados y token borrado');

\echo '✅ Todas las pruebas de base de datos pasaron'
