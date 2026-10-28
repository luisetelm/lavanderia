-- 034: código corto del QR del ticket de cliente.
-- El QR llevaba el enlace de acceso al portal con un JWT dentro (~250
-- caracteres): salía muy denso y el lector del mostrador, que funciona como un
-- teclado, tardaba en "escribirlo". Ahora el ticket lleva
-- HTTPS://APP.TINTEYBURBUJA.COM/T/<código>, con un código aleatorio de 8
-- caracteres por pedido (utils/codigoTicket.js):
--   - el lector del mostrador abre ese pedido (GET /api/orders/by-ticket-code/:code)
--   - el móvil del cliente entra en su portal (GET /api/portal/verify-code),
--     mientras no caduque (30 días desde la última impresión del ticket)
-- Los tickets ya impresos (con JWT) siguen funcionando.
-- Deshacer: DROP TABLE ticket_code;

CREATE TABLE IF NOT EXISTS ticket_code (
    code        VARCHAR(12)  PRIMARY KEY,
    order_id    INTEGER      NOT NULL UNIQUE REFERENCES "Order"(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ  NOT NULL
);
