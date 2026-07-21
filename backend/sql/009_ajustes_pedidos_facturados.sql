-- ============================================================
-- AJUSTES EN PEDIDOS YA COBRADOS Y FACTURADOS
-- Ver docs/ajustes-pedidos-facturados.md (paso 2)
-- Ejecutar manualmente en la base de datos de producción
--
-- Permite que un pedido acumule varias facturas (la original, las
-- rectificativas por lo que se quita, y las nuevas por lo que se añade),
-- registrando qué factura cubre cada línea del pedido.
--
-- Idempotente: se puede ejecutar varias veces sin efecto adicional.
-- No borra ni modifica ningún dato existente.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Un pedido puede tener varias facturas
-- ------------------------------------------------------------
-- La restricción única sobre ticketId limitaba cada pedido a una sola factura.
-- Es una constraint UNIQUE, no un índice suelto, así que se elimina como tal.
-- La clave primaria compuesta (invoiceId, ticketId) se mantiene, así que
-- sigue sin poder repetirse el mismo pedido dentro de la misma factura.
ALTER TABLE "invoiceTickets" DROP CONSTRAINT IF EXISTS invoicetickets_ticket_pk;

-- ------------------------------------------------------------
-- 2. Trazabilidad línea → factura
-- ------------------------------------------------------------
-- Sin esto no se sabría qué líneas cubre cada factura, y al facturar lo
-- añadido se volvería a facturar el pedido entero.
--   NULL = línea pendiente de facturar.
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "invoicedInId" BIGINT NULL;

-- Relleno inicial: cada línea hereda la factura de su pedido.
-- El EXISTS evita apuntar a facturas que ya no existen (hay 434 líneas de
-- factura huérfanas en producción; ver docs, §3.3.bis).
UPDATE "OrderLine" ol
SET "invoicedInId" = it."invoiceId"
FROM "invoiceTickets" it
WHERE ol."orderId" = it."ticketId"
  AND ol."invoicedInId" IS NULL
  AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = it."invoiceId");

-- Consulta caliente: "líneas pendientes de facturar de este pedido".
CREATE INDEX IF NOT EXISTS "idx_OrderLine_invoicedInId"
    ON "OrderLine" ("invoicedInId");

-- Si se borra una factura, sus líneas vuelven a estar pendientes: no se
-- borran, porque pertenecen al pedido, no a la factura.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orderline_invoice') THEN
        ALTER TABLE "OrderLine"
            ADD CONSTRAINT fk_orderline_invoice FOREIGN KEY ("invoicedInId")
            REFERENCES invoices(id) ON DELETE SET NULL NOT VALID;
    END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Anulación de líneas (nunca borrado)
-- ------------------------------------------------------------
-- Borrar la fila haría irreconstruible el ticket que la factura documenta.
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "voidedAt"   TIMESTAMPTZ NULL;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "voidedBy"   INTEGER     NULL;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS "voidReason" TEXT        NULL;

-- ------------------------------------------------------------
-- 4. Integridad referencial que faltaba
-- ------------------------------------------------------------
-- invoiceLines es la única tabla del circuito de facturación sin clave ajena
-- real: el onDelete: Cascade del schema es sólo declarativo de Prisma y
-- PostgreSQL no lo aplicaba. Por eso un DELETE por SQL dejaba filas colgando.
-- (invoiceTickets sí tiene las suyas: invoicetickets_invoices_id_fk e
--  invoicetickets_order_id_fk.)
--
-- Se usa NOT VALID a propósito: aplica la restricción a las filas nuevas
-- sin validar las antiguas, de modo que las 434 líneas huérfanas actuales
-- se conservan intactas. Si algún día se depuran, basta con
-- VALIDATE CONSTRAINT para ascenderla a clave ajena plena.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoicelines_invoice') THEN
        ALTER TABLE "invoiceLines"
            ADD CONSTRAINT fk_invoicelines_invoice FOREIGN KEY ("invoiceId")
            REFERENCES invoices(id) ON DELETE CASCADE NOT VALID;
    END IF;
END $$;

COMMIT;

-- ============================================================
-- Comprobación posterior (no modifica nada):
--
--   SELECT count(*) FILTER (WHERE "invoicedInId" IS NOT NULL) AS facturadas,
--          count(*) FILTER (WHERE "invoicedInId" IS NULL)     AS pendientes
--   FROM "OrderLine";
--
-- Las pendientes deben corresponder a pedidos sin factura.
-- ============================================================
