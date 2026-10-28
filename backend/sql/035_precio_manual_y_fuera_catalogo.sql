-- 035: precio ajustado en una prenda y prendas fuera de catálogo (TPV).
--
-- 1) Cualquiera que pueda picar pedidos puede cambiar el precio de una prenda
--    (un traje muy sucio) con un motivo. La línea guarda el precio de tarifa que
--    tenía (price_original) y el motivo (price_note); el precio que vale sigue
--    siendo unitPrice.
-- 2) Una prenda que no está en el catálogo se pica con nombre y precio libres
--    sobre uno de tres productos genéricos, según el servicio, para que el
--    taller tenga sus pasos. La línea guarda el nombre (custom_name), que es el
--    que sale en tickets, etiquetas y facturas, y su carga (workload_weight, en
--    camisas equivalentes por unidad: precio / 7, o / 6 si es sólo plancha, la
--    regla de la calibración de sql/025).
--
-- Los genéricos van archivados, como el suplemento de urgencia (sql/027): no
-- salen en la rejilla del catálogo; el TPV los usa desde «Prenda fuera de catálogo».
-- Pasos de taller: los de un traje (seco), una camisa (lavado) y una americana
-- sólo plancha (ids de producto 2, 1 y 62, los de sql/025).
-- Deshacer: borrar las columnas y los productos FUERA-% (si no tienen pedidos).

ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS custom_name     VARCHAR(120);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS price_original  DOUBLE PRECISION;
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS price_note      VARCHAR(200);
ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS workload_weight DOUBLE PRECISION;

INSERT INTO "Product" (name, sku, type, "basePrice", description, "createdAt", "updatedAt",
                       itinerary_id, counts_for_load, workload_weight, print_wash_label, label_count, archived_at)
VALUES
    ('Fuera de catálogo · limpieza en seco', 'FUERA-SECO', 'service', 0,
     'Prenda que no está en el catálogo: nombre y precio se ponen en el TPV.',
     now(), now(), (SELECT itinerary_id FROM "Product" WHERE id = 2), TRUE, 1, TRUE, 1, now()),
    ('Fuera de catálogo · lavado', 'FUERA-LAVADO', 'service', 0,
     'Prenda que no está en el catálogo: nombre y precio se ponen en el TPV.',
     now(), now(), (SELECT itinerary_id FROM "Product" WHERE id = 1), TRUE, 1, TRUE, 1, now()),
    ('Fuera de catálogo · sólo plancha', 'FUERA-PLANCHA', 'service', 0,
     'Prenda que no está en el catálogo: nombre y precio se ponen en el TPV.',
     now(), now(), (SELECT itinerary_id FROM "Product" WHERE id = 62), TRUE, 1, TRUE, 1, now())
ON CONFLICT (sku) DO NOTHING;
