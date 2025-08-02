// backend/src/routes/orders.js
//import nextOrderNum from '../utils/generateOrderNum.js';
import {isValidSpanishPhone} from '../utils/validatePhone.js';

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    fastify.post('/', async (req, reply) => {
        const {
            clientId,
            clientFirstName,
            clientLastName,
            clientEmail,
            clientPhone,
            lines,
            paid,
            paymentMethod,
        } = req.body;

        // Resolver o crear cliente
        let client = null;
        if (clientId) {
            client = await prisma.user.findUnique({
                where: {id: Number(clientId)},
            });
            if (!client) return reply.status(400).send({error: 'clientId inválido'});
            if (client.role === 'customer' && !client.phone) {
                return reply.status(400).send({error: 'El cliente debe tener teléfono'});
            }
        } else {
            // Necesitamos nombres y teléfono válido
            if (!clientFirstName || !clientLastName) {
                return reply
                    .status(400)
                    .send({error: 'clientFirstName y clientLastName son obligatorios'});
            }
            if (!clientPhone || !isValidSpanishPhone(clientPhone)) {
                return reply
                    .status(400)
                    .send({error: 'Teléfono válido obligatorio (ej: 600123456)'});
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
                // buscar por teléfono si ya existe
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
            return reply
                .status(400)
                .send({error: 'Debe haber al menos una línea en el pedido'});
        }

        // Calcular totales y preparar líneas
        let total = 0;
        const lineCreates = [];

        for (const l of lines) {
            const product = await prisma.product.findUnique({
                where: {id: l.productId},
            });
            if (!product) {
                return reply.status(400).send({error: `Producto inválido: ${l.productId}`});
            }

            let unitPrice = product.basePrice;
            if (l.variantId) {
                const variant = await prisma.productVariant.findUnique({
                    where: {id: l.variantId},
                });
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

        const orderNum = await nextOrderNum(prisma); // debe ser un string
        const order = await prisma.order.create({
            data: {
                orderNum,
                clientId: client.id,
                total,
                paid: !!paid,
                paymentMethod: paymentMethod || null,
                lines: {create: lineCreates},
            },
            include: {
                lines: {
                    include: {
                        product: true,
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

        // Crear tarea automática
        await prisma.task.create({
            data: {
                name: `${order.orderNum} – ${client.firstName} ${client.lastName}`.trim(),
                orderId: order.id,
                state: 'pending',
                description: lines
                    .map((l) => `Producto ${l.productId} x${l.quantity || 1}`)
                    .join('\n'),
            },
        });

        // Serializar para incluir productName en cada línea y no exponer todo el objeto product
// después de crear el pedido (order) con include de product y client:
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
}

export async function nextOrderNum(prisma) {

    const year = new Date().getFullYear();

    const lastOrder = await prisma.order.findFirst({
        where: {
            orderNum: {
                startsWith: `TPV/${year}/`,
            },
        },
        orderBy: {
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
