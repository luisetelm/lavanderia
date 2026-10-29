-- 038: alias del cliente.
--
-- En la tienda llaman a muchos clientes por un alias, no por su nombre. Se
-- guarda en la ficha, se puede buscar (TPV, pedidos, vista Taller) y sale en
-- las tarjetas del taller: la ropa blanca no lleva etiqueta y sólo se reconoce
-- por el cliente.
-- Deshacer: ALTER TABLE "User" DROP COLUMN alias;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS alias VARCHAR(60);
