-- 039: tiempos del taller. Cargas de máquina y tandas de trabajo.
--
-- Cada recurso dice qué tipo de tiempo ocupa (resource_kind):
--   persona → pretratar, planchar, coser. El tiempo de cada prenda se mide con
--             tandas: se pulsa «Empezar tanda» y cada prenda que se marca como
--             hecha cuenta desde la marca anterior (pausas aparte).
--   maquina → lavadora, secadora, limpieza en seco. Se cargan varias prendas
--             con un programa; el tiempo de máquina es el del programa y el de
--             ocupación, hasta que se pulsa «Sacar».
--   tendido → tendedero. Como una máquina, pero sin programa fijo y con
--             varias tandas a la vez («Tender» / «Recoger»).
-- Las prendas cargadas guardan su carga (load_id) y las marcadas en una tanda,
-- su tanda (session_id). started_at / completed_at del paso quedan con el
-- tiempo medido, así que la cronología de la ficha del pedido ya lo enseña.
--
-- El tendedero se crea con valores provisionales (20 prendas, 4 h): ajustarlos
-- en Recursos.
-- Deshacer: DROP TABLE de machine_load, work_session y resource_program, y
-- DROP COLUMN de load_id, session_id y resource_kind.

ALTER TABLE resource_config ADD COLUMN IF NOT EXISTS resource_kind VARCHAR(10) NOT NULL DEFAULT 'persona';
UPDATE resource_config SET resource_kind = 'maquina'
WHERE processing_mode = 'batch' AND resource_kind = 'persona';

CREATE TABLE IF NOT EXISTS resource_program (
    id            SERIAL PRIMARY KEY,
    resource_key  VARCHAR(30)  NOT NULL REFERENCES resource_config(resource_key) ON DELETE CASCADE ON UPDATE CASCADE,
    name          VARCHAR(60)  NOT NULL,
    duration_min  INT          NOT NULL,
    position      INT          NOT NULL DEFAULT 0,
    is_active     BOOLEAN      NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_resource_program_resource ON resource_program(resource_key);

CREATE TABLE IF NOT EXISTS machine_load (
    id            SERIAL PRIMARY KEY,
    resource_key  VARCHAR(30)  NOT NULL,
    unit_no       INT          NOT NULL DEFAULT 1,
    program_id    INT          NULL REFERENCES resource_program(id) ON DELETE SET NULL,
    program_name  VARCHAR(60)  NULL,
    duration_min  INT          NOT NULL,
    started_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ  NULL,
    started_by    INT          NULL,
    finished_by   INT          NULL
);
CREATE INDEX IF NOT EXISTS idx_machine_load_open ON machine_load(resource_key) WHERE finished_at IS NULL;

CREATE TABLE IF NOT EXISTS work_session (
    id            SERIAL PRIMARY KEY,
    step_key      VARCHAR(30)  NOT NULL,
    started_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_mark_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    paused_at     TIMESTAMPTZ  NULL,
    ended_at      TIMESTAMPTZ  NULL,
    started_by    INT          NULL
);
-- Una sola tanda abierta por fase
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_session_open ON work_session(step_key) WHERE ended_at IS NULL;

ALTER TABLE order_line_steps ADD COLUMN IF NOT EXISTS load_id    INT NULL REFERENCES machine_load(id) ON DELETE SET NULL;
ALTER TABLE order_line_steps ADD COLUMN IF NOT EXISTS session_id INT NULL REFERENCES work_session(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ols_load ON order_line_steps(load_id);

INSERT INTO resource_config (resource_key, label, units, processing_mode, batch_capacity, cycle_duration_min, capacity_unit, resource_kind)
VALUES ('tendedero', 'Tendedero', 1, 'batch', 20, 240, 'items', 'tendido')
ON CONFLICT (resource_key) DO NOTHING;
