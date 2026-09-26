-- 019_producto_maleta.sql
--
-- Alta de MALETA / BOLSA DE VIAJE como producto de catálogo.
--
-- Hasta ahora se cobraba fuera de tarifa porque no existía la línea. El POS
-- sólo permite líneas con productId (OrderLine.unitPrice se copia siempre de
-- Product.basePrice), así que sin producto no hay forma de facturarla ni de
-- que aparezca en los informes de ingresos.
--
-- Precio: 35,00 €. Por encima de NORDICO PLUMAS (31,00 €) porque es
-- manipulado individual: no entra en carga normal (estructura rígida, ruedas,
-- asa telescópica), se lava a mano y el secado ocupa sitio 24-48 h.
--
-- workloadWeight = 4: es la pieza que más ocupa del catálogo (traje = 3).
-- printWashLabel = true: necesita etiqueta identificativa como cualquier prenda.
-- itineraryId = NULL: sin itinerario, va por el flujo estándar.
--
-- Idempotente: el WHERE NOT EXISTS evita duplicar si ya se ejecutó.

BEGIN;

INSERT INTO "Product" (
    name, type, "basePrice", "bigClientPrice", weight,
    "labelCount", "print_wash_label", "counts_for_load", "workload_weight",
    "serviceOptions", "createdAt", "updatedAt"
)
SELECT
    'MALETA / BOLSA DE VIAJE', 'service', 35.0, 0, 0,
    1, true, true, 4,
    '{"dryWash": false, "ironing": false, "wetWash": true, "externalService": false}'::jsonb,
    now(), now()
WHERE NOT EXISTS (
    SELECT 1 FROM "Product" WHERE name = 'MALETA / BOLSA DE VIAJE'
);

COMMIT;

-- Comprobación:
-- SELECT id, name, "basePrice", "workload_weight"
--   FROM "Product" WHERE name = 'MALETA / BOLSA DE VIAJE';
