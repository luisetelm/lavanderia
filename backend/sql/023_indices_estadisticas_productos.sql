-- 023_indices_estadisticas_productos.sql
--
-- Índices para la ficha de producto (GET /api/products/:id/stats y /lines).
--
-- Prisma no crea índices para las claves ajenas en PostgreSQL, así que
-- "OrderLine" sólo tenía el de invoicedInId y "Order" ninguno por fecha:
-- cualquier consulta de las líneas de un producto, o de las líneas de un
-- pedido, recorría la tabla entera.
--
--   - OrderLine(productId): líneas de un producto (ficha, estadísticas).
--   - OrderLine(orderId):   líneas de un pedido (productos pedidos juntos, y
--                           en general toda carga de pedidos con sus líneas).
--   - Order(createdAt):     filtros por rango de fechas.
--
-- Idempotente.

BEGIN;

CREATE INDEX IF NOT EXISTS "idx_OrderLine_productId" ON "OrderLine" ("productId");
CREATE INDEX IF NOT EXISTS "idx_OrderLine_orderId"   ON "OrderLine" ("orderId");
CREATE INDEX IF NOT EXISTS "idx_Order_createdAt"     ON "Order" ("createdAt");

COMMIT;

-- Comprobación:
-- SELECT tablename, indexname FROM pg_indexes WHERE tablename IN ('OrderLine', 'Order');
