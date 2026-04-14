-- ============================================================
-- DISPLAY ORDER: Controlar el orden de columnas del tablero
-- Ejecutar manualmente en la base de datos de producción
-- ============================================================

ALTER TABLE itinerary_step ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;

-- Inicializar con la posición actual × 10 para tener margen
UPDATE itinerary_step SET display_order = position * 10 WHERE display_order = 0;

