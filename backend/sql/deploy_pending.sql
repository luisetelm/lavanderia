-- ============================================================
-- DEPLOY PENDIENTE DE PRODUCCIÓN
-- Generado: 2026-04-14
--
-- Este script consolida TODOS los cambios de BBDD que faltan
-- en producción. Ejecutar en orden, de arriba a abajo.
--
-- IMPORTANTE: Hacer backup antes de ejecutar:
--   pg_dump -U usuario -d lavanderia > backup_20260414.sql
--
-- Después de ejecutar este SQL, ejecutar en el servidor:
--   cd /var/www/lavanderia/backend
--   npx prisma migrate resolve --applied 20260319120000_add_notify_channel
--   npx prisma migrate resolve --applied 20260323190000_add_media_type
--   npx prisma migrate resolve --applied 20260323200000_rename_notes_to_annotations
--   npx prisma migrate resolve --applied 20260324200000_add_conversation_table
--   npx prisma generate
-- ============================================================

BEGIN;


-- ============================================================
-- BLOQUE B: 001_tracking_tables.sql — Recursos, calendario, tracking
-- ============================================================

-- B1. Recursos (máquinas y personas)
CREATE TABLE IF NOT EXISTS resource_config (
    id                  SERIAL PRIMARY KEY,
    resource_key        VARCHAR(30)  NOT NULL UNIQUE,
    label               VARCHAR(60)  NOT NULL,
    units               INT          NOT NULL DEFAULT 1,
    processing_mode     VARCHAR(12)  NOT NULL DEFAULT 'individual',
    batch_capacity      INT          NOT NULL DEFAULT 1,
    cycle_duration_min  INT          NOT NULL DEFAULT 0
);

-- B2. Calendario laboral
CREATE TABLE IF NOT EXISTS work_schedule (
    id              SERIAL PRIMARY KEY,
    day_of_week     INT          NOT NULL UNIQUE CHECK (day_of_week BETWEEN 0 AND 6),
    is_working      BOOLEAN      NOT NULL DEFAULT true,
    start_time      VARCHAR(5)   NULL,
    end_time        VARCHAR(5)   NULL,
    capacity_min    INT          NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS work_schedule_exceptions (
    id              SERIAL PRIMARY KEY,
    date            DATE         NOT NULL UNIQUE,
    is_working      BOOLEAN      NOT NULL DEFAULT false,
    start_time      VARCHAR(5)   NULL,
    end_time        VARCHAR(5)   NULL,
    capacity_min    INT          NOT NULL DEFAULT 0,
    label           VARCHAR(60)  NULL
);

CREATE INDEX IF NOT EXISTS idx_work_exceptions_date ON work_schedule_exceptions(date);

-- B3. Pasos de servicio (configuración legacy)
CREATE TABLE IF NOT EXISTS service_step_config (
    id              SERIAL PRIMARY KEY,
    service_type    VARCHAR(30)  NOT NULL,
    step_key        VARCHAR(30)  NOT NULL,
    step_label      VARCHAR(60)  NOT NULL,
    position        INT          NOT NULL,
    duration_min    INT          NOT NULL DEFAULT 0,
    resource_key    VARCHAR(30)  NULL,
    UNIQUE (service_type, step_key)
);

-- B4. Tracking por línea de pedido
CREATE TABLE IF NOT EXISTS order_line_steps (
    id              SERIAL PRIMARY KEY,
    order_line_id   INT          NOT NULL REFERENCES "OrderLine"(id) ON DELETE CASCADE,
    step_config_id  INT          NULL REFERENCES service_step_config(id),
    status          VARCHAR(15)  NOT NULL DEFAULT 'pending',
    started_at      TIMESTAMPTZ  NULL,
    completed_at    TIMESTAMPTZ  NULL,
    completed_by    INT          NULL REFERENCES "User"(id),
    UNIQUE (order_line_id, step_config_id)
);

CREATE INDEX IF NOT EXISTS idx_order_line_steps_line ON order_line_steps(order_line_id);
CREATE INDEX IF NOT EXISTS idx_order_line_steps_status ON order_line_steps(status);

-- B5. Seed: Recursos
INSERT INTO resource_config (resource_key, label, units, processing_mode, batch_capacity, cycle_duration_min) VALUES
    ('washer_wet',      'Lavadora húmeda',    2, 'batch',      8,  90),
    ('washer_dry',      'Lavadora en seco',   1, 'batch',      6,  50),
    ('ironing_manual',  'Planchado manual',   1, 'individual', 1,  15),
    ('manual',          'Trabajo manual',     2, 'individual', 1,   5)
ON CONFLICT (resource_key) DO NOTHING;

-- B6. Seed: Calendario semanal
INSERT INTO work_schedule (day_of_week, is_working, start_time, end_time, capacity_min) VALUES
    (0, false, NULL,    NULL,    0),
    (1, true,  '09:00', '20:00', 540),
    (2, true,  '09:00', '20:00', 540),
    (3, true,  '09:00', '20:00', 540),
    (4, true,  '09:00', '20:00', 540),
    (5, true,  '09:00', '20:00', 540),
    (6, false, NULL,    NULL,    0)
ON CONFLICT (day_of_week) DO NOTHING;

-- B7. Seed: Festivos 2026
INSERT INTO work_schedule_exceptions (date, is_working, capacity_min, label) VALUES
    ('2026-01-01', false, 0, 'Año Nuevo'),
    ('2026-01-06', false, 0, 'Reyes Magos'),
    ('2026-04-02', false, 0, 'Jueves Santo'),
    ('2026-04-03', false, 0, 'Viernes Santo'),
    ('2026-05-01', false, 0, 'Día del Trabajador'),
    ('2026-08-15', false, 0, 'Asunción de la Virgen'),
    ('2026-10-12', false, 0, 'Fiesta Nacional'),
    ('2026-11-02', false, 0, 'Todos los Santos'),
    ('2026-12-07', false, 0, 'Puente Constitución'),
    ('2026-12-08', false, 0, 'Inmaculada Concepción'),
    ('2026-12-25', false, 0, 'Navidad')
ON CONFLICT (date) DO NOTHING;

-- B8. Seed: Pasos por tipo de servicio (legacy)
INSERT INTO service_step_config (service_type, step_key, step_label, position, duration_min, resource_key) VALUES
    ('wetWash', 'recepcion',   'Recepción',           1,   3, 'manual'),
    ('wetWash', 'lavado',      'Lavado',               2,  70, 'washer_wet'),
    ('wetWash', 'secado',      'Secado',               3,  45, 'washer_wet'),
    ('wetWash', 'doblado',     'Doblado / Embolsado',  4,  10, 'manual')
ON CONFLICT (service_type, step_key) DO NOTHING;

INSERT INTO service_step_config (service_type, step_key, step_label, position, duration_min, resource_key) VALUES
    ('dryWash', 'recepcion',      'Recepción',          1,   5, 'manual'),
    ('dryWash', 'pretratamiento', 'Pre-tratamiento',    2,  10, 'manual'),
    ('dryWash', 'limpieza_seco',  'Limpieza en seco',   3,  45, 'washer_dry'),
    ('dryWash', 'planchado',      'Planchado',          4,  15, 'ironing_manual'),
    ('dryWash', 'embolsado',      'Embolsado',          5,   3, 'manual')
ON CONFLICT (service_type, step_key) DO NOTHING;

INSERT INTO service_step_config (service_type, step_key, step_label, position, duration_min, resource_key) VALUES
    ('ironing', 'recepcion',  'Recepción',  1,  3, 'manual'),
    ('ironing', 'planchado',  'Planchado',  2, 15, 'ironing_manual'),
    ('ironing', 'embolsado',  'Embolsado',  3,  3, 'manual')
ON CONFLICT (service_type, step_key) DO NOTHING;

INSERT INTO service_step_config (service_type, step_key, step_label, position, duration_min, resource_key) VALUES
    ('externalService', 'recepcion',          'Recepción',          1,  3, 'manual'),
    ('externalService', 'envio_externo',      'Envío externo',      2,  0, NULL),
    ('externalService', 'recepcion_externo',  'Recepción externo',  3,  0, NULL),
    ('externalService', 'embolsado',          'Embolsado',          4,  3, 'manual')
ON CONFLICT (service_type, step_key) DO NOTHING;


-- ============================================================
-- BLOQUE C: 002_itineraries.sql — Itinerarios
-- ============================================================

-- C1. Tabla de itinerarios
CREATE TABLE IF NOT EXISTS itinerary (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(80)  NOT NULL UNIQUE,
    description     VARCHAR(255) NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- C2. Pasos de itinerario
CREATE TABLE IF NOT EXISTS itinerary_step (
    id              SERIAL PRIMARY KEY,
    itinerary_id    INT          NOT NULL REFERENCES itinerary(id) ON DELETE CASCADE,
    step_key        VARCHAR(30)  NOT NULL,
    step_label      VARCHAR(60)  NOT NULL,
    position        INT          NOT NULL,
    duration_min    INT          NOT NULL DEFAULT 0,
    resource_key    VARCHAR(30)  NULL,
    auto_progress   BOOLEAN      NOT NULL DEFAULT false,
    UNIQUE (itinerary_id, position)
);

CREATE INDEX IF NOT EXISTS idx_itinerary_step_itinerary ON itinerary_step(itinerary_id);

-- C3. Columna itinerary_id en Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS itinerary_id INT NULL REFERENCES itinerary(id);
CREATE INDEX IF NOT EXISTS idx_product_itinerary ON "Product"(itinerary_id);

-- C4. step_config_id nullable
ALTER TABLE order_line_steps ALTER COLUMN step_config_id DROP NOT NULL;

-- C5. Columna itinerary_step_id en order_line_steps
ALTER TABLE order_line_steps ADD COLUMN IF NOT EXISTS itinerary_step_id INT NULL REFERENCES itinerary_step(id);
CREATE INDEX IF NOT EXISTS idx_ols_itinerary_step ON order_line_steps(itinerary_step_id);

-- C6. Recurso de costura
INSERT INTO resource_config (resource_key, label, units, processing_mode, batch_capacity, cycle_duration_min)
VALUES ('sewing', 'Costura', 1, 'individual', 1, 30)
ON CONFLICT (resource_key) DO NOTHING;

-- C7. Seed: Itinerarios base
INSERT INTO itinerary (name, description) VALUES
    ('Lavado mojado', 'Lavado en agua + doblado/embolsado')
ON CONFLICT (name) DO NOTHING;

INSERT INTO itinerary_step (itinerary_id, step_key, step_label, position, duration_min, resource_key, auto_progress) VALUES
    ((SELECT id FROM itinerary WHERE name='Lavado mojado'), 'recepcion',  'Recepción',            1,   3, 'manual',     false),
    ((SELECT id FROM itinerary WHERE name='Lavado mojado'), 'lavado',     'Lavado',                2,  70, 'washer_wet', true),
    ((SELECT id FROM itinerary WHERE name='Lavado mojado'), 'secado',     'Secado',                3,  45, 'washer_wet', true),
    ((SELECT id FROM itinerary WHERE name='Lavado mojado'), 'doblado',    'Doblado / Embolsado',   4,  10, 'manual',     false)
ON CONFLICT (itinerary_id, position) DO NOTHING;

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

INSERT INTO itinerary (name, description) VALUES
    ('Solo plancha', 'Planchado sin lavado')
ON CONFLICT (name) DO NOTHING;

INSERT INTO itinerary_step (itinerary_id, step_key, step_label, position, duration_min, resource_key, auto_progress) VALUES
    ((SELECT id FROM itinerary WHERE name='Solo plancha'), 'recepcion', 'Recepción', 1,  3, 'manual',         false),
    ((SELECT id FROM itinerary WHERE name='Solo plancha'), 'planchado', 'Planchado', 2, 15, 'ironing_manual', false),
    ((SELECT id FROM itinerary WHERE name='Solo plancha'), 'embolsado', 'Embolsado', 3,  3, 'manual',         false)
ON CONFLICT (itinerary_id, position) DO NOTHING;

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

INSERT INTO itinerary (name, description) VALUES
    ('Servicio externo', 'Envío a proveedor externo')
ON CONFLICT (name) DO NOTHING;

INSERT INTO itinerary_step (itinerary_id, step_key, step_label, position, duration_min, resource_key, auto_progress) VALUES
    ((SELECT id FROM itinerary WHERE name='Servicio externo'), 'recepcion',          'Recepción',          1,  3, 'manual', false),
    ((SELECT id FROM itinerary WHERE name='Servicio externo'), 'envio_externo',      'Envío externo',      2,  0, NULL,     false),
    ((SELECT id FROM itinerary WHERE name='Servicio externo'), 'recepcion_externo',  'Recepción externo',  3,  0, NULL,     false),
    ((SELECT id FROM itinerary WHERE name='Servicio externo'), 'embolsado',          'Embolsado',          4,  3, 'manual', false)
ON CONFLICT (itinerary_id, position) DO NOTHING;

-- C8. Migración: asignar itinerarios a productos existentes
UPDATE "Product" SET itinerary_id = (SELECT id FROM itinerary WHERE name='Lavado mojado + plancha')
WHERE "serviceOptions"->>'wetWash' = 'true' AND "serviceOptions"->>'ironing' = 'true'
  AND itinerary_id IS NULL;

UPDATE "Product" SET itinerary_id = (SELECT id FROM itinerary WHERE name='Lavado mojado')
WHERE "serviceOptions"->>'wetWash' = 'true' AND ("serviceOptions"->>'ironing' IS NULL OR "serviceOptions"->>'ironing' = 'false')
  AND ("serviceOptions"->>'dryWash' IS NULL OR "serviceOptions"->>'dryWash' = 'false')
  AND itinerary_id IS NULL;

UPDATE "Product" SET itinerary_id = (SELECT id FROM itinerary WHERE name='Lavado seco')
WHERE "serviceOptions"->>'dryWash' = 'true'
  AND itinerary_id IS NULL;

UPDATE "Product" SET itinerary_id = (SELECT id FROM itinerary WHERE name='Solo plancha')
WHERE "serviceOptions"->>'ironing' = 'true'
  AND ("serviceOptions"->>'wetWash' IS NULL OR "serviceOptions"->>'wetWash' = 'false')
  AND ("serviceOptions"->>'dryWash' IS NULL OR "serviceOptions"->>'dryWash' = 'false')
  AND itinerary_id IS NULL;

UPDATE "Product" SET itinerary_id = (SELECT id FROM itinerary WHERE name='Servicio externo')
WHERE "serviceOptions"->>'externalService' = 'true'
  AND itinerary_id IS NULL;


-- ============================================================
-- BLOQUE D: 003_optional_steps.sql — Pasos opcionales
-- ============================================================

ALTER TABLE itinerary_step ADD COLUMN IF NOT EXISTS is_optional BOOLEAN NOT NULL DEFAULT false;

UPDATE itinerary_step
SET is_optional = true
WHERE step_key IN ('desmontar', 'costura');


-- ============================================================
-- BLOQUE E: 004_line_color.sql — Color de prenda
-- ============================================================

ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS color VARCHAR(30) NULL;


-- ============================================================
-- BLOQUE F: 006_display_order.sql — Orden de columnas del tablero
-- ============================================================

ALTER TABLE itinerary_step ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;

UPDATE itinerary_step SET display_order = position * 10 WHERE display_order = 0;


-- ============================================================
-- BLOQUE G: 007_capacity_unit.sql — Unidad de capacidad en recursos
-- ============================================================

ALTER TABLE resource_config ADD COLUMN IF NOT EXISTS capacity_unit VARCHAR(15) DEFAULT 'items';

UPDATE resource_config SET capacity_unit = 'kg' WHERE resource_key = 'washer_wet' AND capacity_unit = 'items';


-- ============================================================
-- BLOQUE H: 008_fix_time_columns.sql — TIME → VARCHAR(5)
-- ============================================================
-- Si las tablas se crearon con TIME (deploy anterior), convierte a VARCHAR(5).
-- Si ya son VARCHAR(5) (deploy limpio), no hace nada.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'work_schedule' AND column_name = 'start_time'
          AND data_type IN ('time without time zone', 'time with time zone')
    ) THEN
        ALTER TABLE work_schedule ALTER COLUMN start_time TYPE VARCHAR(5) USING TO_CHAR(start_time, 'HH24:MI');
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'work_schedule' AND column_name = 'end_time'
          AND data_type IN ('time without time zone', 'time with time zone')
    ) THEN
        ALTER TABLE work_schedule ALTER COLUMN end_time TYPE VARCHAR(5) USING TO_CHAR(end_time, 'HH24:MI');
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'work_schedule_exceptions' AND column_name = 'start_time'
          AND data_type IN ('time without time zone', 'time with time zone')
    ) THEN
        ALTER TABLE work_schedule_exceptions ALTER COLUMN start_time TYPE VARCHAR(5) USING TO_CHAR(start_time, 'HH24:MI');
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'work_schedule_exceptions' AND column_name = 'end_time'
          AND data_type IN ('time without time zone', 'time with time zone')
    ) THEN
        ALTER TABLE work_schedule_exceptions ALTER COLUMN end_time TYPE VARCHAR(5) USING TO_CHAR(end_time, 'HH24:MI');
    END IF;
END $$;


COMMIT;

-- ============================================================
-- POST-SCRIPT: Marcar migraciones Prisma como aplicadas
-- ============================================================
-- Ejecutar en el servidor DESPUÉS del SQL anterior:
--
--   cd /var/www/lavanderia/backend
--   npx prisma migrate resolve --applied 20260319120000_add_notify_channel
--   npx prisma migrate resolve --applied 20260323190000_add_media_type
--   npx prisma migrate resolve --applied 20260323200000_rename_notes_to_annotations
--   npx prisma migrate resolve --applied 20260324200000_add_conversation_table
--   npx prisma generate
--
-- Esto marca las migraciones como ya ejecutadas sin volver a correrlas.
-- ============================================================

