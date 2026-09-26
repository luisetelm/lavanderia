-- Revertido: no se usan columnas dedicadas para los timestamps de estado.
-- La info de "listo" se deriva del tracking y la de "recogido" de updatedAt.
ALTER TABLE "Order" DROP COLUMN IF EXISTS "readyAt";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "collectedAt";


