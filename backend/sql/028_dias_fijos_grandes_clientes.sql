-- 028_dias_fijos_grandes_clientes.sql
-- Días fijos de recogida y entrega de los grandes clientes (hoteles,
-- restaurantes) y su carga habitual por entrega, en camisas equivalentes.
--
-- Su pedido no existe hasta que se recoge (el lunes para entregar el
-- miércoles), pero el calendario del TPV ya debe contar esa carga para no
-- llenar el miércoles de particulares. Cada día de entrega del cliente el
-- calendario reserva `expected_load`, y la reserva se va consumiendo con sus
-- pedidos reales de ese día:
--   carga del día = pedidos reales + Σ máx(0, expected_load − carga real del cliente)
-- Los días de recogida son informativos (ficha del cliente).
-- Días: 0 = domingo ... 6 = sábado, como getDay().

BEGIN;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS pickup_days   INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS delivery_days INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS expected_load DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Valores iniciales sacados del histórico (entregas de 15/06/2026 a 16/09/2026,
-- pesos de sql/025): días con entregas habituales y mediana de carga por
-- entrega. Revisar en la ficha de cada cliente (Usuarios > cliente > Editar).
UPDATE "User" u SET pickup_days = v.rec, delivery_days = v.ent, expected_load = v.carga
FROM (VALUES
    (11009, '{1,2,3,4,5}'::int[], '{1,5}'::int[], 4.2),   -- Gestiones y Apartamentos Úbeda SL: entrega L y V
    (7,     '{1,2,3,5}'::int[],   '{1,5}'::int[], 2.1),   -- Apartamento Don Juan SC: entrega L y V
    (11136, '{1}'::int[],         '{4}'::int[],   8.1),   -- Tatusol SL: recoge L, entrega J
    (9804,  '{2}'::int[],         '{4}'::int[],   7.5),   -- Gabriel Ángel Carvajal García: recoge M, entrega J
    (11132, '{2}'::int[],         '{4}'::int[],   5.7),   -- Cantina la Estación SL: recoge M, entrega J
    (11515, '{2}'::int[],         '{3}'::int[],   21.9),  -- Grupo Virentia SL: recoge M, entrega X
    (11568, '{2}'::int[],         '{4}'::int[],   6.0),   -- (cliente 11568): recoge M, entrega J
    (11828, '{2}'::int[],         '{2,4}'::int[], 3.9)    -- (cliente 11828): entrega M y J
) AS v(id, rec, ent, carga)
WHERE u.id = v.id AND u.isbigclient;

COMMIT;
