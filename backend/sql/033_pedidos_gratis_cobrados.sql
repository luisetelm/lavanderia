-- 033: los pedidos a 0 € (descuento del 100 %, pedidos internos) se consideran
-- cobrados. Desde este cambio nacen con paid = true y paymentMethod = 'none'
-- (POST /api/orders); este script iguala los anteriores para que dejen de
-- aparecer como "pendiente de cobro" en la ficha del cliente y en el portal.
-- Los cancelados no se tocan (su total es 0 porque se anularon, no por gratis).
-- Deshacer: UPDATE "Order" SET paid = false, "paymentMethod" = NULL
--           WHERE "paymentMethod" = 'none' AND total = 0;
UPDATE "Order"
SET paid = true, "paymentMethod" = 'none'
WHERE total = 0 AND paid = false AND status <> 'cancelled';
