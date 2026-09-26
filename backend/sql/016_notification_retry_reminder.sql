-- 016_notification_retry_reminder.sql
-- Soporte para:
--   1) Reintento con backoff exponencial de notificaciones fallidas (Message/Notification).
--   2) Recordatorio único de "pedido listo" no recogido (Order.readyReminderAt).

-- Reintentos en mensajes de WhatsApp (tabla Message)
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "retryCount" INT NOT NULL DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMPTZ NULL;

-- Reintentos en SMS (tabla Notification)
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "retryCount" INT NOT NULL DEFAULT 0;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMPTZ NULL;

-- Control del recordatorio de pedido no recogido
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "readyReminderAt" TIMESTAMPTZ NULL;

-- Índices para que el cron localice rápido los pendientes
CREATE INDEX IF NOT EXISTS idx_message_retry ON "Message"(status, "nextRetryAt");
CREATE INDEX IF NOT EXISTS idx_notification_retry ON "Notification"(status, "nextRetryAt");
CREATE INDEX IF NOT EXISTS idx_order_ready_reminder ON "Order"(status, "readyReminderAt");

