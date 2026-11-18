-- Actualización 18-nov-2026: keep-alive más fuerte.
-- Cada ping del workflow escribe un "latido" en la base de datos (actividad real)
-- para que Supabase no pause el proyecto gratuito. Se puede correr varias veces.
create table if not exists private.heartbeat (
  id         smallint primary key default 1 check (id = 1),
  last_ping  timestamptz not null default now(),
  pings      bigint not null default 0
);

create or replace function public.ping()
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pings bigint;
  v_dummy bigint;
begin
  insert into private.heartbeat (id, last_ping, pings) values (1, now(), 1)
  on conflict (id) do update set last_ping = now(), pings = private.heartbeat.pings + 1
  returning pings into v_pings;
  select count(*) into v_dummy from public.rooms;
  select count(*) into v_dummy from public.reservations where ends_at > now();
  return 'pong ' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF') || ' · latido #' || v_pings;
end
$$;

revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
