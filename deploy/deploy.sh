#!/bin/bash
set -e

echo "=== Desplegando Tinte y Burbuja ==="

APP_DIR="/var/www/lavanderia"
cd "$APP_DIR"

# Pull últimos cambios
echo "--- Git pull ---"
git pull origin main

# Backend
echo "--- Backend: instalando dependencias ---"
cd "$APP_DIR/backend"
npm install --production
npx prisma generate

echo "--- Backend: reiniciando ---"
pm2 restart lavanderia || pm2 start src/server.js --name lavanderia --env production

# Frontend
echo "--- Frontend: compilando ---"
cd "$APP_DIR/frontend"
npm install
npm run build

echo ""
echo "=== Deploy completado ==="
echo "Verifica: https://app.tinteyburbuja.com"
echo "Logs:     pm2 logs lavanderia"
