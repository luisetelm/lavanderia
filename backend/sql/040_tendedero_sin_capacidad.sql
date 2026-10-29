-- 040: el tendedero no tiene capacidad en prendas (no ocupa lo mismo una
-- camiseta que unas toallas). Capacidad 0 = sin límite: se tiende lo que
-- quepa y el tiempo de secado no depende de cuánto se tienda.
-- Sólo si sigue con el valor provisional de sql/039.
UPDATE resource_config SET batch_capacity = 0
WHERE resource_key = 'tendedero' AND batch_capacity = 20;
