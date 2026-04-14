-- ============================================================
-- PASOS OPCIONALES: Permite marcar pasos de itinerario como opcionales
-- Se activan al crear el pedido si el trabajador los selecciona
-- Ejecutar manualmente en la base de datos de producción
-- ============================================================

-- 1. Añadir columna is_optional a itinerary_step
ALTER TABLE itinerary_step ADD COLUMN IF NOT EXISTS is_optional BOOLEAN NOT NULL DEFAULT false;

-- 2. Marcar pasos de costura como opcionales en itinerarios que los tengan
UPDATE itinerary_step
SET is_optional = true
WHERE step_key IN ('desmontar', 'costura');

