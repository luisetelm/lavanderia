// backend/src/routes/orders.js
//import nextOrderNum from '../utils/generateOrderNum.js';
import {isValidSpanishPhone} from '../utils/validatePhone.js';

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    fastify.post('/', async (req, reply) => {
        const prisma = fastify.prisma;

        console.log('Entrando a /api/orders, body:', req.body, 'query:', req.query);
        console.log('Modelos Prisma:', {
            order: !!prisma.order,
            user: !!prisma.user,
            product: !!prisma.product,
        });


        const {
            clientId,
            clientFirstName,
            clientLastName,
            clientEmail,
            clientPhone,
            lines,
            observaciones,
            fechaLimite: fechaLimiteRaw,
        } = req.body;

        // Validaciones básicas similares a las que ya tienes
        let client = null;
        if (clientId) {
            client = await prisma.user.findUnique({where: {id: Number(clientId)}});
            if (!client) return reply.status(400).send({error: 'clientId inválido'});
            if (client.role === 'customer' && !client.phone) {
                return reply.status(400).send({error: 'El cliente debe tener teléfono'});
            }
        } else {
            if (!clientFirstName || !clientLastName) {
                return reply.status(400).send({error: 'clientFirstName y clientLastName son obligatorios'});
            }
            if (!clientPhone || !isValidSpanishPhone(clientPhone)) {
                return reply.status(400).send({error: 'Teléfono válido obligatorio (ej: 600123456)'});
            }

            if (clientEmail) {
                client = await prisma.user.upsert({
                    where: {email: clientEmail},
                    update: {
                        firstName: clientFirstName,
                        lastName: clientLastName,
                        phone: clientPhone,
                        role: 'customer',
                    },
                    create: {
                        firstName: clientFirstName,
                        lastName: clientLastName,
                        email: clientEmail,
                        phone: clientPhone,
                        role: 'customer',
                        password: null,
                    },
                });
            } else {
                client = await prisma.user.findFirst({where: {phone: clientPhone}});
                if (!client) {
                    client = await prisma.user.create({
                        data: {
                            firstName: clientFirstName,
                            lastName: clientLastName,
                            phone: clientPhone,
                            role: 'customer',
                            password: null,
                        },
                    });
                }
            }
        }

        if (!lines || !Array.isArray(lines) || lines.length === 0) {
            return reply.status(400).send({error: 'Debe haber al menos una línea en el pedido'});
        }

        // Calcular totales y preparar líneas
        let total = 0;
        const lineCreates = [];

        for (const l of lines) {
            const product = await prisma.product.findUnique({where: {id: l.productId}});
            if (!product) return reply.status(400).send({error: `Producto inválido: ${l.productId}`});

            let unitPrice = product.basePrice;
            if (l.variantId) {
                const variant = await prisma.productVariant.findUnique({where: {id: l.variantId}});
                if (variant) unitPrice += variant.priceModifier;
            }

            const quantity = l.quantity || 1;
            const totalPrice = unitPrice * quantity;
            total += totalPrice;

            lineCreates.push({
                productId: l.productId,
                variantId: l.variantId || null,
                quantity,
                unitPrice,
                totalPrice,
                notes: l.notes || '',
            });
        }

        // Fecha límite: si viene, se parsea; si no, se propone (ej. dentro de una semana laboral)
        const defaultFechaLimite = () => {
            const d = new Date();
            d.setDate(d.getDate() + 7);
            // avanza hasta día laborable si cae en fin de semana
            while (d.getDay() === 0 || d.getDay() === 6) {
                d.setDate(d.getDate() + 1);
            }
            return d;
        };

        let fechaLimite = fechaLimiteRaw ? new Date(fechaLimiteRaw) : defaultFechaLimite();
        // opcional: rechazar pasado
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (fechaLimite < today) {
            return reply.status(400).send({error: 'La fecha límite no puede ser anterior a hoy.'});
        }

        // Generar orderNum (usa tu helper correctamente con fastify)
        const orderNum = await nextOrderNum(prisma);

        // Crear pedido en estado pendiente (sin pago)
        const order = await prisma.order.create({
            data: {
                orderNum,
                clientId: client.id,
                total,
                paid: false,
                paymentMethod: null,
                observaciones: observaciones || null,
                fechaLimite,
                lines: {create: lineCreates},
            },
            include: {
                lines: {
                    include: {product: true},
                },
                client: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        phone: true,
                    },
                },
            },
        });

        // Crear tarea automática si lo usas (como antes)
        await prisma.task.create({
            data: {
                name: `${order.orderNum} – ${client.firstName} ${client.lastName}`.trim(),
                orderId: order.id,
                state: 'pending',
                description: lines.map((l) => `Producto ${l.productId} x${l.quantity || 1}`).join('\n'),
            },
        });

        // Serializar como hacías
        const serialized = {
            ...order,
            lines: order.lines.map((l) => ({
                id: l.id,
                productId: l.productId,
                variantId: l.variantId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                totalPrice: l.totalPrice,
                notes: l.notes,
                productName: l.product?.name || '',
            })),
        };

        return reply.send(serialized);
    });

    fastify.patch('/:id', async (req, reply) => {
        const prisma = fastify.prisma;
        const orderId = Number(req.params.id);
        const {observaciones, fechaLimite: fechaLimiteRaw} = req.body;

        const data = {};
        if (observaciones !== undefined) data.observaciones = observaciones;
        if (fechaLimiteRaw !== undefined) {
            const fechaLimite = new Date(fechaLimiteRaw);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (fechaLimite < today) {
                return reply.status(400).send({error: 'La fecha límite no puede ser anterior a hoy.'});
            }
            data.fechaLimite = fechaLimite;
        }

        if (Object.keys(data).length === 0) {
            return reply.status(400).send({error: 'Nada para actualizar'});
        }

        const updated = await prisma.order.update({
            where: {id: orderId},
            data,
            include: {
                lines: {
                    include: {product: true},
                },
                client: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        phone: true,
                    },
                },
            },
        });

        return reply.send(updated);
    });

    fastify.post('/:id/pay', async (req, reply) => {
        const prisma = fastify.prisma;
        const orderId = Number(req.params.id);
        const {method, receivedAmount} = req.body; // method: 'cash' | 'card'

        try {
            const order = await prisma.order.findUnique({where: {id: orderId}});
            if (!order) return reply.status(404).send({error: 'Pedido no encontrado'});

            if (order.paid) {
                return reply.status(400).send({error: 'Pedido ya está pagado'});
            }

            if (method !== 'cash' && method !== 'card') {
                return reply.status(400).send({error: 'Método de pago inválido'});
            }

            const updateData = {
                paymentMethod: method,
                paid: true,
            };

            let change = 0;
            if (method === 'cash') {
                if (receivedAmount === undefined) {
                    return reply.status(400).send({error: 'Debe indicar cantidad recibida para efectivo'});
                }
                const received = parseFloat(receivedAmount);
                if (isNaN(received) || received < order.total) {
                    return reply.status(400).send({error: 'Cantidad recibida insuficiente'});
                }
                change = received - order.total;
            }

            const updated = await prisma.order.update({
                where: {id: orderId},
                data: updateData,
                include: {
                    lines: {include: {product: true}},
                    client: {
                        select: {id: true, firstName: true, lastName: true, email: true, phone: true},
                    },
                },
            });

            return reply.send({order: updated, change: method === 'cash' ? change : 0});
        } catch (err) {
            console.error('Error en /orders/:id/pay:', err);
            return reply
                .status(500)
                .send({error: 'Fallo interno al procesar el pago', details: err.message});
        }
    });

    fastify.get('/', async (req, reply) => {
        const prisma = fastify.prisma;
        const {fechaLimite_gte, fechaLimite_lte} = req.query;

        const where = {};

        if (fechaLimite_gte || fechaLimite_lte) {
            where.fechaLimite = {};
            if (fechaLimite_gte) where.fechaLimite.gte = new Date(fechaLimite_gte);
            if (fechaLimite_lte) where.fechaLimite.lte = new Date(fechaLimite_lte);
        }

        // Puedes ampliar filtros aquí si quieres
        try {
            const orders = await prisma.order.findMany({
                where,
                include: {
                    lines: {
                        include: {product: true},
                    },
                    client: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            phone: true,
                            email: true,
                        },
                    },
                },
                orderBy: {fechaLimite: 'asc'},
            });
            return reply.send(orders);
        } catch (err) {
            console.error('Error en GET /api/orders:', err);
            return reply.status(500).send({error: 'Error al obtener pedidos'});
        }
    });

    fastify.get('/:id', async (req, reply) => {
        const prisma = fastify.prisma;
        const orderId = Number(req.params.id);
        if (isNaN(orderId)) {
            return reply.status(400).send({error: 'ID de pedido inválido'});
        }

        try {
            const order = await prisma.order.findUnique({
                where: {id: orderId},
                include: {
                    lines: {
                        include: {
                            product: true,
                            // si hay variantes y quieres su detalle, añade:
                            // variant: true
                        },
                    },
                    client: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            phone: true,
                        },
                    },
                },
            });

            if (!order) {
                return reply.status(404).send({error: 'Pedido no encontrado'});
            }

            // Normalizar/cocinar la línea para que tenga todo lo que el frontend espera:
            const serializedLines = order.lines.map((l) => {
                // fallback name desde product si no viene explícito
                const productName = l.product?.name || `#${l.productId}`;
                // basePrice + posible modificador de variante
                let unitPrice = l.unitPrice;
                // Si no se guardó en unitPrice y quieres reconstruir:
                // let base = l.product?.basePrice || 0;
                // if (l.variantId && l.variant) base += l.variant.priceModifier;
                // unitPrice = unitPrice || base;

                return {
                    id: l.id,
                    productId: l.productId,
                    variantId: l.variantId || null,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    totalPrice: l.totalPrice,
                    notes: l.notes || '',
                    productName,
                    // incluir info útil de producto si quieres (por ejemplo para imágenes o detalles):
                    product: {
                        id: l.product?.id,
                        name: l.product?.name,
                        basePrice: l.product?.basePrice,
                        // agrega aquí más campos si los usas en UI, como SKU, descripción, etc.
                    },
                    // si tienes variantes y las necesitas:
                    // variant: l.variant ? { id: l.variant.id, name: l.variant.name, priceModifier: l.variant.priceModifier } : null,
                };
            });

            const serialized = {
                ...order,
                lines: serializedLines,
            };

            return reply.send(serialized);
        } catch (err) {
            console.error('Error en GET /orders/:id:', err);
            return reply.status(500).send({error: 'Error al obtener el pedido'});
        }
    });

    fastify.setErrorHandler((error, request, reply) => {
        console.error('Error no capturado:', error);
        reply.status(500).send({error: 'Error interno'});
    });

}

export async function nextOrderNum(prisma) {

    const year = new Date().getFullYear();

    const lastOrder = await prisma.order.findFirst({
        where: {
            orderNum: {
                startsWith: `TPV/${year}/`,
            },
        }, orderBy: {
            orderNum: 'desc',
        },
    });

    let nextNumber = 1;

    if (lastOrder) {
        const lastNum = parseInt(lastOrder.orderNum.split('/')[2]);
        nextNumber = lastNum + 1;
    }

    return `TPV/${year}/${String(nextNumber).padStart(4, '0')}`;
}
