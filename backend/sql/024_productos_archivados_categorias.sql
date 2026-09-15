-- 024_productos_archivados_categorias.sql
--
-- Archivar productos y categorías de producto (ver docs/productos.md).
--
-- "Product".archived_at: cuándo se archivó; NULL = activo. Un producto
-- archivado deja de salir en el TPV, en los ajustes de pedidos y al pactar
-- precios, pero conserva su ficha, sus pedidos y sus estadísticas. Los
-- productos no se borran nunca: las líneas de pedido los referencian.
--
-- "ProductCategory".name único: las categorías se buscan por nombre (la
-- importación CSV hace upsert por nombre y la API rechaza duplicados).
-- Antes de ejecutar, comprobar que no hay nombres repetidos:
--   SELECT name, count(*) FROM "ProductCategory" GROUP BY name HAVING count(*) > 1;
--
-- IMPORTANTE: ejecutar ANTES de desplegar el backend. Prisma lee archived_at
-- en todas las consultas de productos y sin la columna el TPV no carga.
--
-- Idempotente.

BEGIN;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ(6);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductCategory_name_key" ON "ProductCategory" (name);

COMMIT;

-- Comprobación:
-- SELECT id, name, archived_at FROM "Product" WHERE archived_at IS NOT NULL;
