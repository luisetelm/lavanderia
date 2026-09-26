-- 015_product_print_wash_label.sql
-- Permite marcar productos que NO generan etiquetas de lavado (p. ej. KG ropa blanca).

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS print_wash_label BOOLEAN NOT NULL DEFAULT TRUE;

