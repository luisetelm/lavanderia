# Deploy: Lightsail (todo en uno)

Guía paso a paso para desplegar Tinte y Burbuja en AWS Lightsail con PostgreSQL, Nginx, Node.js y PM2 en una sola instancia.

## Coste estimado: ~$12.50/mes
- Lightsail $10/mes (2 GB RAM, 1 vCPU, 60 GB SSD)
- Snapshots automáticos $2.50/mes (backup diario completo)

---

## Paso 1: Crear instancia Lightsail

1. **AWS Console > Lightsail > Create instance**
2. Configuración:
   - Region: `eu-west-1` (Irlanda) o la más cercana
   - Platform: **Linux/Unix**
   - Blueprint: **Ubuntu 22.04 LTS**
   - Plan: **$10/mes** (2 GB RAM) — mínimo para Puppeteer
   - Name: `lavanderia-app`
3. Crear

### IP estática

1. Lightsail > Networking > **Create static IP**
2. Asociar a `lavanderia-app`
3. En tu proveedor DNS: `app.tinteyburbuja.com` → esta IP

### Puertos del firewall

En Lightsail > Networking > Firewall, verificar que están abiertos:
- SSH (22)
- HTTP (80)
- HTTPS (443)

### Activar snapshots automáticos

1. Lightsail > instancia > Snapshots
2. **Enable automatic snapshots**
3. Elegir hora (ej. 04:00 UTC, cuando hay menos actividad)
4. Coste: $2.50/mes, retiene 7 snapshots

---

## Paso 2: Instalar dependencias

Conectar por SSH (botón "Connect using SSH" en Lightsail).

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 16
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt update
sudo apt install -y postgresql-16

# Nginx
sudo apt install -y nginx

# Certbot (SSL gratis)
sudo apt install -y certbot python3-certbot-nginx

# Dependencias de Puppeteer (generación de PDFs de facturas)
# Ubuntu 22.04:
sudo apt install -y \
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
  libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 \
  libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 \
  libxrandr2 xdg-utils wget libxss1

# Ubuntu 24.04 (si los anteriores fallan, usar estos con sufijo t64):
# sudo apt install -y \
#   ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0t64 \
#   libatk1.0-0t64 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0t64 \
#   libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 \
#   libxrandr2 xdg-utils wget libxss1

# PM2 (mantiene Node corriendo)
sudo npm install -g pm2

# Git
sudo apt install -y git
```

---

## Paso 3: Configurar PostgreSQL

```bash
# Crear usuario y base de datos
sudo -u postgres psql << 'SQL'
CREATE USER lavanderia WITH PASSWORD 'TU_PASSWORD_SEGURA';
CREATE DATABASE lavanderia OWNER lavanderia;
GRANT ALL PRIVILEGES ON DATABASE lavanderia TO lavanderia;
SQL
```

Verificar conexión:
```bash
psql -U lavanderia -d lavanderia -h localhost -c "SELECT 1;"
```

### Configurar backups adicionales (opcional, complementa snapshots)

Crear script de backup de la BBDD por si quieres restauraciones granulares:
```bash
sudo mkdir -p /var/backups/postgresql
sudo chown postgres:postgres /var/backups/postgresql

# Cron diario a las 3:00
sudo -u postgres crontab -e
```

Añadir esta línea:
```
0 3 * * * pg_dump -U lavanderia lavanderia -F c -f /var/backups/postgresql/lavanderia_$(date +\%Y\%m\%d).dump && find /var/backups/postgresql -mtime +14 -delete
```

Esto guarda 14 días de dumps. Los snapshots de Lightsail son el backup principal (disco completo), esto es un extra.

---

## Paso 4: Desplegar la aplicación

```bash
# Crear directorio
sudo mkdir -p /var/www/lavanderia
sudo chown $USER:$USER /var/www/lavanderia

# Clonar repositorio
cd /var/www/lavanderia
git clone <TU_REPO_URL> .
```

### Backend

```bash
cd /var/www/lavanderia/backend
npm install --production
```

Crear `.env`:
```bash
cat > .env << 'EOF'
DATABASE_URL=postgresql://lavanderia:TU_PASSWORD_SEGURA@localhost:5432/lavanderia

JWT_SECRET=genera-un-string-aleatorio-de-64-caracteres

PORT=4000
APP_URL=https://app.tinteyburbuja.com

# Email
FROM_EMAIL=hola@tinteyburbuja.com
FROM_NAME=Tinte y Burbuja
SMTP_HOST=tu-servidor-smtp
SMTP_PORT=587
SMTP_USER=tu-usuario-smtp
SMTP_PASS=tu-password-smtp

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# WhatsApp (cuando lo configures)
#WHATSAPP_TOKEN=
#WHATSAPP_PHONE_NUMBER_ID=
#WHATSAPP_VERIFY_TOKEN=
#WHATSAPP_BUSINESS_ACCOUNT_ID=

# Google Reviews (cuando lo configures)
#GOOGLE_CLIENT_ID=
#GOOGLE_CLIENT_SECRET=
#GOOGLE_REDIRECT_URI=https://app.tinteyburbuja.com/api/google/callback
#GOOGLE_ACCOUNT_ID=
#GOOGLE_LOCATION_ID=
EOF
```

Generar cliente Prisma:
```bash
npx prisma generate
```

### Frontend

```bash
cd /var/www/lavanderia/frontend
npm install
npm run build
```

### Iniciar backend con PM2

```bash
cd /var/www/lavanderia/backend
pm2 start src/server.js --name lavanderia
pm2 save
pm2 startup
# ↑ Ejecutar el comando que muestra (sudo env PATH=... pm2 startup ...)
```

Verificar:
```bash
pm2 status
curl http://localhost:4000
# → {"status":"ok"}
```

---

## Paso 5: Configurar Nginx

```bash
sudo cp /var/www/lavanderia/deploy/nginx-lavanderia.conf /etc/nginx/sites-available/lavanderia
sudo ln -sf /etc/nginx/sites-available/lavanderia /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

Verificar: `http://app.tinteyburbuja.com` debería cargar (sin SSL aún).

---

## Paso 6: SSL con Let's Encrypt

```bash
sudo certbot --nginx -d app.tinteyburbuja.com
```

Seguir instrucciones (email, aceptar TOS, redirigir HTTP→HTTPS).

Verificar renovación automática:
```bash
sudo certbot renew --dry-run
```

---

## Paso 7: Migrar datos desde tu servidor actual

### En tu Ubuntu actual:

```bash
pg_dump -h localhost -U tu_usuario -d lavanderia -F c -f lavanderia_backup.dump
```

Copiar al Lightsail:
```bash
scp -i tu-key.pem lavanderia_backup.dump ubuntu@<IP_LIGHTSAIL>:/tmp/
```

### En el Lightsail:

```bash
pg_restore -U lavanderia -d lavanderia -h localhost -v /tmp/lavanderia_backup.dump
rm /tmp/lavanderia_backup.dump
```

---

## Paso 8: Configurar webhooks

Con HTTPS activo, configurar:

### Stripe
Dashboard > Developers > Webhooks > Add endpoint:
- URL: `https://app.tinteyburbuja.com/api/stripe/webhook`
- Eventos: `checkout.session.completed`, `payment_intent.payment_failed`
- Copiar webhook secret → `.env` → `STRIPE_WEBHOOK_SECRET`
- Reiniciar: `pm2 restart lavanderia`

### WhatsApp (cuando lo actives)
Meta Business > WhatsApp > Configuration:
- Callback URL: `https://app.tinteyburbuja.com/api/whatsapp/webhook`
- Verify token: el de `.env` → `WHATSAPP_VERIFY_TOKEN`

---

## Deploys futuros

Un solo comando:
```bash
/var/www/lavanderia/deploy.sh
```

---

## Impresión con QZ Tray (etiquetas y tickets)

QZ Tray es una app de escritorio que corre en **cada PC con impresora** (la caja/TPV),
no en el servidor. El navegador se conecta a `wss://localhost` de su propia máquina.
La firma de las peticiones está centralizada en el servidor.

### Parte servidor (una sola vez)

La clave privada (`backend/certs/private-key.pem`) está en `.gitignore`, así que
**NO se sube con git**. Tienes dos formas de proporcionarla al servidor:

#### Opción A — Variable de entorno (recomendada, sin `scp`)

Añade la clave (y opcionalmente el certificado) al `.env` del backend. Como el
PEM tiene varias líneas, sustituye los saltos de línea por `\n` en una sola línea:

```env
# Clave privada para firmar las peticiones de QZ Tray (impresión)
QZ_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n...\n-----END PRIVATE KEY-----
# (opcional) certificado público; si no se define, se lee de certs/digital-certificate.txt
#QZ_CERT=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----
```

El código (`backend/src/routes/qz.js`) lee primero `QZ_PRIVATE_KEY` / `QZ_CERT` y,
si no existen, cae al archivo en `certs/`. Tras editar el `.env`:

```bash
pm2 restart lavanderia
```

> Para convertir el `.pem` a una línea con `\n` (desde tu PC, PowerShell):
> `(Get-Content backend\certs\private-key.pem -Raw) -replace "\r?\n","\n"`

#### Opción B — Copiar el archivo con `scp`

```bash
# Desde tu PC (donde se generó el certificado):
scp -i tu-key.pem backend/certs/private-key.pem \
    ubuntu@<IP_LIGHTSAIL>:/var/www/lavanderia/backend/certs/private-key.pem
```

El certificado público (`digital-certificate.txt`) sí está en git y llega con
`git pull`. Tras copiar la clave, reinicia el backend:

```bash
pm2 restart lavanderia
# Verifica que el endpoint responde:
curl https://app.tinteyburbuja.com/api/qz/cert   # → debe devolver el certificado PEM
```

> Si regeneras el certificado, vuelve a copiar `private-key.pem` al servidor
> Y repite la "Parte cliente" en cada caja (cambia la clave).

### Parte cliente (una vez por cada PC con impresora)

1. Instalar **QZ Tray**: https://qz.io/download/ (incluye Java).
2. Ejecutar el script de confianza, que descarga el certificado del servidor y lo
   añade a la lista de confianza de QZ Tray:
   - Copia `deploy/setup-qz-trust.ps1` al PC.
   - Clic derecho → **Ejecutar con PowerShell** (pedirá permisos de administrador).
3. Listo: ese PC imprime sin mostrar el diálogo de seguridad.

> ¿Por qué el botón "Allow" + "Remember" salía deshabilitado? Porque QZ Tray no
> permite recordar un "Allow" para un certificado en el que no confía. El script
> resuelve esto añadiendo el certificado a la confianza (`authcert.override`).

---


## Comandos útiles

```bash
# Estado del backend
pm2 status

# Logs en tiempo real
pm2 logs lavanderia

# Reiniciar backend
pm2 restart lavanderia

# Monitor de recursos
pm2 monit

# Logs de Nginx
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Conectar a la BBDD
psql -U lavanderia -d lavanderia -h localhost

# Backup manual
pg_dump -U lavanderia -d lavanderia -F c -f backup_manual.dump

# Restaurar backup
pg_restore -U lavanderia -d lavanderia -h localhost -c backup_manual.dump

# Ver tamaño de la BBDD
psql -U lavanderia -d lavanderia -c "SELECT pg_size_pretty(pg_database_size('lavanderia'));"

# Espacio en disco
df -h
```

---

## Verificación post-deploy

1. `https://app.tinteyburbuja.com` → Login
2. `https://app.tinteyburbuja.com/portal/login` → Portal cliente
3. Login → POS funcional, crear pedido, pagar
4. Ventas → Filtros, facturar, cobrar
5. `pm2 logs lavanderia` → Sin errores

---

## Restaurar desde snapshot (disaster recovery)

Si algo sale mal:
1. Lightsail > instancia > Snapshots
2. Seleccionar snapshot → **Create new instance from snapshot**
3. La nueva instancia tiene todo: app + BBDD + configuración
4. Reasignar la IP estática a la nueva instancia
5. Todo funciona sin tocar nada más
