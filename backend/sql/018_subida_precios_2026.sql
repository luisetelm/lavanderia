-- 018_subida_precios_2026.sql
--
-- Subida de tarifas de agosto de 2026. 22 productos.
-- Basada en la auditoría de precios sobre los 12 meses cerrados a 17/08/2026.
--
-- Criterio:
--   · Se sube donde el PVP quedaba por debajo de la referencia de mercado.
--   · NO se toca camisa (7,00 €) ni americana (14,00 €): ya están por encima
--     de la referencia de cadena y son las dos más sensibles.
--   · NO se toca KG. ROPA BLANCA por decisión de negocio.
--   · Se arrastran los productos hermanos para no comprimir la escalera de
--     precios ni dejar el pack de Semana Santa por debajo de la suma de sus
--     partes (era 45,00 € = 20 + 16 + 9; pasa a 47,50 € = 21 + 17 + 9,50).
--
-- Impacto estimado: +2.150 €/año sobre el volumen de los últimos 12 meses.
--
-- Ninguno de estos 22 productos tiene bigClientPrice > 0, así que no hay
-- tarifa B2B que sincronizar.
--
-- Idempotente: el WHERE exige el precio antiguo, de modo que una segunda
-- ejecución no hace nada. Si algún producto ya se tocó a mano, esa fila
-- simplemente no se actualiza (y lo verás en el recuento de filas).

BEGIN;

UPDATE "Product" AS p
SET "basePrice" = v.nuevo::float8,
    "updatedAt" = now()
FROM (VALUES
    -- ── Aprobados en la auditoría (9) ─────────────────────────────
    (  2, 17.0, 18.50),   -- TRAJE CABALLERO
    ( 16, 22.0, 24.00),   -- EDREDON 1.35/1.50CM
    ( 14, 18.0, 19.50),   -- ABRIGO
    (  9, 28.0, 31.00),   -- NORDICO PLUMAS
    ( 67, 22.0, 23.50),   -- ABRIGO LARGO
    ( 32, 16.0, 17.00),   -- CAPA SEMANA SANTA ADULTO
    ( 31, 20.0, 21.00),   -- TUNICA ADULTO
    ( 63, 22.0, 23.50),   -- MANTA 90-135CM
    ( 33,  9.0,  9.50),   -- CAPERUZ

    -- ── Coherencia de escalera y packs (10) ───────────────────────
    (131, 45.0, 47.50),   -- CONJUNTO TUNICA+CAPA+CAPERUZ  (= suma de partes)
    (  3, 20.0, 21.50),   -- TRAJE CABALLERO CON CHALECO   (mantiene +3,00)
    (105, 17.0, 18.50),   -- TRAJE SEÑORA 2 PIEZAS         (par del de caballero)
    ( 24, 20.0, 21.50),   -- TRAJE SEÑORA 3 PIEZAS
    ( 15, 20.0, 21.50),   -- EDREDON 90-105CM
    ( 13, 22.0, 24.50),   -- NORDICO PLUMAS 90-105
    ( 92, 28.0, 29.50),   -- MANTA GRANDE +135CM
    (129, 20.0, 21.50),   -- MANTA PEQUEÑA
    (141, 35.0, 36.00),   -- CAPA SEMANA SANTA ADULTO+ARREGLO
    (142, 32.0, 33.00),   -- TUNICA ADULTO+ARREGLO

    -- ── Misma lógica de mercado, volumen relevante (3) ────────────
    ( 38, 18.0, 19.50),   -- PLUMIFERO       (ref. cadena 24,00 €)
    ( 96, 20.0, 21.50),   -- PLUMIFERO LARGO
    ( 87, 11.0, 12.00)    -- CHAQUETA TRAJE  (media americana)
) AS v(id, viejo, nuevo)
WHERE p.id = v.id
  AND p."basePrice" = v.viejo::float8;

COMMIT;

-- Verificación
-- SELECT id, name, "basePrice", "updatedAt"
-- FROM "Product"
-- WHERE id IN (2,3,9,13,14,15,16,24,31,32,33,38,63,67,87,92,96,105,129,131,141,142)
-- ORDER BY id;
