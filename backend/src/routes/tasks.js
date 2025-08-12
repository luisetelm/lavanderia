// backend/src/routes/tasks.js
import {sendSMS, sendWhatsApp} from '../services/twilio.js';

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    // Listar tareas (más recientes primero)
    // dentro de fastify.get('/', ...)
    fastify.get('/', async (req, reply) => {
        const {q} = req.query;
        // Construir filtro condicional
        const where = {};
        if (q) {
            const term = q.toString();
            where.OR = [{name: {contains: term, mode: 'insensitive'}}, // si quieres buscar por nombre de tarea
                {
                    order: {
                        orderNum: {contains: term, mode: 'insensitive'},
                    },
                }, {
                    order: {
                        client: {
                            OR: [{firstName: {contains: term, mode: 'insensitive'}}, {
                                lastName: {
                                    contains: term,
                                    mode: 'insensitive'
                                }
                            },],
                        },
                    },
                },];
        }

        const tasks = await prisma.task.findMany({
            where, orderBy: {assignedAt: 'desc'}, include: {
                order: {
                    include: {
                        client: {
                            select: {
                                id: true, firstName: true, lastName: true, phone: true,
                            },
                        }, lines: {
                            include: {product: true},
                        },
                    },
                }, worker: {
                    select: {
                        id: true, firstName: true, lastName: true,
                    },
                }, notifications: true,
            },
        });

        const serialized = tasks.map((t) => ({
            ...t, order: t.order ? {
                ...t.order, lines: t.order.lines.map((l) => ({
                    id: l.id,
                    productId: l.productId,
                    variantId: l.variantId,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    totalPrice: l.totalPrice,
                    notes: l.notes,
                    productName: l.product?.name || '',
                })),
            } : null,
        }));

        return reply.send(serialized);
    });


    // Obtener una tarea concreta
    fastify.get('/:id', async (req, reply) => {
        const {id} = req.params;
        const task = await prisma.task.findUnique({
            where: {id: Number(id)}, include: {
                order: {
                    include: {
                        client: {
                            select: {
                                id: true, firstName: true, lastName: true, phone: true,
                            },
                        }, lines: {
                            include: {product: true},
                        },
                    },
                }, worker: {
                    select: {
                        id: true, firstName: true, lastName: true,
                    },
                }, notifications: true,
            },
        });
        if (!task) return reply.status(404).send({error: 'Tarea no encontrada'});

        // Serializar líneas con productName
        if (task.order?.lines) {
            task.order.lines = task.order.lines.map((l) => ({
                id: l.id,
                productId: l.productId,
                variantId: l.variantId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                totalPrice: l.totalPrice,
                notes: l.notes,
                productName: l.product?.name || '',
            }));
        }

        return reply.send(task);
    });

    // Actualizar tarea (estado, asignar trabajador, descripción)
    fastify.patch('/:id', async (req, reply) => {
        const {id} = req.params;
        const {status, workerId, description} = req.body;

        const data = {};
        if (status) {
            data.status = status;
            if (status === 'ready') data.completedAt = new Date();
            if (status === 'collected') data.collectedAt = new Date();
        }
        if (workerId !== undefined) data.workerId = workerId;
        if (description !== undefined) data.description = description;

        let task;
        try {
            task = await prisma.task.update({
                where: {id: Number(id)}, data, include: {
                    order: {
                        include: {
                            client: {
                                select: {
                                    id: true, firstName: true, lastName: true, phone: true,
                                },
                            }, lines: {
                                include: {product: true},
                            },
                        },
                    }, worker: {
                        select: {
                            id: true, firstName: true, lastName: true,
                        },
                    }, notifications: true,
                },
            });
        } catch (e) {
            return reply.status(400).send({error: 'No se pudo actualizar la tarea', details: e.message});
        }

        // Serializar líneas con productName
        if (task.order?.lines) {
            task.order.lines = task.order.lines.map((l) => ({
                id: l.id,
                productId: l.productId,
                variantId: l.variantId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                totalPrice: l.totalPrice,
                notes: l.notes,
                productName: l.product?.name || '',
            }));
        }

        // Si se marca como ready, notificar al cliente
        if (status === 'ready' && task.order && task.order.client?.phone) {
            const client = task.order.client;
            const orderNum = task.order.orderNum || '';
            const clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim();
            const message = `Hola ${clientName}, tu pedido ${orderNum} está listo para recoger.`;

            // SMS
            try {
                await sendSMS(client.phone, message);
                await prisma.notification.create({
                    data: {
                        taskId: task.id, type: 'sms', recipient: client.phone, content: message, status: 'sent',
                    },
                });
            } catch (err) {
                await prisma.notification.create({
                    data: {
                        taskId: task.id, type: 'sms', recipient: client.phone, content: message, status: 'failed',
                    },
                });
            }

        }

        return reply.send(task);
    });
}
