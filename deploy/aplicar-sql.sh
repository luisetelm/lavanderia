#!/bin/bash
# Aplica los SQL de backend/sql que aún no se han ejecutado en esta base de datos.
# Lo llama deploy.sh en cada despliegue; también se puede lanzar a mano.
#
# - Lleva la cuenta en la tabla sql_aplicado (nombre del archivo y cuándo).
# - Sólo mira los archivos NNN_*.sql, en orden (no deploy_pending.sql).
# - Si uno falla, se para con error y deploy.sh no reinicia la app.
# - La primera vez, los anteriores a PRIMERO_AUTOMATICO se dan por aplicados
#   sin ejecutarlos: hasta el 033 se ejecutaron a mano en producción.
# - Cada archivo lleva su propia transacción si la necesita (BEGIN/COMMIT):
#   escribirlos de forma que se puedan repetir (IF NOT EXISTS...) por si acaso.
set -e

PRIMERO_AUTOMATICO="034"

APP_DIR="${APP_DIR:-/var/www/lavanderia}"
cd "$APP_DIR/backend"

# Conexión: la misma que usa la app. psql no entiende los parámetros que
# Prisma añade a la URL (?schema=public...), así que se quitan.
DB_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')
DB_URL="${DB_URL%%\?*}"
if [ -z "$DB_URL" ]; then
    echo "ERROR: no se encuentra DATABASE_URL en $APP_DIR/backend/.env"
    exit 1
fi
# (sin los avisos de PostgreSQL, como «la tabla ya existe» en cada despliegue)
consulta() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qtA -c "SET client_min_messages TO warning" -c "$1"; }

consulta "CREATE TABLE IF NOT EXISTS sql_aplicado (
    archivo     VARCHAR(255) PRIMARY KEY,
    aplicado_en TIMESTAMPTZ  NOT NULL DEFAULT now()
);"

# Primera vez: marcar como aplicados los que ya se ejecutaron a mano
if [ "$(consulta 'SELECT count(*) FROM sql_aplicado')" = "0" ]; then
    for f in sql/[0-9][0-9][0-9]_*.sql; do
        n=$(basename "$f")
        if [[ "${n:0:3}" < "$PRIMERO_AUTOMATICO" ]]; then
            consulta "INSERT INTO sql_aplicado (archivo) VALUES ('$n') ON CONFLICT DO NOTHING"
        fi
    done
    echo "Primera vez: los SQL anteriores al $PRIMERO_AUTOMATICO se dan por aplicados"
fi

pendientes=0
for f in sql/[0-9][0-9][0-9]_*.sql; do
    n=$(basename "$f")
    [ "$(consulta "SELECT 1 FROM sql_aplicado WHERE archivo = '$n'")" = "1" ] && continue
    echo "Aplicando $n"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
    consulta "INSERT INTO sql_aplicado (archivo) VALUES ('$n')"
    pendientes=$((pendientes + 1))
done
[ "$pendientes" = "0" ] && echo "Ningún SQL pendiente"
exit 0
