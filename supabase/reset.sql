-- 🧹 Dejar Salas de la Casa como nueva (después de probar)
-- Borra reservas y actividad de prueba, saca a TODOS los dispositivos
-- (incluido el tuyo) y regresa los PINs de todos a 0000.
-- No borra la estructura, las salas ni los perfiles.
delete from public.activity;
delete from public.reservations;
delete from private.devices;
delete from private.join_attempts;
update private.pins
   set pin_hash = extensions.crypt('0000', extensions.gen_salt('bf', 8)),
       must_change = true, failed_attempts = 0, locked_until = null;
