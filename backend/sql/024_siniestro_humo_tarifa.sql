-- 024_siniestro_humo_tarifa.sql
--
-- KG. ROPA SINIESTRO HUMO (id 186, sql/021) pasa de 3,63 € a 8,00 €/kg (IVA incl.).
--
-- Con la subida de KG. ROPA BLANCA a 4,00 € al público (sql/023) quedaba más
-- barata que la ropa blanca normal, cuando exige prelavado, carga separada,
-- ciclo en vacío posterior y ozono. Se fija en el doble del precio al público
-- de ropa blanca. Sin tarifa de gran cliente: los acuerdos, con precio pactado.
--
-- Idempotente: exige el precio anterior.

BEGIN;

UPDATE "Product"
   SET "basePrice" = 8.0,
       "updatedAt" = now()
 WHERE id = 186
   AND name = 'KG. ROPA SINIESTRO HUMO'
   AND "basePrice" = 3.63;

COMMIT;

-- Comprobación:
-- SELECT id, name, "basePrice", "bigClientPrice" FROM "Product" WHERE id IN (110, 186);
