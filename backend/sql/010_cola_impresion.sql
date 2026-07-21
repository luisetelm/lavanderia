-- ============================================================
-- COLA DE IMPRESIÓN
-- Ejecutar manualmente en la base de datos de producción
--
-- Permite que un dispositivo sin impresora (la tablet del taller) mande a
-- imprimir en la impresora del ordenador principal. El dispositivo no imprime:
-- deja un encargo en esta cola, y el puesto que tiene la impresora lo recoge y
-- lo ejecuta.
--
-- El encargo guarda QUÉ imprimir, no el contenido ya generado: así el puesto
-- receptor reutiliza la misma lógica de impresión de siempre y no hay dos
-- formas distintas de componer una etiqueta.
--
-- Idempotente.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS print_job (
    id          SERIAL PRIMARY KEY,
    -- 'finished_label' (etiqueta de recogida del pedido) | 'garment_label' (por prenda)
    type        VARCHAR(40)  NOT NULL,
    "orderId"   INTEGER      NULL,
    -- Datos sueltos para los encargos que no se resuelven sólo con el pedido
    payload     JSONB        NULL,
    -- pending → printing → done | failed
    status      VARCHAR(20)  NOT NULL DEFAULT 'pending',
    "createdBy" INTEGER      NULL,
    "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Qué puesto lo reclamó, para poder seguir el rastro si algo no sale
    "claimedBy" VARCHAR(80)  NULL,
    "claimedAt" TIMESTAMPTZ  NULL,
    "doneAt"    TIMESTAMPTZ  NULL,
    attempts    INTEGER      NOT NULL DEFAULT 0,
    error       TEXT         NULL
);

-- Consulta caliente: "dame los encargos pendientes, los más antiguos primero".
CREATE INDEX IF NOT EXISTS idx_print_job_pendientes
    ON print_job (status, "createdAt")
    WHERE status IN ('pending', 'printing');

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_print_job_order') THEN
        ALTER TABLE print_job
            ADD CONSTRAINT fk_print_job_order FOREIGN KEY ("orderId")
            REFERENCES "Order"(id) ON DELETE CASCADE;
    END IF;
END $$;

COMMIT;

-- ============================================================
-- Para ver la cola:
--   SELECT id, type, "orderId", status, "claimedBy", "createdAt"
--   FROM print_job WHERE status IN ('pending','printing') ORDER BY "createdAt";
--
-- Para reintentar un encargo fallido:
--   UPDATE print_job SET status='pending', error=NULL WHERE id = ?;
-- ============================================================
