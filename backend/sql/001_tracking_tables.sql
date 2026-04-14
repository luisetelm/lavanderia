-- ============================================================
-- Tracking de pasos por línea de pedido + Capacidad + Calendario
-- Ejecutar manualmente en la base de datos de producción
-- ============================================================

-- ============================================================
-- 1. RECURSOS (máquinas y personas)
-- ============================================================
-- processing_mode:
--   'batch'      → la máquina procesa varias prendas a la vez (ej: lavadora)
--                   cycle_duration_min = duración del ciclo completo
--                   batch_capacity = nº máx de prendas por ciclo
--   'individual'  → se procesa prenda a prenda (ej: planchado)
--                   cycle_duration_min = duración por prenda

CREATE TABLE IF NOT EXISTS resource_config (
    id                  SERIAL PRIMARY KEY,
    resource_key        VARCHAR(30)  NOT NULL UNIQUE,
    label               VARCHAR(60)  NOT NULL,
    units               INT          NOT NULL DEFAULT 1,       -- Nº de máquinas/personas
    processing_mode     VARCHAR(12)  NOT NULL DEFAULT 'individual', -- 'batch' o 'individual'
    batch_capacity      INT          NOT NULL DEFAULT 1,       -- Para batch: prendas por ciclo
    cycle_duration_min  INT          NOT NULL DEFAULT 0        -- Para batch: min/ciclo. Para individual: min/prenda
);

-- ============================================================
-- 2. CALENDARIO LABORAL
-- ============================================================

-- Horario semanal por defecto (lunes a domingo)
-- day_of_week: 0=Domingo, 1=Lunes, 2=Martes ... 6=Sábado
CREATE TABLE IF NOT EXISTS work_schedule (
    id              SERIAL PRIMARY KEY,
    day_of_week     INT          NOT NULL UNIQUE CHECK (day_of_week BETWEEN 0 AND 6),
    is_working      BOOLEAN      NOT NULL DEFAULT true,
    start_time      TIME         NULL,       -- ej: 09:00
    end_time        TIME         NULL,       -- ej: 14:00 o 19:00
    capacity_min    INT          NOT NULL DEFAULT 0  -- Minutos efectivos de trabajo
);

-- Excepciones: festivos, jornadas especiales, vacaciones
CREATE TABLE IF NOT EXISTS work_schedule_exceptions (
    id              SERIAL PRIMARY KEY,
    date            DATE         NOT NULL UNIQUE,
    is_working      BOOLEAN      NOT NULL DEFAULT false,
    start_time      TIME         NULL,
    end_time        TIME         NULL,
    capacity_min    INT          NOT NULL DEFAULT 0,
    label           VARCHAR(60)  NULL   -- "Festivo nacional", "Jornada reducida", "Vacaciones"
);

CREATE INDEX idx_work_exceptions_date ON work_schedule_exceptions(date);

-- ============================================================
-- 3. PASOS DE SERVICIO (configuración)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_step_config (
    id              SERIAL PRIMARY KEY,
    service_type    VARCHAR(30)  NOT NULL,   -- wetWash, dryWash, ironing, externalService
    step_key        VARCHAR(30)  NOT NULL,   -- recepcion, lavado, secado, planchado, etc.
    step_label      VARCHAR(60)  NOT NULL,   -- Nombre legible
    position        INT          NOT NULL,   -- Orden del paso (1, 2, 3...)
    duration_min    INT          NOT NULL DEFAULT 0,  -- Tiempo en minutos (ver nota abajo)
    resource_key    VARCHAR(30)  NULL,       -- FK→resource_config

    UNIQUE (service_type, step_key)
);

-- NOTA sobre duration_min en service_step_config:
-- Este campo indica cuánto tarda ESE PASO para UNA prenda.
-- El cálculo de capacidad se ajusta automáticamente según processing_mode del recurso:
--
-- • Recurso 'batch' (ej: lavadora): Las prendas comparten ciclo.
--   Si hay 5 prendas y batch_capacity=8, caben en 1 ciclo.
--   Tiempo = ceil(5/8) * cycle_duration_min = 1 * 90 = 90 min (NO 5 × 90)
--
-- • Recurso 'individual' (ej: planchado): Cada prenda se procesa sola.
--   Si hay 5 prendas, tiempo = 5 * cycle_duration_min = 5 * 15 = 75 min

-- ============================================================
-- 4. TRACKING POR LÍNEA DE PEDIDO
-- ============================================================
CREATE TABLE IF NOT EXISTS order_line_steps (
    id              SERIAL PRIMARY KEY,
    order_line_id   INT          NOT NULL REFERENCES "OrderLine"(id) ON DELETE CASCADE,
    step_config_id  INT          NOT NULL REFERENCES service_step_config(id),
    status          VARCHAR(15)  NOT NULL DEFAULT 'pending',  -- pending, in_progress, done
    started_at      TIMESTAMPTZ  NULL,
    completed_at    TIMESTAMPTZ  NULL,
    completed_by    INT          NULL REFERENCES "User"(id),

    UNIQUE (order_line_id, step_config_id)
);

CREATE INDEX idx_order_line_steps_line ON order_line_steps(order_line_id);
CREATE INDEX idx_order_line_steps_status ON order_line_steps(status);

-- ============================================================
-- SEED DATA: Recursos
-- ============================================================
-- Lavadora húmeda: 2 unidades, procesa en lote, ~8 prendas/carga, 90 min/ciclo
-- Lavadora seco: 1 unidad, procesa en lote, ~6 prendas/carga, 50 min/ciclo
-- Planchado: 1 persona, prenda a prenda, ~15 min/prenda
-- Manual: 2 personas, prenda a prenda, ~5 min/prenda

INSERT INTO resource_config (resource_key, label, units, processing_mode, batch_capacity, cycle_duration_min) VALUES
    ('washer_wet',      'Lavadora húmeda',    2, 'batch',      8,  90),
    ('washer_dry',      'Lavadora en seco',   1, 'batch',      6,  50),
    ('ironing_manual',  'Planchado manual',   1, 'individual', 1,  15),
    ('manual',          'Trabajo manual',     2, 'individual', 1,   5)
ON CONFLICT (resource_key) DO NOTHING;

-- ============================================================
-- SEED DATA: Calendario semanal por defecto
-- ============================================================
-- Ajustar start_time/end_time y capacity_min según vuestro horario real.
-- capacity_min = minutos efectivos de trabajo del día (descontando descansos).

INSERT INTO work_schedule (day_of_week, is_working, start_time, end_time, capacity_min) VALUES
    (0, false, NULL,    NULL,    0),     -- Domingo: cerrado
    (1, true,  '09:00', '20:00', 540),  -- Lunes: ~9h efectivas
    (2, true,  '09:00', '20:00', 540),  -- Martes
    (3, true,  '09:00', '20:00', 540),  -- Miércoles
    (4, true,  '09:00', '20:00', 540),  -- Jueves
    (5, true,  '09:00', '20:00', 540),  -- Viernes
    (6, false, NULL,    NULL,    0)      -- Sábado: cerrado
ON CONFLICT (day_of_week) DO NOTHING;

-- ============================================================
-- SEED DATA: Festivos 2026 (España - ajustar según comunidad)
-- ============================================================
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

-- ============================================================
-- SEED DATA: Pasos por tipo de servicio
-- ============================================================

-- Lavado húmedo (wetWash)
INSERT INTO service_step_config (service_type, step_key, step_label, position, duration_min, resource_key) VALUES
    ('wetWash', 'recepcion',   'Recepción',           1,   3, 'manual'),
    ('wetWash', 'lavado',      'Lavado',               2,  70, 'washer_wet'),
    ('wetWash', 'secado',      'Secado',               3,  45, 'washer_wet'),
    ('wetWash', 'doblado',     'Doblado / Embolsado',  4,  10, 'manual')
ON CONFLICT (service_type, step_key) DO NOTHING;

-- Lavado en seco (dryWash)
INSERT INTO service_step_config (service_type, step_key, step_label, position, duration_min, resource_key) VALUES
    ('dryWash', 'recepcion',      'Recepción',          1,   5, 'manual'),
    ('dryWash', 'pretratamiento', 'Pre-tratamiento',    2,  10, 'manual'),
    ('dryWash', 'limpieza_seco',  'Limpieza en seco',   3,  45, 'washer_dry'),
    ('dryWash', 'planchado',      'Planchado',          4,  15, 'ironing_manual'),
    ('dryWash', 'embolsado',      'Embolsado',          5,   3, 'manual')
ON CONFLICT (service_type, step_key) DO NOTHING;

-- Solo planchado (ironing)
INSERT INTO service_step_config (service_type, step_key, step_label, position, duration_min, resource_key) VALUES
    ('ironing', 'recepcion',  'Recepción',  1,  3, 'manual'),
    ('ironing', 'planchado',  'Planchado',  2, 15, 'ironing_manual'),
    ('ironing', 'embolsado',  'Embolsado',  3,  3, 'manual')
ON CONFLICT (service_type, step_key) DO NOTHING;

-- Servicio externo (externalService)
INSERT INTO service_step_config (service_type, step_key, step_label, position, duration_min, resource_key) VALUES
    ('externalService', 'recepcion',          'Recepción',          1,  3, 'manual'),
    ('externalService', 'envio_externo',      'Envío externo',      2,  0, NULL),
    ('externalService', 'recepcion_externo',  'Recepción externo',  3,  0, NULL),
    ('externalService', 'embolsado',          'Embolsado',          4,  3, 'manual')
ON CONFLICT (service_type, step_key) DO NOTHING;

