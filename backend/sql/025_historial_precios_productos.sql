-- 025_historial_precios_productos.sql
--
-- Historial de cambios de precio de los productos (ver docs/productos.md).
--
-- Una fila por cada precio que cambia: precio normal (basePrice) o tarifa de
-- gran cliente (bigClientPrice), con el valor anterior y el nuevo (IVA
-- incluido, como en el catálogo), quién lo cambió y desde dónde:
--   alta         alta del producto (old_price NULL)
--   edicion      formulario o edición rápida del catálogo
--   bloque       cambio de precios en bloque (note describe el cambio)
--   importacion  importación CSV
--
-- Lo escribe backend/src/utils/historialPrecios.js después de guardar el
-- precio. Si el backend se despliega antes que este SQL, los precios se siguen
-- guardando y el log avisa de que no se ha podido registrar el cambio.
--
-- No hay datos anteriores: el historial empieza cuando se ejecuta este fichero.
--
-- Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS product_price_history (
    id          SERIAL PRIMARY KEY,
    product_id  INTEGER          NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
    field       VARCHAR(20)      NOT NULL CHECK (field IN ('basePrice', 'bigClientPrice')),
    old_price   DOUBLE PRECISION,
    new_price   DOUBLE PRECISION NOT NULL,
    source      VARCHAR(20)      NOT NULL,
    note        VARCHAR(255),
    changed_by  INTEGER          REFERENCES "User"(id) ON DELETE SET NULL,
    changed_at  TIMESTAMPTZ(6)   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_price_history_product_idx
    ON product_price_history (product_id, changed_at);

COMMIT;

-- Comprobación:
-- SELECT h.changed_at, p.name, h.field, h.old_price, h.new_price, h.source, h.note
--   FROM product_price_history h JOIN "Product" p ON p.id = h.product_id
--  ORDER BY h.changed_at DESC LIMIT 20;
