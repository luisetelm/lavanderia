// backend/src/routes/tracking.js

// Verifica si todos los pasos de todas las líneas de un pedido están completados.
// Si es así, marca el pedido como "ready" automáticamente.
async function autoMarkOrderReady(prisma, orderId) {
    const pendingSteps = await prisma.orderLineStep.count({
        where: {
            status: { not: 'done' },
            orderLine: { orderId: orderId }
        }
    });

    if (pendingSteps === 0) {
        const totalSteps = await prisma.orderLineStep.count({
            where: { orderLine: { orderId: orderId } }
        });

        if (totalSteps > 0) {
            const order = await prisma.order.findUnique({ where: { id: orderId } });
            if (order && order.status === 'pending') {
                await prisma.order.update({
                    where: { id: orderId },
                    data: { status: 'ready' }
                });
                console.log(`Pedido #${orderId} marcado como LISTO (todos los pasos completados)`);
            }
        }
    }
}

// Helper: obtener stepKey, stepLabel, position, resourceKey y autoProgress de un paso
// Funciona tanto con itineraryStep (nuevo) como stepConfig (legacy) como _resolvedStep (fallback)
function getStepInfo(step) {
    if (step.itineraryStep) {
        return {
            stepKey: step.itineraryStep.stepKey,
            stepLabel: step.itineraryStep.stepLabel,
            position: step.itineraryStep.position,
            displayOrder: step.itineraryStep.displayOrder ?? step.itineraryStep.position * 10,
            resourceKey: step.itineraryStep.resourceKey,
            autoProgress: step.itineraryStep.autoProgress,
        };
    }
    if (step.stepConfig) {
        return {
            stepKey: step.stepConfig.stepKey,
            stepLabel: step.stepConfig.stepLabel,
            position: step.stepConfig.position,
            displayOrder: step.stepConfig.position * 10,
            resourceKey: step.stepConfig.resourceKey,
            autoProgress: false, // legacy steps no tienen autoProgress
        };
    }
    // Fallback: metadata inferida del itinerario actual del producto
    if (step._resolvedStep) {
        return {
            stepKey: step._resolvedStep.stepKey,
            stepLabel: step._resolvedStep.stepLabel,
            position: step._resolvedStep.position,
            displayOrder: step._resolvedStep.displayOrder ?? step._resolvedStep.position * 10,
            resourceKey: step._resolvedStep.resourceKey,
            autoProgress: step._resolvedStep.autoProgress,
        };
    }
    return { stepKey: '?', stepLabel: '?', position: 0, displayOrder: 0, resourceKey: null, autoProgress: false };
}

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    // ─── GET /api/tracking/board ── Vista tablero kanban ──
    fastify.get('/board', async (req, reply) => {
        try {
            // 1. Obtener TODOS los pasos de itinerarios activos para tener columnas fijas
            const allItinerarySteps = await prisma.itineraryStep.findMany({
                where: { itinerary: { isActive: true } },
                orderBy: { displayOrder: 'asc' },
                select: { stepKey: true, stepLabel: true, position: true, resourceKey: true, autoProgress: true, displayOrder: true }
            });

            // Deduplicar por stepKey (quedarnos con el menor displayOrder como referencia)
            const fixedColumns = {};
            for (const is of allItinerarySteps) {
                if (!fixedColumns[is.stepKey]) {
                    fixedColumns[is.stepKey] = {
                        stepKey: is.stepKey,
                        stepLabel: is.stepLabel,
                        position: is.position,
                        displayOrder: is.displayOrder ?? is.position * 10,
                        resourceKey: is.resourceKey,
                        autoProgress: is.autoProgress,
                        items: []
                    };
                }
            }

            // 2. Obtener todos los pasos NO completados, de pedidos activos
            const activeSteps = await prisma.orderLineStep.findMany({
                where: {
                    status: { in: ['pending', 'in_progress'] },
                    orderLine: {
                        order: { status: { in: ['pending', 'ready'] } }
                    }
                },
                include: {
                    stepConfig: true,
                    itineraryStep: true,
                    orderLine: {
                        include: {
                            product: {
                                select: {
                                    id: true, name: true,
                                    itinerary: {
                                        include: {
                                            steps: {
                                                orderBy: { position: 'asc' },
                                                select: { id: true, stepKey: true, stepLabel: true, position: true, resourceKey: true, autoProgress: true, isOptional: true, displayOrder: true }
                                            }
                                        }
                                    }
                                }
                            },
                            order: {
                                select: {
                                    id: true,
                                    orderNum: true,
                                    fechaLimite: true,
                                    status: true,
                                    client: { select: { id: true, firstName: true, lastName: true } }
                                }
                            },
                            steps: {
                                select: { id: true },
                                orderBy: { id: 'asc' }
                            }
                        }
                    },
                    completedByUser: { select: { id: true, firstName: true } }
                },
            });

            // Reparar pasos huérfanos en memoria: inferir metadata del itinerario actual
            for (const step of activeSteps) {
                if (!step.itineraryStep && !step.stepConfig) {
                    const itinSteps = step.orderLine?.product?.itinerary?.steps;
                    const allLineStepIds = step.orderLine?.steps?.map(s => s.id) || [];
                    if (itinSteps && allLineStepIds.length > 0) {
                        // Filtrar solo pasos NO opcionales del itinerario (los obligatorios se crearon siempre)
                        const mandatoryItinSteps = itinSteps.filter(s => !s.isOptional);
                        const idx = allLineStepIds.indexOf(step.id);
                        if (idx >= 0 && idx < mandatoryItinSteps.length) {
                            // Asignar metadata del itinerario como fallback virtual
                            step._resolvedStep = mandatoryItinSteps[idx];
                        } else if (idx >= 0 && idx < itinSteps.length) {
                            step._resolvedStep = itinSteps[idx];
                        }
                    }
                }
            }

            // Agrupar por línea y encontrar el paso ACTIVO (el de menor position no-done)
            const lineStepsMap = {};
            for (const step of activeSteps) {
                const key = step.orderLineId;
                if (!lineStepsMap[key]) lineStepsMap[key] = [];
                lineStepsMap[key].push(step);
            }

            const currentStepPerLine = {};
            for (const [lineId, steps] of Object.entries(lineStepsMap)) {
                const sorted = steps.sort((a, b) => {
                    const aPos = getStepInfo(a).position;
                    const bPos = getStepInfo(b).position;
                    return aPos - bPos;
                });
                currentStepPerLine[lineId] = sorted[0];
            }

            // 3. Agrupar items en las columnas fijas (y crear columnas ad-hoc para legacy/stepConfig)
            const columns = { ...fixedColumns };
            for (const [lineId, step] of Object.entries(currentStepPerLine)) {
                const info = getStepInfo(step);
                const key = info.stepKey;
                if (!columns[key]) {
                    columns[key] = {
                        stepKey: key,
                        stepLabel: info.stepLabel,
                        position: info.position,
                        displayOrder: info.displayOrder,
                        resourceKey: info.resourceKey,
                        autoProgress: info.autoProgress,
                        items: []
                    };
                }
                columns[key].items.push({
                    stepId: step.id,
                    stepConfigId: step.stepConfigId,
                    itineraryStepId: step.itineraryStepId,
                    status: step.status,
                    startedAt: step.startedAt,
                    autoProgress: info.autoProgress,
                    orderLineId: step.orderLineId,
                    quantity: step.orderLine.quantity,
                    productName: step.orderLine.product?.name || '?',
                    color: step.orderLine.color || null,
                    orderId: step.orderLine.order.id,
                    orderNum: step.orderLine.order.orderNum,
                    fechaLimite: step.orderLine.order.fechaLimite,
                    orderStatus: step.orderLine.order.status,
                    clientName: step.orderLine.order.client
                        ? `${step.orderLine.order.client.firstName} ${step.orderLine.order.client.lastName || ''}`.trim()
                        : '—',
                });
            }

            // Obtener recursos
            const resources = await prisma.resourceConfig.findMany();
            const resourceMap = {};
            resources.forEach(r => { resourceMap[r.resourceKey] = r; });

            // Ordenar columnas por posición y tarjetas dentro de cada columna por urgencia

            const board = Object.values(columns)
                .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.position - b.position)
                .map(col => {
                    // Ordenar items: in_progress primero, luego por fecha entrega (urgentes arriba)
                    col.items.sort((a, b) => {
                        // in_progress siempre primero
                        if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
                        if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;

                        const aDate = a.fechaLimite ? new Date(a.fechaLimite) : null;
                        const bDate = b.fechaLimite ? new Date(b.fechaLimite) : null;

                        // Sin fecha al final
                        if (!aDate && bDate) return 1;
                        if (aDate && !bDate) return -1;
                        if (!aDate && !bDate) return 0;

                        // Fecha más cercana primero (pasadas = más urgentes)
                        return aDate - bDate;
                    });

                    return {
                        ...col,
                        resource: col.resourceKey ? resourceMap[col.resourceKey] || null : null,
                        itemCount: col.items.length,
                    };
                });

            return reply.send({ board, resources: resourceMap });
        } catch (err) {
            console.error('Error en GET /tracking/board:', err);
            return reply.status(500).send({ error: 'Error cargando tablero de tracking' });
        }
    });

    // ─── GET /api/tracking/order/:orderId ── Tracking de un pedido ──
    fastify.get('/order/:orderId', async (req, reply) => {
        const orderId = Number(req.params.orderId);
        if (isNaN(orderId)) return reply.status(400).send({ error: 'ID inválido' });

        try {
            const order = await prisma.order.findUnique({
                where: { id: orderId },
                select: {
                    id: true,
                    orderNum: true,
                    status: true,
                    lines: {
                        select: {
                            id: true,
                            quantity: true,
                            product: { select: { id: true, name: true,
                                itinerary: {
                                    include: {
                                        steps: {
                                            orderBy: { position: 'asc' },
                                            select: { id: true, stepKey: true, stepLabel: true, position: true, resourceKey: true, autoProgress: true, isOptional: true, displayOrder: true }
                                        }
                                    }
                                }
                            } },
                            steps: {
                                include: {
                                    stepConfig: true,
                                    itineraryStep: true,
                                    completedByUser: { select: { id: true, firstName: true } }
                                },
                                orderBy: { id: 'asc' }
                            }
                        }
                    }
                }
            });

            if (!order) return reply.status(404).send({ error: 'Pedido no encontrado' });

            // Normalizar los pasos para el frontend
            const normalized = {
                ...order,
                lines: order.lines.map(line => {
                    // Resolver pasos huérfanos usando itinerario del producto
                    const itinSteps = line.product?.itinerary?.steps;
                    const mandatoryItinSteps = itinSteps ? itinSteps.filter(is => !is.isOptional) : [];

                    return {
                        ...line,
                        steps: line.steps
                            .map((s, idx) => {
                                // Si no tiene metadata, intentar resolver
                                if (!s.itineraryStep && !s.stepConfig && mandatoryItinSteps.length > 0) {
                                    const matched = idx < mandatoryItinSteps.length ? mandatoryItinSteps[idx] : (itinSteps ? itinSteps[idx] : null);
                                    if (matched) s._resolvedStep = matched;
                                }
                                const info = getStepInfo(s);
                                return {
                                    id: s.id,
                                    status: s.status,
                                    startedAt: s.startedAt,
                                    completedAt: s.completedAt,
                                    completedBy: s.completedByUser,
                                    stepKey: info.stepKey,
                                    stepLabel: info.stepLabel,
                                    position: info.position,
                                    resourceKey: info.resourceKey,
                                    autoProgress: info.autoProgress,
                                };
                            })
                            .sort((a, b) => a.position - b.position)
                    };
                })
            };

            return reply.send(normalized);
        } catch (err) {
            console.error('Error en GET /tracking/order/:orderId:', err);
            return reply.status(500).send({ error: 'Error obteniendo tracking' });
        }
    });

    // ─── PATCH /api/tracking/steps/:stepId ── Iniciar o completar un paso ──
    // body.action: 'start' (pending→in_progress) o 'complete' (pending/in_progress→done)
    // Si no se envía action, se asume 'complete' (compatibilidad)
    fastify.patch('/steps/:stepId', async (req, reply) => {
        const stepId = Number(req.params.stepId);
        const userId = req.user?.userId;
        const action = req.body?.action || 'complete'; // 'start' o 'complete'

        if (isNaN(stepId)) return reply.status(400).send({ error: 'ID inválido' });

        try {
            const step = await prisma.orderLineStep.findUnique({
                where: { id: stepId },
                include: { stepConfig: true, itineraryStep: true, orderLine: true }
            });
            if (!step) return reply.status(404).send({ error: 'Paso no encontrado' });

            const now = new Date();
            let data;

            if (action === 'start') {
                if (step.status !== 'pending') {
                    return reply.status(400).send({ error: 'Solo se puede iniciar un paso pendiente' });
                }
                data = {
                    status: 'in_progress',
                    startedAt: now,
                };
            } else {
                // complete
                data = {
                    status: 'done',
                    startedAt: step.startedAt || now,
                    completedAt: now,
                    completedBy: userId || null,
                };
            }

            const updated = await prisma.orderLineStep.update({
                where: { id: stepId },
                data,
                include: {
                    stepConfig: true,
                    itineraryStep: true,
                    completedByUser: { select: { id: true, firstName: true } }
                }
            });

            // Auto-marcar pedido como "ready" si se completó
            if (action === 'complete') {
                await autoMarkOrderReady(prisma, step.orderLine.orderId);
            }

            return reply.send(updated);
        } catch (err) {
            console.error('Error en PATCH /tracking/steps/:stepId:', err);
            return reply.status(500).send({ error: 'Error actualizando paso' });
        }
    });

    // ─── PATCH /api/tracking/steps/:stepId/undo ── Deshacer un paso ──
    fastify.patch('/steps/:stepId/undo', async (req, reply) => {
        const stepId = Number(req.params.stepId);
        if (isNaN(stepId)) return reply.status(400).send({ error: 'ID inválido' });

        try {
            const step = await prisma.orderLineStep.findUnique({
                where: { id: stepId },
                include: { stepConfig: true, itineraryStep: true, orderLine: true }
            });
            if (!step) return reply.status(404).send({ error: 'Paso no encontrado' });
            if (step.status === 'pending') return reply.status(400).send({ error: 'El paso ya está pendiente' });

            const info = getStepInfo(step);

            // Si está done, verificar que no haya pasos posteriores ya completados
            if (step.status === 'done') {
                // Obtener todos los pasos de esta línea
                const allLineSteps = await prisma.orderLineStep.findMany({
                    where: { orderLineId: step.orderLineId },
                    include: { stepConfig: true, itineraryStep: true }
                });
                const laterDoneSteps = allLineSteps.filter(s => {
                    const sInfo = getStepInfo(s);
                    return s.status === 'done' && sInfo.position > info.position;
                });
                if (laterDoneSteps.length > 0) {
                    return reply.status(400).send({ error: 'No se puede deshacer: hay pasos posteriores ya completados.' });
                }
            }

            const updated = await prisma.orderLineStep.update({
                where: { id: stepId },
                data: {
                    status: 'pending',
                    startedAt: null,
                    completedAt: null,
                    completedBy: null,
                },
                include: {
                    stepConfig: true,
                    itineraryStep: true,
                    completedByUser: { select: { id: true, firstName: true } }
                }
            });

            // Si el pedido estaba como "ready", volver a "pending"
            const order = await prisma.order.findFirst({ where: { id: step.orderLine.orderId } });
            if (order && order.status === 'ready') {
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: 'pending' }
                });
            }

            return reply.send(updated);
        } catch (err) {
            console.error('Error en PATCH /tracking/steps/:stepId/undo:', err);
            return reply.status(500).send({ error: 'Error deshaciendo paso' });
        }
    });

    // ─── POST /api/tracking/steps/batch-complete ── Completar/Iniciar varios pasos a la vez ──
    fastify.post('/steps/batch-complete', async (req, reply) => {
        const { stepIds, action = 'complete' } = req.body;
        const userId = req.user?.userId;

        if (!Array.isArray(stepIds) || stepIds.length === 0) {
            return reply.status(400).send({ error: 'stepIds debe ser un array no vacío' });
        }

        try {
            const now = new Date();
            let data;
            if (action === 'start') {
                data = { status: 'in_progress', startedAt: now };
            } else {
                data = { status: 'done', completedAt: now, completedBy: userId || null };
            }

            const updated = await prisma.orderLineStep.updateMany({
                where: { id: { in: stepIds.map(Number) } },
                data
            });

            // Auto-marcar pedidos como "ready" si se completaron
            if (action === 'complete') {
                const affectedSteps = await prisma.orderLineStep.findMany({
                    where: { id: { in: stepIds.map(Number) } },
                    include: { orderLine: { select: { orderId: true } } }
                });
                const orderIds = [...new Set(affectedSteps.map(s => s.orderLine.orderId))];
                for (const oid of orderIds) {
                    await autoMarkOrderReady(prisma, oid);
                }
            }

            return reply.send({ count: updated.count });
        } catch (err) {
            console.error('Error en batch-complete:', err);
            return reply.status(500).send({ error: 'Error completando pasos' });
        }
    });

    // ─── GET /api/tracking/schedule ── Obtener calendario laboral ──
    fastify.get('/schedule', async (req, reply) => {
        try {
            const weekly = await prisma.workSchedule.findMany({ orderBy: { dayOfWeek: 'asc' } });
            const exceptions = await prisma.workScheduleException.findMany({
                where: { date: { gte: new Date() } },
                orderBy: { date: 'asc' },
                take: 50
            });
            return reply.send({ weekly, exceptions });
        } catch (err) {
            console.error('Error en GET /tracking/schedule:', err);
            return reply.status(500).send({ error: 'Error cargando calendario' });
        }
    });

    // ─── PUT /api/tracking/schedule ── Actualizar horario semanal ──
    fastify.put('/schedule', async (req, reply) => {
        if (req.user?.role !== 'admin') {
            return reply.status(403).send({ error: 'Solo administradores' });
        }

        const { weekly } = req.body; // array de 7 objetos
        if (!Array.isArray(weekly)) return reply.status(400).send({ error: 'weekly debe ser un array' });

        try {
            for (const day of weekly) {
                await prisma.workSchedule.upsert({
                    where: { dayOfWeek: day.dayOfWeek },
                    update: {
                        isWorking: day.isWorking,
                        startTime: day.startTime || null,
                        endTime: day.endTime || null,
                        capacityMin: day.capacityMin || 0,
                    },
                    create: {
                        dayOfWeek: day.dayOfWeek,
                        isWorking: day.isWorking,
                        startTime: day.startTime || null,
                        endTime: day.endTime || null,
                        capacityMin: day.capacityMin || 0,
                    }
                });
            }
            const result = await prisma.workSchedule.findMany({ orderBy: { dayOfWeek: 'asc' } });
            return reply.send(result);
        } catch (err) {
            console.error('Error en PUT /tracking/schedule:', err);
            return reply.status(500).send({ error: 'Error actualizando calendario' });
        }
    });

    // ─── POST /api/tracking/schedule/exceptions ── Añadir festivo ──
    fastify.post('/schedule/exceptions', async (req, reply) => {
        if (req.user?.role !== 'admin') {
            return reply.status(403).send({ error: 'Solo administradores' });
        }

        const { date, isWorking, startTime, endTime, capacityMin, label } = req.body;
        if (!date) return reply.status(400).send({ error: 'date es obligatorio' });

        try {
            const exception = await prisma.workScheduleException.upsert({
                where: { date: new Date(date) },
                update: { isWorking: isWorking ?? false, startTime, endTime, capacityMin: capacityMin || 0, label },
                create: { date: new Date(date), isWorking: isWorking ?? false, startTime, endTime, capacityMin: capacityMin || 0, label }
            });
            return reply.send(exception);
        } catch (err) {
            console.error('Error en POST /tracking/schedule/exceptions:', err);
            return reply.status(500).send({ error: 'Error añadiendo excepción' });
        }
    });

    // ─── DELETE /api/tracking/schedule/exceptions/:id ──
    fastify.delete('/schedule/exceptions/:id', async (req, reply) => {
        if (req.user?.role !== 'admin') {
            return reply.status(403).send({ error: 'Solo administradores' });
        }

        try {
            await prisma.workScheduleException.delete({ where: { id: Number(req.params.id) } });
            return reply.send({ ok: true });
        } catch (err) {
            return reply.status(500).send({ error: 'Error eliminando excepción' });
        }
    });

    // ─── GET /api/tracking/resources ── Obtener recursos ──
    fastify.get('/resources', async (req, reply) => {
        try {
            const resources = await prisma.resourceConfig.findMany();
            return reply.send(resources);
        } catch (err) {
            return reply.status(500).send({ error: 'Error cargando recursos' });
        }
    });
}

