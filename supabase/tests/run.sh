#!/usr/bin/env bash
# Prueba supabase/schema.sql contra un Postgres local desechable.
# Requiere PostgreSQL 14+ con contrib (btree_gist, pgcrypto) instalado.
#   npm run test:db
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

PG_BIN="${PG_BIN:-}"
if [[ -z "$PG_BIN" ]]; then
  if command -v pg_ctl >/dev/null 2>&1; then
    PG_BIN="$(dirname "$(command -v pg_ctl)")"
  else
    PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  fi
fi
[[ -x "$PG_BIN/initdb" ]] || { echo "No encontré initdb de PostgreSQL (usa PG_BIN=/ruta/bin)"; exit 1; }

WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then
  # initdb no corre como root: usamos el usuario postgres.
  chown -R postgres "$WORK" 2>/dev/null || true
  RUN_AS=(runuser -u postgres --)
fi

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 --no-psqlrc)
"${PSQL[@]}" -d postgres -c "create database app" >/dev/null

echo "▶ Cargando stub de Supabase"
"${PSQL[@]}" -d app -f "$HERE/supabase_stub.sql" >/dev/null
echo "▶ Corriendo schema.sql (1ª vez)"
PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -d app -f "$ROOT/supabase/schema.sql" >/dev/null
echo "▶ Corriendo schema.sql (2ª vez, idempotencia)"
PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -d app -f "$ROOT/supabase/schema.sql" >/dev/null
echo "▶ Pruebas"
# Resultados a /dev/null; mostramos solo los avisos ✓ y los errores.
"${PSQL[@]}" -d app -f "$HERE/schema_test.sql" 2>&1 >/dev/null \
  | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR):  /\1: /; s/^NOTICE: /  /'
[[ "${PIPESTATUS[0]}" == "0" ]] || { echo "❌ Fallaron pruebas de base de datos"; exit 1; }
echo "▶ Corriendo schema.sql (3ª vez, con datos) y verificando que no se pierde nada"
PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -d app -f "$ROOT/supabase/schema.sql" >/dev/null
"${PSQL[@]}" -d app -At -c "select 'reservas: ' || count(*) from public.reservations" 
echo "✅ Base de datos OK"
