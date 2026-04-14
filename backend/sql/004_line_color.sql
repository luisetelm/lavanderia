-- ============================================================
-- COLOR DE PRENDA: Identificar prendas visualmente
-- Ejecutar manualmente en la base de datos de producción
-- ============================================================

ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS color VARCHAR(30) NULL;

