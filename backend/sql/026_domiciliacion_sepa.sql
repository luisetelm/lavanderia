-- 026_domiciliacion_sepa.sql
--
-- Domiciliación SEPA con Stripe (backend/src/services/sepa.js,
-- docs/domiciliacion-sepa.md).
--
-- El cliente firma una sola vez la orden de domiciliación en una página de
-- Stripe. Stripe la guarda asociada a un Customer; aquí se guarda la referencia
-- para poder cargar después sus facturas sin que intervenga.
--
-- "User"."stripeCustomerId": Customer de Stripe del cliente, se crea la primera
-- vez que se le genera un enlace de firma y se reutiliza siempre.
--
-- sepa_mandate: una fila por orden firmada. Sólo una puede estar 'active' por
-- cliente; al firmar otra (cambio de cuenta) la anterior pasa a 'replaced'.
--   status: active | pending | inactive (cancelada por el banco o el cliente,
--           llega con el webhook mandate.updated) | replaced | revoked
--           (cancelada desde la ficha del cliente)
--
-- Sin cambios de estructura en invoices ni en "Payment":
--   invoices."paymentStatus" admite además 'sepa_processing' (adeudo lanzado,
--   esperando confirmación de Stripe) y 'sepa_failed' (rechazado o devuelto).
--   "Payment".method = 'sepa'; status pending -> completed | failed | disputed.
--
-- Idempotente.

BEGIN;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCustomerId" VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeCustomerId_key" ON "User" ("stripeCustomerId");

CREATE TABLE IF NOT EXISTS sepa_mandate (
    id                       SERIAL PRIMARY KEY,
    client_id                INTEGER        NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    stripe_customer_id       VARCHAR(255)   NOT NULL,
    stripe_payment_method_id VARCHAR(255)   NOT NULL,
    stripe_mandate_id        VARCHAR(255)   NOT NULL UNIQUE,
    reference                VARCHAR(64),
    iban_last4               VARCHAR(4),
    bank_code                VARCHAR(20),
    country                  CHAR(2),
    status                   VARCHAR(20)    NOT NULL DEFAULT 'active',
    accepted_at              TIMESTAMPTZ(6),
    revoked_at               TIMESTAMPTZ(6),
    created_at               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sepa_mandate_client_status_idx
    ON sepa_mandate (client_id, status);

COMMIT;

-- Comprobación:
-- SELECT m.id, u."firstName", u."lastName", m.status, m.iban_last4, m.reference, m.accepted_at
--   FROM sepa_mandate m
--   JOIN "User" u ON u.id = m.client_id
--  ORDER BY m.created_at DESC;
