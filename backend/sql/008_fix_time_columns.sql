-- ============================================================
-- 008: Convertir columnas TIME a VARCHAR(5) en work_schedule
-- y work_schedule_exceptions para compatibilidad con Prisma
-- Idempotente: solo convierte si el tipo actual es TIME
-- ============================================================

DO $$
BEGIN
    -- work_schedule.start_time
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'work_schedule' AND column_name = 'start_time'
          AND data_type IN ('time without time zone', 'time with time zone')
    ) THEN
        ALTER TABLE work_schedule ALTER COLUMN start_time TYPE VARCHAR(5) USING TO_CHAR(start_time, 'HH24:MI');
    END IF;

    -- work_schedule.end_time
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'work_schedule' AND column_name = 'end_time'
          AND data_type IN ('time without time zone', 'time with time zone')
    ) THEN
        ALTER TABLE work_schedule ALTER COLUMN end_time TYPE VARCHAR(5) USING TO_CHAR(end_time, 'HH24:MI');
    END IF;

    -- work_schedule_exceptions.start_time
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'work_schedule_exceptions' AND column_name = 'start_time'
          AND data_type IN ('time without time zone', 'time with time zone')
    ) THEN
        ALTER TABLE work_schedule_exceptions ALTER COLUMN start_time TYPE VARCHAR(5) USING TO_CHAR(start_time, 'HH24:MI');
    END IF;

    -- work_schedule_exceptions.end_time
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'work_schedule_exceptions' AND column_name = 'end_time'
          AND data_type IN ('time without time zone', 'time with time zone')
    ) THEN
        ALTER TABLE work_schedule_exceptions ALTER COLUMN end_time TYPE VARCHAR(5) USING TO_CHAR(end_time, 'HH24:MI');
    END IF;
END $$;


