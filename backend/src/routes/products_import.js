// backend/src/routes/products_import.js
import fs from 'fs';
import pkg from 'papaparse';
const { parse } = pkg;
import crypto from 'crypto';
import path from 'path';

function randomSKU() {
    return 'SKU-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    // Espera que el CSV se envíe como texto en el body (puedes adaptar a multipart si quieres archivo real)
    fastify.post('/import', async (req, reply) => {
        const { csv } = req.body;
        if (!csv) return reply.status(400).send({ error: 'Falta campo csv con el contenido' });

        const results = parse(csv, {
            header: true,
            skipEmptyLines: true,
        });

        const created = [];
        const errors = [];

        for (const row of results.data) {
            try {
                // Ajusta nombres de columna según tu CSV
                const name = (row.name || row.nombre || '').trim();
                if (!name) throw new Error('Falta nombre');

                let sku = row.sku ? row.sku.trim() : '';
                if (!sku) {
                    sku = randomSKU();
                }

                const basePrice = parseFloat(row.basePrice ?? row.precio ?? '0');
                if (isNaN(basePrice)) throw new Error('Precio base inválido');

                // Categoría opcional: buscar o crear
                let category = null;
                if (row.category) {
                    const catName = row.category.trim();
                    category = await prisma.productCategory.upsert({
                        where: { name: catName },
                        update: {},
                        create: { name: catName },
                    });
                }

                // Crear producto (evita duplicados por SKU)
                const product = await prisma.product.upsert({
                    where: { sku },
                    update: {
                        name,
                        basePrice,
                        categoryId: category ? category.id : null,
                    },
                    create: {
                        name,
                        sku,
                        basePrice,
                        categoryId: category ? category.id : null,
                    },
                });

                created.push({ sku: product.sku, name: product.name });
            } catch (e) {
                errors.push({ row, error: e.message });
            }
        }

        return reply.send({ created, errors });
    });
}
