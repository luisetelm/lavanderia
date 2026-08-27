-- 020_message_error_fallback.sql
--
-- Guardar el motivo de fallo que Meta devuelve por webhook para los mensajes
-- de WhatsApp salientes. Hasta ahora sólo se escribía en la consola del servidor
-- y era imposible diagnosticar desde la app por qué un cliente no recibía avisos
-- (caso clienta 9823: 6 avisos "failed" seguidos sin motivo guardado).
--
-- fallbackNotificationId: si al fallar la entrega se reenvió el aviso por SMS,
-- apunta a la fila de Notification creada, para no reenviar dos veces.

ALTER TABLE "Message"
    ADD COLUMN IF NOT EXISTS "errorCode" INTEGER,
    ADD COLUMN IF NOT EXISTS "errorMessage" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "fallbackNotificationId" INTEGER;
