#!/bin/bash
set -euo pipefail

# Replica la BBDD de producción en tu PostgreSQL local.
#
#   Uso:  ./backend/scripts/sync_prod_db.sh [--yes]
#
# No contiene credenciales: las lee del .env del servidor (por SSH) y del
# .env local del backend. Postgres en producción sólo escucha en 127.0.0.1,
# por eso el volcado se genera en el servidor y se descarga con scp.
#
# ⚠️  BORRA el esquema public de tu BBDD local y lo sustituye por el de
#     producción. Pide confirmación salvo que pases --yes.

echo "=== Sincronizando BBDD de producción → local ==="

# --- Configuración (sobreescribible por entorno) ---------------------------
SSH_HOST="${SSH_HOST:-ubuntu@35.181.163.250}"
SSH_KEY="${SSH_KEY:-/c/Users/luise/Downloads/LightsailDefaultKey-eu-west-3 (5).pem}"
REMOTE_ENV="${REMOTE_ENV:-/var/www/lavanderia/backend/.env}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_ENV="${LOCAL_ENV:-$SCRIPT_DIR/../.env}"

ASSUME_YES=false
[ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ] && ASSUME_YES=true

# --- Localizar los binarios de PostgreSQL ----------------------------------
# En Git Bash (Windows) no suelen estar en el PATH; se busca la instalación
# más reciente bajo "Program Files". El cliente debe ser >= al servidor.
if command -v pg_restore >/dev/null 2>&1; then
  PG_BIN=""
else
  PG_BIN="$(ls -d "/c/Program Files/PostgreSQL"/*/bin 2>/dev/null | sort -V | tail -1 || true)/"
  if [ ! -x "${PG_BIN}pg_restore.exe" ]; then
    echo "❌ No encuentro pg_restore. Instala PostgreSQL o añádelo al PATH." >&2
    exit 1
  fi
  echo "--- Usando binarios de ${PG_BIN}"
fi
PSQL="${PG_BIN}psql"
PG_RESTORE="${PG_BIN}pg_restore"

# --- Leer DATABASE_URL local -----------------------------------------------
# head -1 replica el comportamiento de dotenv: si la clave está duplicada,
# gana la primera aparición y las siguientes se descartan.
if [ ! -f "$LOCAL_ENV" ]; then
  echo "❌ No existe $LOCAL_ENV" >&2
  exit 1
fi
LOCAL_URL="$(grep -m1 '^DATABASE_URL=' "$LOCAL_ENV" | cut -d= -f2- | tr -d '"'"'"'\r')"
if [ -z "$LOCAL_URL" ]; then
  echo "❌ No hay DATABASE_URL en $LOCAL_ENV" >&2
  exit 1
fi
LOCAL_DB="${LOCAL_URL##*/}"; LOCAL_DB="${LOCAL_DB%%\?*}"

if [ "$ASSUME_YES" != true ]; then
  echo ""
  echo "⚠️  Se va a BORRAR el esquema public de '$LOCAL_DB' y reemplazarlo"
  echo "    por una copia de producción."
  read -r -p "    ¿Continuar? [s/N] " respuesta
  case "$respuesta" in
    s|S|si|SI|Si) ;;
    *) echo "Cancelado."; exit 0 ;;
  esac
fi

DUMP="$(mktemp -t lavanderia_dump.XXXXXX)"
# El volcado lleva datos personales de clientes: se borra pase lo que pase,
# tanto en local como en el servidor.
trap 'rm -f "$DUMP"; ssh -i "$SSH_KEY" "$SSH_HOST" "rm -f /tmp/lavanderia_sync_*.pgc" 2>/dev/null || true' EXIT

# --- Volcado en el servidor -------------------------------------------------
echo "--- Generando volcado en el servidor ---"
REMOTE_DUMP="/tmp/lavanderia_sync_$$.pgc"
ssh -i "$SSH_KEY" "$SSH_HOST" "
  set -e
  URL=\$(grep -m1 '^DATABASE_URL=' '$REMOTE_ENV' | cut -d= -f2- | tr -d '\"' | tr -d '\r')
  [ -n \"\$URL\" ] || { echo 'No hay DATABASE_URL en $REMOTE_ENV' >&2; exit 1; }
  pg_dump -d \"\$URL\" -Fc -Z9 -f '$REMOTE_DUMP'
  ls -lh '$REMOTE_DUMP' | awk '{print \"    volcado: \" \$5}'
"

echo "--- Descargando ---"
scp -q -i "$SSH_KEY" "$SSH_HOST:$REMOTE_DUMP" "$DUMP"
ssh -i "$SSH_KEY" "$SSH_HOST" "rm -f '$REMOTE_DUMP'"

# --- Restaurar en local -----------------------------------------------------
echo "--- Restaurando en '$LOCAL_DB' ---"
"$PSQL" -d "$LOCAL_URL" -v ON_ERROR_STOP=1 -q \
  -c "DROP SCHEMA public CASCADE;" -c "CREATE SCHEMA public;"

# --no-owner/--no-privileges: el rol de producción no existe en local, así que
# todo pasa a pertenecer al usuario del DATABASE_URL local.
"$PG_RESTORE" -d "$LOCAL_URL" --no-owner --no-privileges "$DUMP"

# --- Verificar --------------------------------------------------------------
echo "--- Verificando ---"
TABLAS=$("$PSQL" -d "$LOCAL_URL" -tAc \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';" | tr -d '\r')
FILAS=$("$PSQL" -d "$LOCAL_URL" -tAc \
  "select coalesce(sum((xpath('/row/cnt/text()', query_to_xml(format('select count(*) as cnt from public.%I', table_name), false, true, '')))[1]::text::bigint), 0)
   from information_schema.tables where table_schema='public' and table_type='BASE TABLE';" | tr -d '\r')

echo ""
echo "=== Sincronización completada ==="
echo "    $TABLAS tablas, $FILAS filas en '$LOCAL_DB'"
echo ""
echo "⚠️  Tu BBDD local tiene ahora datos reales de clientes (teléfonos y"
echo "    correos). Revisa las claves de Twilio/LabsMobile, SES y Stripe en"
echo "    $LOCAL_ENV antes de probar nada que envíe notificaciones."