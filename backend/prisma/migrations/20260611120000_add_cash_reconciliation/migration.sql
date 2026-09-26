-- Conciliación a posteriori a nivel de pago
ALTER TABLE "Payment" ADD COLUMN "reconciled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "reconciledAt" TIMESTAMPTZ(6);
ALTER TABLE "Payment" ADD COLUMN "reconciledBy" INTEGER;

