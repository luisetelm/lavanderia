-- 029_tope_carga_por_dia.sql
-- Tope de carga propio para un día concreto (excepciones del horario).
--
-- El histórico enseña que la víspera de un festivo se lleva toda la carga
-- (1 de abril de 2026: 75 frente a 45 de media; 30 de abril: 83) y el día
-- siguiente va vacío. Con una excepción "abierto, tope 30" en la víspera, la
-- fecha sugerida del TPV salta al día después del festivo para lo que no es
-- urgente. NULL = se usa el tope general (AppSettings.daily_load_max).

ALTER TABLE work_schedule_exceptions ADD COLUMN IF NOT EXISTS load_max DOUBLE PRECISION NULL;
