import { generateUniqueSku } from '../utils/generateSku.js';

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    fastify.get('/', async (req, reply) => {
        const products = await prisma.product.findMany({
            include: { variants: true, category: true },
        });
        return products;
    });

    fastify.get('/:id', async (req, reply) => {
        const { id } = req.params;
        const product = await prisma.product.findUnique({
            where: { id: Number(id) },
            include: { variants: true, category: true },
        });
        if (!product) return reply.status(404).send({ error: 'Producto no encontrado' });
        return product;
    });

    fastify.post('/', async (req, reply) => {
        let { name, sku, basePrice, categoryId, description, type, weight, bigClientPrice, serviceOptions } = req.body;
        if (!name || basePrice == null) return reply.status(400).send({ error: 'Name and basePrice required' });

        if (!sku || sku.trim() === '') {
            sku = await generateUniqueSku(prisma);
        } else {
            // opcional: validar que no exista ya
            const exists = await prisma.product.findUnique({ where: { sku } });
            if (exists) return reply.status(400).send({ error: 'SKU ya existe' });
        }

        const product = await prisma.product.create({
            data: {
                name,
                sku,
                basePrice: parseFloat(basePrice),
                categoryId: categoryId || null,
                description,
                type: type || 'service',
                weight: weight != null ? parseFloat(weight) : 0,
                bigClientPrice: bigClientPrice != null ? parseFloat(bigClientPrice) : 0,
                serviceOptions: serviceOptions || {
                    dryWash: false,
                    wetWash: false,
                    ironing: false,
                    externalService: false
                }
            },
        });
        return reply.status(201).send(product);
    });

    fastify.put('/:id', async (req, reply) => {
        const { id } = req.params;
        const { name, sku, basePrice, categoryId, description, type, weight, bigClientPrice, serviceOptions } = req.body;
        try {
            const data = {};
            if (name !== undefined) data.name = name;
            if (sku !== undefined) data.sku = sku;
            if (basePrice !== undefined) data.basePrice = parseFloat(basePrice);
            if (categoryId !== undefined) data.categoryId = categoryId;
            if (description !== undefined) data.description = description;
            if (type !== undefined) data.type = type;
            if (weight !== undefined) data.weight = parseFloat(weight);
            if (bigClientPrice !== undefined) data.bigClientPrice = parseFloat(bigClientPrice);
            if (serviceOptions !== undefined) data.serviceOptions = serviceOptions;

            const product = await prisma.product.update({
                where: { id: Number(id) },
                data,
            });
            return product;
        } catch (e) {
            return reply.status(404).send({ error: 'Producto no encontrado' });
        }
    });
}
