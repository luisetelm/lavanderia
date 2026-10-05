-- 031_productos_web.sql
-- Precios de la web pública sacados del catálogo (ver docs/precios-web.md).
--
-- "Product".web_section: en qué sección de tinteyburbuja.com se publica el
-- producto: 'lavado' (lavado y planchado), 'tintoreria' o 'hosteleria'.
-- NULL = no sale en la web. Sólo se publica el precio al público (basePrice);
-- la tarifa de gran cliente y los precios pactados no salen nunca.
-- "Product".web_name: nombre que ve el público (el del catálogo va en
-- mayúsculas y con abreviaturas: "EDREDON 1.35/1.50CM"). NULL = se usa el
-- del catálogo pasado a frase.
-- "Product".web_order: orden dentro de su sección.
--
-- Idempotente.

BEGIN;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS web_section TEXT NULL;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS web_name    TEXT NULL;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS web_order   INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS product_web_section_check;
ALTER TABLE "Product" ADD CONSTRAINT product_web_section_check
    CHECK (web_section IS NULL OR web_section IN ('lavado', 'tintoreria', 'hosteleria'));

CREATE INDEX IF NOT EXISTS idx_product_web_section ON "Product" (web_section, web_order) WHERE web_section IS NOT NULL;

COMMIT;

-- Comprobación:
-- SELECT id, name, web_section, web_name, web_order, "basePrice" FROM "Product" WHERE web_section IS NOT NULL ORDER BY web_section, web_order, name;
