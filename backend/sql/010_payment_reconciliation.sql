-- Conciliación a posteriori a nivel de pago (cuando llega el extracto del banco)
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "reconciled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "reconciledAt" TIMESTAMPTZ(6);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "reconciledBy" INTEGER;

-- La conciliación a nivel de cierre se descarta en favor de la conciliación por pago
ALTER TABLE "CashClosure" DROP COLUMN IF EXISTS "reconciliation";

