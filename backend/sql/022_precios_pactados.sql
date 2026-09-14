-- 022_precios_pactados.sql
--
-- Precios pactados por cliente y producto.
--
-- Hasta ahora sólo había dos niveles de precio (Product.basePrice y
-- Product.bigClientPrice para clientes marcados isbigclient) más un descuento
-- en porcentaje por cliente que se aplica a todo lo que compra. Con eso no se
-- pueden reflejar acuerdos distintos con cada cliente: p. ej. subir KG. ROPA
-- BLANCA a 1,50 € + IVA manteniendo 1,573 € a los apartamentos que ya lo tenían.
--
-- Regla de precio (backend/src/utils/precioLinea.js):
--   1. precio pactado vigente del cliente para el producto;
--   2. si no hay, bigClientPrice si el cliente es gran cliente y el producto lo tiene;
--   3. si no, basePrice.
-- El descuento en porcentaje del cliente NO se aplica sobre un precio pactado.
--
-- price: con IVA incluido, igual que basePrice.
-- valid_from / valid_to: vigencia con ambos días incluidos; valid_to NULL =
-- indefinido. El solape entre acuerdos del mismo cliente y producto se impide
-- en la API (routes/clientPrices.js), que además cierra el anterior el día
-- antes cuando se pacta un precio nuevo a partir de una fecha.
--
-- Las líneas de pedido ya guardan su unitPrice, así que cambiar o finalizar un
-- acuerdo no altera pedidos ni facturas anteriores.
--
-- Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS client_product_price (
    id          SERIAL PRIMARY KEY,
    client_id   INTEGER          NOT NULL REFERENCES "User"(id)    ON DELETE CASCADE,
    product_id  INTEGER          NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
    price       DOUBLE PRECISION NOT NULL CHECK (price >= 0),
    valid_from  DATE             NOT NULL DEFAULT CURRENT_DATE,
    valid_to    DATE,
    note        VARCHAR(255),
    created_by  INTEGER          REFERENCES "User"(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ(6)   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ(6)   NOT NULL DEFAULT now(),
    CONSTRAINT client_product_price_dates_chk CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS client_product_price_client_product_idx
    ON client_product_price (client_id, product_id);

COMMIT;

-- Comprobación:
-- SELECT c.id, u."firstName", p.name, c.price, c.valid_from, c.valid_to
--   FROM client_product_price c
--   JOIN "User" u ON u.id = c.client_id
--   JOIN "Product" p ON p.id = c.product_id
--  ORDER BY u."firstName", p.name, c.valid_from;
