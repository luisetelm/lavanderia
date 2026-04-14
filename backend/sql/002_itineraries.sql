-- ============================================================
-- ITINERARIOS: Cadenas de pasos configurables por producto
-- Ejecutar manualmente en la base de datos de producción
-- ============================================================

-- 1. Tabla de itinerarios (plantillas de proceso)
CREATE TABLE IF NOT EXISTS itinerary (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(80)  NOT NULL UNIQUE,
    description     VARCHAR(255) NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 2. Pasos de cada itinerario (ordenados)
CREATE TABLE IF NOT EXISTS itinerary_step (
    id              SERIAL PRIMARY KEY,
    itinerary_id    INT          NOT NULL REFERENCES itinerary(id) ON DELETE CASCADE,
    step_key        VARCHAR(30)  NOT NULL,
    step_label      VARCHAR(60)  NOT NULL,
    position        INT          NOT NULL,
    duration_min    INT          NOT NULL DEFAULT 0,
    resource_key    VARCHAR(30)  NULL,       -- FK conceptual a resource_config
    auto_progress   BOOLEAN      NOT NULL DEFAULT false,  -- true = mostrar "Iniciar/Completar", false = solo "Completar"

    UNIQUE (itinerary_id, position)
);

CREATE INDEX idx_itinerary_step_itinerary ON itinerary_step(itinerary_id);

-- 3. Añadir columna itinerary_id a Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS itinerary_id INT NULL REFERENCES itinerary(id);
CREATE INDEX IF NOT EXISTS idx_product_itinerary ON "Product"(itinerary_id);

-- 4. Hacer step_config_id nullable en order_line_steps (compatibilidad legacy)
ALTER TABLE order_line_steps ALTER COLUMN step_config_id DROP NOT NULL;

-- 5. Añadir columna itinerary_step_id en order_line_steps
ALTER TABLE order_line_steps ADD COLUMN IF NOT EXISTS itinerary_step_id INT NULL REFERENCES itinerary_step(id);
CREATE INDEX IF NOT EXISTS idx_ols_itinerary_step ON order_line_steps(itinerary_step_id);

-- 6. Añadir recurso de costura
INSERT INTO resource_config (resource_key, label, units, processing_mode, batch_capacity, cycle_duration_min)
VALUES ('sewing', 'Costura', 1, 'individual', 1, 30)
ON CONFLICT (resource_key) DO NOTHING; (resource_key) DO NOTHING;

-- ============================================================
-- SEED: Itinerarios base equivalentes a los servicios actuales
-- ============================================================

-- Lavado mojado
INSERT INTO itinerary (name, description) VALUES
    ('Lavado mojado', 'Lavado en agua + doblado/embolsado')
ON CONFLICT (name) DO NOTHING;

INSERT INTO itinerary_step (itinerary_id, step_key, step_label, position, duration_min, resource_key, auto_progress) VALUES
    ((SELECT id FROM itinerary WHERE name='Lavado mojado'), 'recepcion',  'Recepción',            1,   3, 'manual',     false),
    ((SELECT id FROM itinerary WHERE name='Lavado mojado'), 'lavado',     'Lavado',                2,  70, 'washer_wet', true),
    ((SELECT id FROM itinerary WHERE name='Lavado mojado'), 'secado',     'Secado',                3,  45, 'washer_wet', true),
    ((SELECT id FROM itinerary WHERE name='Lavado mojado'), 'doblado',    'Doblado / Embolsado',   4,  10, 'manual',     false)
ON CONFLICT (itinerary_id, position) DO NOTHING;

-- Lavado seco
INSERT INTO itinerary (name, description) VALUES
    ('Lavado seco', 'Limpieza en seco completa')
ON CONFLICT (name) DO NOTHING;

INSERT INTO itinerary_step (itinerary_id, step_key, step_label, position, duration_min, resource_key, auto_progress) VALUES
    ((SELECT id FROM itinerary WHERE name='Lavado seco'), 'recepcion',      'Recepción',           1,   5, 'manual',      false),
    ((SELECT id FROM itinerary WHERE name='Lavado seco'), 'pretratamiento', 'Pre-tratamiento',     2,  10, 'manual',      false),
    ((SELECT id FROM itinerary WHERE name='Lavado seco'), 'limpieza_seco',  'Limpieza en seco',    3,  45, 'washer_dry',  true),
    ((SELECT id FROM itinerary WHERE name='Lavado seco'), 'planchado',      'Planchado',           4,  15, 'ironing_manual', false),
    ((SELECT id FROM itinerary WHERE name='Lavado seco'), 'embolsado',      'Embolsado',           5,   3, 'manual',      false)
ON CONFLICT (itinerary_id, position) DO NOTHING;

-- Solo plancha
INSERT INTO itinerary (name, description) VALUES
    ('Solo plancha', 'Planchado sin lavado')
ON CONFLICT (name) DO NOTHING;

INSERT INTO itinerary_step (itinerary_id, step_key, step_label, position, duration_min, resource_key, auto_progress) VALUES
    ((SELECT id FROM itinerary WHERE name='Solo plancha'), 'recepcion', 'Recepción', 1,  3, 'manual',         false),
    ((SELECT id FROM itinerary WHERE name='Solo plancha'), 'planchado', 'Planchado', 2, 15, 'ironing_manual', false),
    ((SELECT id FROM itinerary WHERE name='Solo plancha'), 'embolsado', 'Embolsado', 3,  3, 'manual',         false)
ON CONFLICT (itinerary_id, position) DO NOTHING;

-- Lavado mojado + plancha
INSERT INTO itinerary (name, description) VALUES
    ('Lavado mojado + plancha', 'Lavado en agua + planchado')
ON CONFLICT (name) DO NOTHING;

INSERT INTO itinerary_step (itinerary_id, step_key, step_label, position, duration_min, resource_key, auto_progress) VALUES
    ((SELECT id FROM itinerary WHERE name='Lavado mojado + plancha'), 'recepcion',  'Recepción',  1,   3, 'manual',         false),
    ((SELECT id FROM itinerary WHERE name='Lavado mojado + plancha'), 'lavado',     'Lavado',     2,  70, 'washer_wet',     true),
    ((SELECT id FROM itinerary WHERE name='Lavado mojado + plancha'), 'secado',     'Secado',     3,  45, 'washer_wet',     true),
    ((SELECT id FROM itinerary WHERE name='Lavado mojado + plancha'), 'planchado',  'Planchado',  4,  15, 'ironing_manual', false),
    ((SELECT id FROM itinerary WHERE name='Lavado mojado + plancha'), 'embolsado',  'Embolsado',  5,   3, 'manual',         false)
ON CONFLICT (itinerary_id, position) DO NOTHING;

-- Lavado seco + costura (ejemplo para túnicas)
INSERT INTO itinerary (name, description) VALUES
    ('Lavado seco + costura', 'Desarmar, lavar en seco, coser y planchar')
ON CONFLICT (name) DO NOTHING;

INSERT INTO itinerary_step (itinerary_id, step_key, step_label, position, duration_min, resource_key, auto_progress) VALUES
    ((SELECT id FROM itinerary WHERE name='Lavado seco + costura'), 'recepcion',       'Recepción',             1,   5, 'manual',         false),
    ((SELECT id FROM itinerary WHERE name='Lavado seco + costura'), 'desmontar',       'Desmontar / Desarmar',  2,  20, 'sewing',         false),
    ((SELECT id FROM itinerary WHERE name='Lavado seco + costura'), 'limpieza_seco',   'Limpieza en seco',      3,  45, 'washer_dry',     true),
    ((SELECT id FROM itinerary WHERE name='Lavado seco + costura'), 'costura',         'Costura / Montar',      4,  30, 'sewing',         false),
    ((SELECT id FROM itinerary WHERE name='Lavado seco + costura'), 'planchado',       'Planchado',             5,  15, 'ironing_manual', false),
    ((SELECT id FROM itinerary WHERE name='Lavado seco + costura'), 'embolsado',       'Embolsado',             6,   3, 'manual',         false)
ON CONFLICT (itinerary_id, position) DO NOTHING;

-- Servicio externo
INSERT INTO itinerary (name, description) VALUES
    ('Servicio externo', 'Envío a proveedor externo')
ON CONFLICT (name) DO NOTHING;

INSERT INTO itinerary_step (itinerary_id, step_key, step_label, position, duration_min, resource_key, auto_progress) VALUES
    ((SELECT id FROM itinerary WHERE name='Servicio externo'), 'recepcion',          'Recepción',          1,  3, 'manual', false),
    ((SELECT id FROM itinerary WHERE name='Servicio externo'), 'envio_externo',      'Envío externo',      2,  0, NULL,     false),
    ((SELECT id FROM itinerary WHERE name='Servicio externo'), 'recepcion_externo',  'Recepción externo',  3,  0, NULL,     false),
    ((SELECT id FROM itinerary WHERE name='Servicio externo'), 'embolsado',          'Embolsado',          4,  3, 'manual', false)
ON CONFLICT (itinerary_id, position) DO NOTHING;

-- ============================================================
-- MIGRACIÓN: Asignar itinerarios a productos existentes
-- ============================================================
-- Productos con wetWash + ironing → "Lavado mojado + plancha"
UPDATE "Product" SET itinerary_id = (SELECT id FROM itinerary WHERE name='Lavado mojado + plancha')
WHERE "serviceOptions"->>'wetWash' = 'true' AND "serviceOptions"->>'ironing' = 'true'
  AND itinerary_id IS NULL;

-- Productos con solo wetWash → "Lavado mojado"
UPDATE "Product" SET itinerary_id = (SELECT id FROM itinerary WHERE name='Lavado mojado')
WHERE "serviceOptions"->>'wetWash' = 'true' AND ("serviceOptions"->>'ironing' IS NULL OR "serviceOptions"->>'ironing' = 'false')
  AND ("serviceOptions"->>'dryWash' IS NULL OR "serviceOptions"->>'dryWash' = 'false')
  AND itinerary_id IS NULL;

-- Productos con dryWash → "Lavado seco"
UPDATE "Product" SET itinerary_id = (SELECT id FROM itinerary WHERE name='Lavado seco')
WHERE "serviceOptions"->>'dryWash' = 'true'
  AND itinerary_id IS NULL;

-- Productos con solo ironing → "Solo plancha"
UPDATE "Product" SET itinerary_id = (SELECT id FROM itinerary WHERE name='Solo plancha')
WHERE "serviceOptions"->>'ironing' = 'true'
  AND ("serviceOptions"->>'wetWash' IS NULL OR "serviceOptions"->>'wetWash' = 'false')
  AND ("serviceOptions"->>'dryWash' IS NULL OR "serviceOptions"->>'dryWash' = 'false')
  AND itinerary_id IS NULL;

-- Productos con externalService → "Servicio externo"
UPDATE "Product" SET itinerary_id = (SELECT id FROM itinerary WHERE name='Servicio externo')
WHERE "serviceOptions"->>'externalService' = 'true'
  AND itinerary_id IS NULL;

