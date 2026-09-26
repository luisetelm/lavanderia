-- 023_ropa_blanca_tarifas_2026.sql
--
-- Nuevas tarifas de KG. ROPA BLANCA (id 110), septiembre de 2026.
--
--   Público:        4,00 €/kg (IVA incl.). Antes 1,573 €. Por debajo del
--                   equivalente por pieza (sábana ~5,70 €/kg, toalla ~4,20 €/kg)
--                   y de un servicio por kilo a domicilio (6,5-7 €/kg sin planchar).
--   Gran cliente:   1,815 €/kg = 1,50 € + IVA.
--   Pactado:        1,573 €/kg a los cinco apartamentos que ya tenían esa tarifa
--                   (precios pactados, sql/022).
--
-- Product.bigClientPrice pasa de numeric(12,2) a numeric(12,3): con dos
-- decimales 1,815 se guardaba redondeado a 1,82. basePrice ya es double.
--
-- Idempotente: la subida exige el precio antiguo y los pactados no se
-- duplican si ya existe un acuerdo del cliente para el producto.

BEGIN;

ALTER TABLE "Product" ALTER COLUMN "bigClientPrice" TYPE NUMERIC(12, 3);

UPDATE "Product"
   SET "basePrice" = 4.0,
       "bigClientPrice" = 1.815,
       "updatedAt" = now()
 WHERE id = 110
   AND "basePrice" = 1.573;

INSERT INTO client_product_price (client_id, product_id, price, valid_from, note)
SELECT u.id, 110, 1.573, CURRENT_DATE, 'Tarifa anterior mantenida tras la subida de septiembre de 2026'
  FROM "User" u
 WHERE u.id IN (9804, 11132, 11136, 11568, 11798)  -- Isabel Roa, Montse La Estación, María Dolores Villaoslada, Ángeles Expósito, Julio Miguel Sánchez
   AND NOT EXISTS (
       SELECT 1 FROM client_product_price c
        WHERE c.client_id = u.id AND c.product_id = 110
   );

COMMIT;

-- Comprobación:
-- SELECT id, name, "basePrice", "bigClientPrice" FROM "Product" WHERE id = 110;
-- SELECT c.client_id, u."firstName", c.price, c.valid_from, c.valid_to
--   FROM client_product_price c JOIN "User" u ON u.id = c.client_id
--  WHERE c.product_id = 110 ORDER BY u."firstName";
