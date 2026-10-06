#!/bin/bash
set -e

echo "=== Desplegando Tinte y Burbuja ==="

APP_DIR="/var/www/lavanderia"
cd "$APP_DIR"

# Pull últimos cambios. npm install reescribe backend/package-lock.json en cada
# deploy y el pull se negaba a pisarlo: se descarta antes (es un archivo generado).
echo "--- Git pull ---"
git checkout -- backend/package-lock.json 2>/dev/null || true
git pull origin main

# Backend
echo "--- Backend: instalando dependencias ---"
cd "$APP_DIR/backend"
npm install --production
npx prisma generate

echo "--- Backend: reiniciando ---"
pm2 restart lavanderia || pm2 start src/server.js --name lavanderia --env production

# Conector MCP para Claude (src/mcp/arranque-http.js, puerto MCP_PORT=4100). Necesita las
# tablas de sql/032_mcp_oauth.sql y MCP_PUBLIC_URL en .env; ver README-DEPLOY.md.
echo "--- Conector MCP: reiniciando ---"
pm2 restart lavanderia-mcp || pm2 start src/mcp/arranque-http.js --name lavanderia-mcp --env production

# Aviso si falta la clave privada de QZ Tray (no se sube por git, ver README)
if [ ! -f "$APP_DIR/backend/certs/private-key.pem" ]; then
  echo "⚠️  AVISO: falta backend/certs/private-key.pem (firma de impresión QZ Tray)."
  echo "    Cópiala con scp al servidor; ver 'Impresión con QZ Tray' en README-DEPLOY.md"
fi

# Frontend
echo "--- Frontend: compilando ---"
cd "$APP_DIR/frontend"
npm install
npm run build

echo ""
echo "=== Deploy completado ==="
echo "Verifica: https://app.tinteyburbuja.com"
echo "Logs:     pm2 logs lavanderia"
