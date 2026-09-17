-- 026_suplemento_urgencia.sql
-- Suplemento por adelantar la entrega respecto a la fecha sugerida del
-- calendario (primer día abierto, a 2+ días vista, que no esté lleno).
--
-- Se cobra como una línea más del pedido con este producto: cantidad 1 e
-- importe = % sobre las líneas que computan en la carga del día (lo que va a
-- servicio externo no se puede acelerar). Así sale en el ticket y en la
-- factura sin tocar el modelo de precios, y administración puede quitarlo.
--
-- El producto nace archivado: no aparece en el catálogo del TPV ni se puede
-- añadir a mano, pero conserva ficha y pedidos. No computa en la carga ni
-- imprime etiquetas de lavado. El importe unitario lo pone el backend en
-- cada pedido (basePrice 0).

BEGIN;

INSERT INTO "Product" (name, sku, type, "basePrice", description, "createdAt", "updatedAt",
                       counts_for_load, workload_weight, print_wash_label, label_count, archived_at)
VALUES ('Suplemento urgencia', 'SUPL-URGENCIA', 'service', 0,
        'Recargo automático por entregar antes de la fecha sugerida. El importe lo calcula el TPV en cada pedido.',
        now(), now(), FALSE, 0, FALSE, 1, now())
ON CONFLICT (sku) DO NOTHING;

-- Porcentaje del suplemento (0 desactiva el recargo). Se edita en Horario laboral.
INSERT INTO "AppSettings" (key, value) VALUES ('urgency_surcharge_pct', '25')
ON CONFLICT (key) DO NOTHING;

COMMIT;
