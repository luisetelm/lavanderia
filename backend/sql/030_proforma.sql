-- 030_proforma.sql
--
-- Facturas proforma: el presupuesto detallado que se entrega al cliente para que
-- lo presente ante un tercero. El caso que las motiva es TPV/2026/1903, prendas
-- que han sobrevivido a un incendio y cuyo trabajo paga la aseguradora.
--
-- Una proforma NO es una factura: no devenga IVA, no entra en el libro registro
-- de facturas emitidas, no sale en el export a la gestoría (`GET /invoices/report`)
-- y no da derecho a deducción. Es una oferta.
--
-- De ahí que tenga tablas propias y serie propia (PRO/) en lugar de un `type`
-- más en `invoices`:
--
--   * Si el tercero no la acepta, se borra y no queda rastro. Una fila en
--     `invoices` no se borra nunca (ver utils/facturaDe.js y crearRectificativa):
--     habría que anularla con una rectificativa, que es justo el rastro que no
--     se quiere.
--   * No consume número de la serie FAC/, no aparece en /invoices/unpaid ni en
--     el portal del cliente, y no hace que `monthlyInvoicing` dé el pedido por
--     facturado.
--
-- La proforma tampoco toca `OrderLine.invoicedInId`: las líneas siguen
-- pendientes de facturar hasta que se emita la factura de verdad.

BEGIN;

CREATE TABLE IF NOT EXISTS proforma (
    id                 SERIAL PRIMARY KEY,
    number             VARCHAR(20)   NOT NULL UNIQUE,          -- PRO/2026/0001
    "proformaYear"     INT           NOT NULL,
    "issuedAt"         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- Hasta cuándo se mantiene el precio ofertado. Vencida, las prendas se
    -- devuelven sin tratar o se presupuestan de nuevo con la tarifa vigente.
    "validUntil"       DATE          NULL,
    "clientId"         INT           NULL REFERENCES "User"(id),
    -- Ante quién se presenta el documento. La proforma se emite SIEMPRE a nombre
    -- del cliente —es él el obligado al pago—; esto es sólo la mención que
    -- necesita el tercero para identificar el expediente.
    "recipientName"    VARCHAR(160)  NULL,                     -- p. ej. la aseguradora
    "recipientRef"     VARCHAR(80)   NULL,                     -- nº de siniestro, póliza o expediente
    currency           CHAR(3)       NOT NULL DEFAULT 'EUR',
    "totalNet"         NUMERIC(12,2) NOT NULL DEFAULT 0,
    "totalTax"         NUMERIC(12,2) NOT NULL DEFAULT 0,
    "totalGross"       NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- issued      → emitida, esperando respuesta
    -- accepted    → aceptada; se puede trabajar
    -- rejected    → rechazada; se borra y se cancela el pedido
    -- superseded  → sustituida por una revisión (vicio oculto, más trabajo)
    -- invoiced    → ya se emitió la factura; a partir de aquí no se puede borrar
    status             VARCHAR(20)   NOT NULL DEFAULT 'issued',
    notes              TEXT          NULL,
    -- Revisión: la proforma que ésta sustituye.
    "supersedesId"     INT           NULL REFERENCES proforma(id) ON DELETE SET NULL,
    -- Factura que acabó sustituyendo a la proforma.
    "invoiceId"        BIGINT        NULL REFERENCES invoices(id) ON DELETE SET NULL,
    "createdBy"        INT           NULL REFERENCES "User"(id),
    "createdAt"        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    "updatedAt"        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proforma_client ON proforma("clientId");
CREATE INDEX IF NOT EXISTS idx_proforma_status ON proforma(status);

-- Las líneas se copian congeladas: si mañana sube una tarifa, la oferta que ya
-- está en manos del cliente no puede cambiar sola. Misma forma que invoiceLines.
CREATE TABLE IF NOT EXISTS proforma_line (
    id            SERIAL PRIMARY KEY,
    "proformaId"  INT           NOT NULL REFERENCES proforma(id) ON DELETE CASCADE,
    position      INT           NOT NULL,
    description   VARCHAR(255)  NOT NULL,
    quantity      NUMERIC(12,3) NOT NULL DEFAULT 1,
    "unitPrice"   NUMERIC(12,4) NOT NULL,
    "discountPct" NUMERIC(5,2)  NOT NULL DEFAULT 0,
    "taxRatePct"  NUMERIC(5,2)  NOT NULL,
    "netAmount"   NUMERIC(12,2) NOT NULL,
    "taxAmount"   NUMERIC(12,2) NOT NULL,
    "grossAmount" NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proforma_line_proforma ON proforma_line("proformaId");

-- Pedidos que cubre la proforma. Espejo de invoiceTickets, pero sin efecto
-- ninguno sobre la facturación.
CREATE TABLE IF NOT EXISTS proforma_order (
    "proformaId" INT NOT NULL REFERENCES proforma(id) ON DELETE CASCADE,
    "orderId"    INT NOT NULL REFERENCES "Order"(id),
    PRIMARY KEY ("proformaId", "orderId")
);

CREATE INDEX IF NOT EXISTS idx_proforma_order_order ON proforma_order("orderId");

COMMIT;

-- El contador de la serie vive en AppSettings (clave `proforma_last_num_<año>`),
-- no en un MAX() sobre la tabla: una proforma borrada no debe devolver su número
-- al mostrador. Dos documentos distintos con el mismo número en manos de una
-- aseguradora es peor que un hueco en una serie que no es fiscal.
--
-- Comprobación:
-- SELECT * FROM proforma ORDER BY id DESC LIMIT 5;
-- SELECT key, value FROM "AppSettings" WHERE key LIKE 'proforma_last_num_%';
