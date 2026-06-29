// backend/src/routes/tracking.js

import { sendReadyNotification } from '../services/notify.js';

// Verifica si todos los pasos de todas las líneas de un pedido están completados.
// Si es así, marca el pedido como "ready" automáticamente y notifica al cliente.
// Devuelve true si en esta llamada el pedido ha pasado a "ready".
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

                // Notificar automáticamente al cliente (usa canal preferido)
                await sendReadyNotification(prisma, orderId);
                return true;
            }
        }
    }
    return false;
}

// Helper: obtener stepKey, stepLabel, position, resourceKey, autoProgress y durationMin de un paso
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
            durationMin: step.itineraryStep.durationMin || 0,
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
            durationMin: step.stepConfig.durationMin || 0,
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
            durationMin: step._resolvedStep.durationMin || 0,
        };
    }
    return { stepKey: '?', stepLabel: '?', position: 0, displayOrder: 0, resourceKey: null, autoProgress: false, durationMin: 0 };
}

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    // Helper: calcular minutos laborables reales entre ahora y una fecha límite
    // Usa work_schedule (horario semanal) y work_schedule_exceptions (festivos)
    async function getAvailableMinutes(deadline) {
        if (!deadline) return null;
        const now = new Date();
        const end = new Date(deadline);
        if (end <= now) return 0;

        // Obtener horario semanal
        const weekly = await prisma.workSchedule.findMany();
        const weeklyMap = {};
        weekly.forEach(w => { weeklyMap[w.dayOfWeek] = w; });

        // Obtener excepciones en el rango
        const exceptions = await prisma.workScheduleException.findMany({
            where: {
                date: { gte: new Date(now.toISOString().slice(0, 10)), lte: end }
            }
        });
        const exceptionMap = {};
        exceptions.forEach(e => {
            exceptionMap[new Date(e.date).toISOString().slice(0, 10)] = e;
        });

        let totalMin = 0;
        const cursor = new Date(now);
        // Si estamos a mitad del día, calculamos los minutos restantes del día actual
        const maxDays = 365; // Límite de seguridad
        let dayCount = 0;

        while (cursor < end && dayCount < maxDays) {
            const dateStr = cursor.toISOString().slice(0, 10);
            const dow = cursor.getDay();
            const exception = exceptionMap[dateStr];
            const schedule = weeklyMap[dow];

            let dayCapacity = 0;
            if (exception) {
                // Excepción tiene prioridad
                dayCapacity = exception.isWorking ? (exception.capacityMin || 0) : 0;
            } else if (schedule) {
                dayCapacity = schedule.isWorking ? (schedule.capacityMin || 0) : 0;
            }

            // Si es el primer día (hoy), calcular solo la fracción restante
            if (dayCount === 0 && dayCapacity > 0 && schedule?.startTime && schedule?.endTime) {
                const [sh, sm] = schedule.startTime.split(':').map(Number);
                const [eh, em] = schedule.endTime.split(':').map(Number);
                const startMin = sh * 60 + sm;
                const endMin = eh * 60 + em;
                const currentMin = cursor.getHours() * 60 + cursor.getMinutes();
                if (currentMin < startMin) {
                    // Aún no empezó la jornada, contamos todo el día
                } else if (currentMin >= endMin) {
                    // Ya pasó la jornada
                    dayCapacity = 0;
                } else {
                    // A mitad de jornada: proporción restante
                    const totalWorkMin = endMin - startMin;
                    const remainingWorkMin = endMin - currentMin;
                    dayCapacity = Math.round(dayCapacity * (remainingWorkMin / totalWorkMin));
                }
            }

            // Si es el último día (fecha límite), calcular solo hasta esa hora
            const nextDay = new Date(cursor);
            nextDay.setDate(nextDay.getDate() + 1);
            nextDay.setHours(0, 0, 0, 0);
            if (nextDay > end && dayCapacity > 0 && schedule?.startTime && schedule?.endTime) {
                const [sh, sm] = schedule.startTime.split(':').map(Number);
                const [eh, em] = schedule.endTime.split(':').map(Number);
                const startMin = sh * 60 + sm;
                const endMin = eh * 60 + em;
                const deadlineMin = end.getHours() * 60 + end.getMinutes();
                if (deadlineMin <= startMin) {
                    dayCapacity = 0;
                } else if (deadlineMin < endMin) {
                    const totalWorkMin = endMin - startMin;
                    const usableMin = deadlineMin - (dayCount === 0 ? Math.max(startMin, cursor.getHours() * 60 + cursor.getMinutes()) : startMin);
                    dayCapacity = Math.max(0, Math.round(dayCapacity * (usableMin / totalWorkMin)));
                }
            }

            totalMin += dayCapacity;
            cursor.setDate(cursor.getDate() + 1);
            cursor.setHours(0, 0, 0, 0);
            dayCount++;
        }

        return totalMin;
    }

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
                                    id: true, name: true, weight: true,
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
                                include: {
                                    itineraryStep: { select: { stepKey: true, stepLabel: true, position: true, displayOrder: true } },
                                    stepConfig:    { select: { stepKey: true, stepLabel: true, position: true } },
                                },
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
                    stepDurationMin: info.durationMin,
                    orderLineId: step.orderLineId,
                    quantity: step.orderLine.quantity,
                    productName: step.orderLine.product?.name || '?',
                    productWeight: step.orderLine.product?.weight || 0,
                    color: step.orderLine.color || null,
                    orderId: step.orderLine.order.id,
                    orderNum: step.orderLine.order.orderNum,
                    fechaLimite: step.orderLine.order.fechaLimite,
                    orderStatus: step.orderLine.order.status,
                    clientName: step.orderLine.order.client
                        ? `${step.orderLine.order.client.firstName} ${step.orderLine.order.client.lastName || ''}`.trim()
                        : '—',
                    // Tiempos reales de ejecución (en ms para precisión, el frontend formatea):
                    //  - lineFirstStartedAt: cuándo se inició la primera operación sobre esa prenda
                    //  - lineElapsedMsCompleted: ms acumulados de pasos ya completados (no incluye paso actual)
                    //  - El paso actual se calcula en vivo en el frontend desde startedAt
                    lineFirstStartedAt: (() => {
                        const starts = (step.orderLine.steps || [])
                            .map(s => s.startedAt ? new Date(s.startedAt).getTime() : null)
                            .filter(Boolean);
                        return starts.length ? new Date(Math.min(...starts)).toISOString() : null;
                    })(),
                    lineElapsedMsCompleted: (step.orderLine.steps || []).reduce((acc, s) => {
                        if (s.status === 'done' && s.startedAt && s.completedAt) {
                            return acc + (new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime());
                        }
                        return acc;
                    }, 0),
                    // Cronología detallada de los pasos de la línea (para vista expandida)
                    lineStepsTiming: (() => {
                        const itinSteps = step.orderLine.product?.itinerary?.steps || [];
                        const mandatoryItin = itinSteps.filter(x => !x.isOptional);
                        return (step.orderLine.steps || []).map((s, idx) => {
                            // Resolver metadata (itineraryStep > stepConfig > fallback por posición en itinerario)
                            let stepKey = s.itineraryStep?.stepKey || s.stepConfig?.stepKey || null;
                            let stepLabel = s.itineraryStep?.stepLabel || s.stepConfig?.stepLabel || null;
                            let position = s.itineraryStep?.position ?? s.stepConfig?.position ?? idx;
                            const displayOrder = s.itineraryStep?.displayOrder ?? (position * 10);
                            if (!stepKey && mandatoryItin[idx]) {
                                stepKey = mandatoryItin[idx].stepKey;
                                stepLabel = mandatoryItin[idx].stepLabel;
                                position = mandatoryItin[idx].position;
                            } else if (!stepKey && itinSteps[idx]) {
                                stepKey = itinSteps[idx].stepKey;
                                stepLabel = itinSteps[idx].stepLabel;
                                position = itinSteps[idx].position;
                            }
                            const startedAtMs = s.startedAt ? new Date(s.startedAt).getTime() : null;
                            const completedAtMs = s.completedAt ? new Date(s.completedAt).getTime() : null;
                            const elapsedMs = (s.status === 'done' && startedAtMs && completedAtMs)
                                ? Math.max(0, completedAtMs - startedAtMs)
                                : null;
                            return {
                                id: s.id,
                                stepKey: stepKey || '?',
                                stepLabel: stepLabel || '?',
                                position,
                                displayOrder,
                                status: s.status,
                                startedAt: s.startedAt,
                                completedAt: s.completedAt,
                                elapsedMs,
                            };
                        }).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.position - b.position);
                    })(),
                });
            }

            // Obtener recursos
            const resources = await prisma.resourceConfig.findMany();
            const resourceMap = {};
            resources.forEach(r => { resourceMap[r.resourceKey] = r; });

            // Helper: calcular minutos estimados para un paso dado recurso + cantidad
            // Usa stepDurationMin (del itinerario) como fuente principal de tiempo.
            // resource_config aporta: nº de máquinas (units), modo batch/individual, capacidad lote.
            function estimateStepMinutes(resourceKey, stepDurationMin, quantity, productWeight) {
                if (!stepDurationMin || stepDurationMin === 0) return 0;
                const resource = resourceKey ? resourceMap[resourceKey] : null;
                if (!resource) {
                    // Sin recurso asignado: duración plana (ej: envío externo)
                    return stepDurationMin;
                }
                if (resource.processingMode === 'batch') {
                    // Batch: varias prendas por ciclo. stepDurationMin = duración de un ciclo.
                    const load = resource.capacityUnit === 'kg' ? (productWeight || 0) * quantity : quantity;
                    const cycles = Math.ceil(load / (resource.batchCapacity || 1));
                    return Math.round((cycles * stepDurationMin) / (resource.units || 1));
                }
                // Individual: stepDurationMin = tiempo por prenda
                return Math.round((quantity * stepDurationMin) / (resource.units || 1));
            }

            // Calcular tiempo total pendiente por línea (TODOS los pasos restantes, no solo el actual)
            const lineTotalRemainingMap = {};
            for (const [lineId, steps] of Object.entries(lineStepsMap)) {
                let total = 0;
                const qty = steps[0]?.orderLine?.quantity || 1;
                const pw = steps[0]?.orderLine?.product?.weight || 0;
                for (const step of steps) {
                    const info = getStepInfo(step);
                    total += estimateStepMinutes(info.resourceKey, info.durationMin, qty, pw);
                }
                lineTotalRemainingMap[lineId] = Math.round(total);
            }

            // Calcular estimatedMin (paso actual) y totalRemainingMin (todos los pasos restantes) por item
            // Pre-calcular minutos disponibles por deadline (evitar queries repetidas)
            const deadlineMinutesCache = {};
            for (const col of Object.values(columns)) {
                for (const item of col.items) {
                    if (item.fechaLimite) {
                        const key = new Date(item.fechaLimite).toISOString();
                        if (deadlineMinutesCache[key] === undefined) {
                            deadlineMinutesCache[key] = await getAvailableMinutes(item.fechaLimite);
                        }
                    }
                }
            }

            for (const col of Object.values(columns)) {
                for (const item of col.items) {
                    const stepMin = estimateStepMinutes(col.resourceKey, item.stepDurationMin, item.quantity, item.productWeight);
                    item.estimatedMin = stepMin;
                    item.totalRemainingMin = lineTotalRemainingMap[item.orderLineId] || stepMin;

                    // Urgencia: comparar tiempo restante hasta deadline con TOTAL pendiente (no solo paso actual)
                    if (item.fechaLimite) {
                        const key = new Date(item.fechaLimite).toISOString();
                        const availableMin = deadlineMinutesCache[key] || 0;
                        if (availableMin < item.totalRemainingMin) item.urgency = 'critical';
                        else if (availableMin < item.totalRemainingMin * 1.5) item.urgency = 'tight';
                        else item.urgency = 'ok';
                    } else {
                        item.urgency = 'ok';
                    }
                }
            }

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
            let orderBecameReady = false;
            if (action === 'complete') {
                orderBecameReady = await autoMarkOrderReady(prisma, step.orderLine.orderId);
            }

            return reply.send({ ...updated, orderBecameReady, orderId: step.orderLine.orderId });
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
            const readyOrderIds = [];
            if (action === 'complete') {
                const affectedSteps = await prisma.orderLineStep.findMany({
                    where: { id: { in: stepIds.map(Number) } },
                    include: { orderLine: { select: { orderId: true } } }
                });
                const orderIds = [...new Set(affectedSteps.map(s => s.orderLine.orderId))];
                for (const oid of orderIds) {
                    const became = await autoMarkOrderReady(prisma, oid);
                    if (became) readyOrderIds.push(oid);
                }
            }

            return reply.send({ count: updated.count, readyOrderIds });
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

    // ─── POST /api/tracking/resources ── Crear recurso ──
    fastify.post('/resources', async (req, reply) => {
        if (req.user?.role !== 'admin') return reply.status(403).send({ error: 'Solo administradores' });

        const { resourceKey, label, units, processingMode, batchCapacity, cycleDurationMin, capacityUnit } = req.body;
        if (!resourceKey || !label) return reply.status(400).send({ error: 'resourceKey y label son obligatorios' });

        try {
            const resource = await prisma.resourceConfig.create({
                data: {
                    resourceKey,
                    label,
                    units: units || 1,
                    processingMode: processingMode || 'individual',
                    batchCapacity: batchCapacity || 1,
                    cycleDurationMin: cycleDurationMin || 0,
                    capacityUnit: capacityUnit || 'items',
                }
            });
            return reply.status(201).send(resource);
        } catch (err) {
            if (err.code === 'P2002') return reply.status(400).send({ error: 'Ya existe un recurso con esa clave' });
            return reply.status(500).send({ error: 'Error creando recurso' });
        }
    });

    // ─── PUT /api/tracking/resources/:id ── Editar recurso ──
    fastify.put('/resources/:id', async (req, reply) => {
        if (req.user?.role !== 'admin') return reply.status(403).send({ error: 'Solo administradores' });

        const id = Number(req.params.id);
        const { label, units, processingMode, batchCapacity, cycleDurationMin, capacityUnit } = req.body;

        try {
            const data = {};
            if (label !== undefined) data.label = label;
            if (units !== undefined) data.units = Number(units);
            if (processingMode !== undefined) data.processingMode = processingMode;
            if (batchCapacity !== undefined) data.batchCapacity = Number(batchCapacity);
            if (cycleDurationMin !== undefined) data.cycleDurationMin = Number(cycleDurationMin);
            if (capacityUnit !== undefined) data.capacityUnit = capacityUnit;

            const resource = await prisma.resourceConfig.update({
                where: { id },
                data,
            });
            return reply.send(resource);
        } catch (err) {
            return reply.status(500).send({ error: 'Error actualizando recurso' });
        }
    });

    // ─── DELETE /api/tracking/resources/:id ── Eliminar recurso ──
    fastify.delete('/resources/:id', async (req, reply) => {
        if (req.user?.role !== 'admin') return reply.status(403).send({ error: 'Solo administradores' });

        try {
            await prisma.resourceConfig.delete({ where: { id: Number(req.params.id) } });
            return reply.send({ ok: true });
        } catch (err) {
            return reply.status(500).send({ error: 'Error eliminando recurso' });
        }
    });

    // ─── GET /api/tracking/estimate/:orderId ── Tiempo estimado de un pedido ──
    fastify.get('/estimate/:orderId', async (req, reply) => {
        const orderId = Number(req.params.orderId);
        if (isNaN(orderId)) return reply.status(400).send({ error: 'ID inválido' });

        try {
            const order = await prisma.order.findUnique({
                where: { id: orderId },
                select: {
                    id: true, orderNum: true, fechaLimite: true, status: true,
                    lines: {
                        select: {
                            id: true, quantity: true,
                            product: { select: { id: true, name: true, weight: true } },
                            steps: {
                                include: { itineraryStep: true, stepConfig: true },
                                orderBy: { id: 'asc' },
                            },
                        },
                    },
                },
            });
            if (!order) return reply.status(404).send({ error: 'Pedido no encontrado' });

            const resources = await prisma.resourceConfig.findMany();
            const resourceMap = {};
            resources.forEach(r => { resourceMap[r.resourceKey] = r; });

            let totalEstimatedMin = 0;
            let totalRemainingMin = 0;

            const lineEstimates = order.lines.map(line => {
                const qty = line.quantity || 1;
                const weight = line.product?.weight || 0;
                let lineTotal = 0;
                let lineRemaining = 0;

                const stepEstimates = line.steps.map(step => {
                    const info = getStepInfo(step);
                    const resource = info.resourceKey ? resourceMap[info.resourceKey] : null;
                    const stepDuration = info.durationMin || 0;
                    let minutes = 0;

                    if (stepDuration > 0) {
                        if (!resource) {
                            // Sin recurso: duración plana (ej: envío externo)
                            minutes = stepDuration;
                        } else if (resource.processingMode === 'batch') {
                            const load = resource.capacityUnit === 'kg' ? weight * qty : qty;
                            const cycles = Math.ceil(load / (resource.batchCapacity || 1));
                            minutes = (cycles * stepDuration) / (resource.units || 1);
                        } else {
                            // individual
                            minutes = (qty * stepDuration) / (resource.units || 1);
                        }
                    }

                    const isDone = step.status === 'done';
                    lineTotal += minutes;
                    if (!isDone) lineRemaining += minutes;

                    return {
                        stepKey: info.stepKey,
                        stepLabel: info.stepLabel,
                        status: step.status,
                        estimatedMin: Math.round(minutes),
                        resourceKey: info.resourceKey,
                    };
                });

                totalEstimatedMin += lineTotal;
                totalRemainingMin += lineRemaining;

                return {
                    lineId: line.id,
                    productName: line.product?.name || '?',
                    quantity: qty,
                    weight,
                    totalMin: Math.round(lineTotal),
                    remainingMin: Math.round(lineRemaining),
                    steps: stepEstimates,
                };
            });

            // Calcular horas laborables restantes hasta la fecha límite (usa calendario real)
            let minutesUntilDeadline = null;
            if (order.fechaLimite) {
                minutesUntilDeadline = await getAvailableMinutes(order.fechaLimite);
            }

            let urgency = 'ok'; // ok, tight, critical
            if (minutesUntilDeadline !== null && totalRemainingMin > 0) {
                const ratio = minutesUntilDeadline / totalRemainingMin;
                if (ratio < 1) urgency = 'critical';
                else if (ratio < 1.5) urgency = 'tight';
            }

            return reply.send({
                orderId: order.id,
                orderNum: order.orderNum,
                fechaLimite: order.fechaLimite,
                totalEstimatedMin: Math.round(totalEstimatedMin),
                totalRemainingMin: Math.round(totalRemainingMin),
                minutesUntilDeadline,
                urgency,
                lines: lineEstimates,
            });
        } catch (err) {
            console.error('Error en GET /tracking/estimate:', err);
            return reply.status(500).send({ error: 'Error calculando estimación' });
        }
    });
}

