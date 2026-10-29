-- 037: un producto puede ir por más de un itinerario.
--
-- "Product".itinerary_id sigue siendo el itinerario por defecto (el que el TPV
-- deja elegido). product_itinerary guarda los alternativos: según el tejido o
-- las manchas, un vestido puede ir en agua (por defecto) o en seco. En el TPV
-- se elige por prenda y queda en "OrderLine".itinerary_id (sql/036); después
-- se puede cambiar desde el pedido.
-- Deshacer: DROP TABLE product_itinerary;

CREATE TABLE IF NOT EXISTS product_itinerary (
    product_id   INT NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
    itinerary_id INT NOT NULL REFERENCES itinerary(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, itinerary_id)
);
CREATE INDEX IF NOT EXISTS idx_product_itinerary_itinerary ON product_itinerary(itinerary_id);
