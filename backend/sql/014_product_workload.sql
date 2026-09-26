-- 014_product_workload.sql
-- Carga de trabajo por producto para planificar la fecha de entrega.
--   counts_for_load : si el producto computa en la carga del día.
--   workload_weight : factor de trabajo (traje=3, camisa=1, kg ropa blanca=0...).

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS counts_for_load BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS workload_weight DOUBLE PRECISION NOT NULL DEFAULT 1;

