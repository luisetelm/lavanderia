-- 021_producto_kg_siniestro_humo.sql
--
-- Alta de KG. ROPA SINIESTRO HUMO: ropa de cama y toallas afectadas por humo
-- u hollín (incendios). Se cobra por kg, pero no al precio de KG. ROPA BLANCA:
-- necesita prelavado desengrasante, varios ciclos, carga separada (el hollín
-- mancha la ropa de otros clientes), ciclo en vacío posterior y ozono.
--
-- Precio: 3,00 € + IVA = 3,63 €/kg (basePrice va con IVA incluido). Doble de
-- la nueva tarifa de ropa blanca (1,50 € + IVA). bigClientPrice = 0: los
-- grandes clientes pagan lo mismo, no es servicio recurrente.
--
-- Mismo flujo que KG. ROPA BLANCA:
--   itinerary_id = 1 (Lavado mojado: Pre-tratamiento > Lavado > Secado > Planchado)
--   print_wash_label = false (lencería a granel, sin etiqueta por pieza)
--   serviceOptions: lavado en agua + plancha
-- A diferencia de la ropa blanca, SÍ computa en la carga de trabajo del día
-- (counts_for_load = true, workload_weight = 1 por kg): ocupa máquina en
-- exclusiva y no puede mezclarse con otras cargas.
--
-- Recepción: pesar, contar piezas y fotografiar en la línea del pedido;
-- presupuesto firmado sin garantía de resultado.
--
-- Idempotente: el WHERE NOT EXISTS evita duplicar si ya se ejecutó.

BEGIN;

INSERT INTO "Product" (
    name, sku, type, "basePrice", "bigClientPrice", weight, description,
    itinerary_id, label_count, print_wash_label, counts_for_load, workload_weight,
    "serviceOptions", "createdAt", "updatedAt"
)
SELECT
    'KG. ROPA SINIESTRO HUMO',
    (SELECT string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', (floor(random() * 36) + 1)::int, 1), '')
       FROM generate_series(1, 8)),
    'service', 3.63, 0, 1.00,
    'ROPA DE CAMA Y TOALLAS CON HUMO/HOLLIN. PRELAVADO, CARGA SEPARADA Y OZONO. SIN GARANTIA DE RESULTADO',
    1, 1, false, true, 1,
    '{"dryWash": false, "ironing": true, "wetWash": true, "externalService": false}'::jsonb,
    now(), now()
WHERE NOT EXISTS (
    SELECT 1 FROM "Product" WHERE name = 'KG. ROPA SINIESTRO HUMO'
);

COMMIT;

-- Comprobación:
-- SELECT id, name, sku, "basePrice", itinerary_id, print_wash_label, counts_for_load
--   FROM "Product" WHERE name = 'KG. ROPA SINIESTRO HUMO';
