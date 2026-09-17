-- 025_calibracion_carga_trabajo.sql
-- Calibración de la carga de trabajo por producto (Product.workload_weight)
-- y tope de carga diaria (AppSettings.daily_load_max).
--
-- Unidad: "camisas equivalentes" (camisa lavada y planchada = 1).
-- El tracking no registra tiempos reales (todos los pasos se marcan con
-- inicio = fin), así que los pesos no salen de cronometrar sino de una
-- escala razonada por itinerario y precio, revisada a mano y contrastada
-- con el hueco entre marcas consecutivas de "planchado" de la misma persona:
--   · Servicio externo (peletero, alfombras) ........ no computa
--   · Ropa de hogar por kg / hostelería, planchada a
--     mano (no hay calandra) ........................ kg 0,3 · servilleta 0,12
--                                                     mantel 0,5–1 · sábana 0,6
--   · Edredones, nórdicos, mantas (trabajo de máquina) precio / 12
--   · Solo plancha ................................. precio / 6
--   · Resto de prendas (lavado seco o mojado) ....... precio / 7, suavizado
--     a partir de 30 € (un vestido de novia = 8, no 16)
--
-- Con estos pesos, en los 254 días laborables de sept-2025 a sept-2026 la
-- carga por fecha de entrega fue: mediana 26, p90 49, p95 58, máximo 133
-- (15/04/2026, día de hostelería con 661 unidades). Pero ese histórico es lo
-- que se ha llegado a sacar, no lo que se puede asumir. Por mes y día
-- laborable en 2026, ya con la hostelería a mano (kg = 0,3): marzo 38,
-- abril 58, mayo 54, junio 49, julio 43, agosto 45. Marzo, julio y agosto
-- fueron cómodos; abril y mayo justos; junio, de agobio (con la hostelería
-- a 0,1 por kg los meses no se separaban). El tope diario se fija en 45,
-- el techo de los meses cómodos, y se ajusta desde Administración > Horario
-- laboral.
-- Con los pesos anteriores (todo a 1 y tope 8), 178 de 254 días salían llenos.

BEGIN;

-- Productos que no computan en la carga del día
UPDATE "Product" SET counts_for_load = FALSE, workload_weight = 0
WHERE id IN (
    10,                                   -- Spray desodorante (artículo)
    47, 106, 115, 117, 125, 132, 134, 137, -- servicio peletero
    70, 71, 103, 104                      -- alfombras m2 (servicio externo)
);

-- Pesos por producto
UPDATE "Product" p SET counts_for_load = TRUE, workload_weight = v.w
FROM (VALUES
    -- Hostelería y hogar por unidad. Sin calandra: todo se plancha a mano.
    -- El hueco entre marcas de "planchado" de la misma persona da ≈3 min/kg
    -- de ropa blanca y ≈4-5 min por mantel, con la camisa en ≈9 min.
    (110, 0.3), (186, 0.3),                              -- kg ropa blanca
    (150, 0.5), (173, 0.5),                              -- kg ropa de color
    (158, 0.12), (85, 0.12), (91, 0.12),                 -- servilletas, paños (≈1 min a mano)
    (76, 0.15), (77, 0.15), (78, 0.15),                  -- fundas almohada
    (81, 0.1), (82, 0.1), (83, 0.1), (84, 0.1), (90, 0.1), -- toallas, alfombrilla (sólo doblar)
    (72, 0.6), (73, 0.6), (74, 0.6), (75, 0.6),          -- sábanas
    (155, 0.5), (156, 0.75), (157, 1),                   -- mantel pequeño, mediano, grande
    (159, 0.3), (176, 0.3), (177, 0.5), (166, 1),        -- camino, funda silla, funda mesa, mantel mesa
    (37, 0.8), (79, 0.8), (80, 0.8), (101, 1.2),         -- fundas nórdicas, juego de sábanas
    (64, 0.3), (160, 0.5), (167, 0.5),                   -- cojines, estor
    -- Edredones, nórdicos, mantas y similares (máquina)
    (9, 2.5), (130, 2.5), (92, 2.5), (114, 2.5),
    (13, 2), (16, 2), (63, 2), (98, 2), (129, 2), (15, 2),
    (108, 1.5), (112, 1.5), (50, 1.5), (126, 0.5),
    -- Solo plancha
    (153, 3.5), (175, 3), (140, 2.5), (69, 2.5),
    (136, 2), (149, 2), (55, 2), (68, 2), (66, 2), (111, 2),
    (170, 1.5), (171, 1.5), (62, 1), (89, 1), (97, 1),
    -- Prendas: lavado seco o mojado
    (17, 8), (99, 7.5), (26, 6.5), (57, 6), (49, 6),
    (36, 5), (131, 5), (25, 5),
    (128, 4.5), (35, 4.5), (141, 4.5),
    (184, 4), (181, 4), (133, 4), (179, 4), (127, 4), (142, 4), (95, 4), (30, 4), (40, 4), (21, 4),
    (28, 4), (56, 4), (22, 4), (54, 4), (102, 4), (4, 4), (23, 4), (118, 4), (107, 4), (144, 4),
    (182, 3.5), (67, 3.5),
    (100, 3), (45, 3), (6, 3), (60, 3), (61, 3), (27, 3), (147, 3), (42, 3), (96, 3), (24, 3), (3, 3),
    (31, 3), (34, 3), (183, 3), (109, 3), (139, 3), (185, 3), (169, 3), (138, 3), (164, 3), (14, 3), (38, 3),
    (2, 2.5), (105, 2.5), (86, 2.5), (174, 2.5), (113, 2.5), (46, 2.5), (32, 2.5), (29, 2.5), (18, 2.5),
    (143, 2), (161, 2), (172, 2), (148, 2), (163, 2), (43, 2), (93, 2), (94, 2), (58, 2), (52, 2), (7, 2),
    (165, 2), (124, 2),
    (87, 1.5), (146, 1.5), (59, 1.5), (151, 1.5), (51, 1.5), (53, 1.5), (88, 1.5), (145, 1.5), (168, 1.5),
    (152, 1.5), (33, 1.5), (120, 1.5), (12, 1.5), (48, 1.5), (121, 1.5),
    (11, 1), (44, 1), (8, 1), (123, 1), (1, 1), (19, 1), (39, 1), (122, 1), (41, 1), (119, 1), (116, 1),
    (20, 1), (162, 1), (65, 1),
    (5, 0.5), (135, 0.5), (178, 0.5), (154, 0.5)
) AS v(id, w)
WHERE p.id = v.id;

-- Tope de carga diaria (camisas equivalentes) para el calendario del TPV.
-- La tabla está en el schema de Prisma desde hace tiempo pero en producción
-- nunca llegó a crearse (sólo la usaba la integración con Google).
CREATE TABLE IF NOT EXISTS "AppSettings" (
    id    SERIAL PRIMARY KEY,
    key   TEXT NOT NULL,
    value TEXT NOT NULL,
    CONSTRAINT "AppSettings_key_key" UNIQUE (key)
);
INSERT INTO "AppSettings" (key, value) VALUES ('daily_load_max', '45')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

COMMIT;

-- Comprobación: productos activos que se han quedado con el peso por defecto
-- SELECT id, name, "basePrice", workload_weight FROM "Product"
-- WHERE archived_at IS NULL AND counts_for_load AND workload_weight = 1 ORDER BY "basePrice" DESC;
