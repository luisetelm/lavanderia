-- 036: itinerario guardado en cada prenda y registro de etapas repetidas.
--
-- 1) La prenda del pedido guarda su itinerario (itinerary_id). Hasta ahora salía
--    siempre del producto; ahora se puede cambiar después del mostrador si se
--    eligió mal (un vestido que va en seco y no en agua). Las etapas ya hechas
--    se conservan y sólo se rehacen las que faltan.
--    Las prendas existentes toman el itinerario de sus pasos.
-- 2) Repetir una etapa (el lavado no quedó bien) devuelve la prenda a esa etapa.
--    Cada pasada que se deshace por repetición queda en order_line_step_repeat
--    con sus tiempos, para saber cuánto se repite y cuánto cuesta.
--    is_cause marca la etapa que no quedó bien; las posteriores que hubo que
--    rehacer por arrastre van con is_cause = false.
-- Deshacer: DROP TABLE order_line_step_repeat; ALTER TABLE "OrderLine" DROP COLUMN itinerary_id;

ALTER TABLE "OrderLine" ADD COLUMN IF NOT EXISTS itinerary_id INT NULL REFERENCES itinerary(id);
CREATE INDEX IF NOT EXISTS idx_orderline_itinerary ON "OrderLine"(itinerary_id);

UPDATE "OrderLine" l
SET itinerary_id = (
    SELECT s.itinerary_id
    FROM order_line_steps ols
    JOIN itinerary_step s ON s.id = ols.itinerary_step_id
    WHERE ols.order_line_id = l.id
    ORDER BY ols.id
    LIMIT 1
)
WHERE l.itinerary_id IS NULL
  AND EXISTS (SELECT 1 FROM order_line_steps ols
              WHERE ols.order_line_id = l.id AND ols.itinerary_step_id IS NOT NULL);

CREATE TABLE IF NOT EXISTS order_line_step_repeat (
    id                 SERIAL PRIMARY KEY,
    order_line_step_id INT          NOT NULL REFERENCES order_line_steps(id) ON DELETE CASCADE,
    started_at         TIMESTAMPTZ  NULL,
    completed_at       TIMESTAMPTZ  NULL,
    completed_by       INT          NULL,
    repeated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    repeated_by        INT          NULL,
    is_cause           BOOLEAN      NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_olsr_step ON order_line_step_repeat(order_line_step_id);
