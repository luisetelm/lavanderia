// backend/src/routes/tracking.js

import { sendReadyNotification } from '../services/notify.js';
import {
    leerCargaMaxima, guardarCargaMaxima, estadisticaCargaHistorica,
    leerSuplementoUrgencia, guardarSuplementoUrgencia,
} from '../utils/cargaTrabajo.js';

// Verifica si todos los pasos de todas las líneas de un pedido están completados.
// Si es así, marca el pedido como "ready" automáticamente y notifica al cliente.
// Devuelve true si en esta llamada el pedido ha pasado a "ready".
async function autoMarkOrderReady(prisma, orderId) {
    // Las prendas anuladas en un ajuste conservan sus pasos sin hacer: no cuentan
    // (si no, un pedido con una prenda anulada no pasaría nunca a «listo»).
    const pendingSteps = await prisma.orderLineStep.count({
        where: {
            status: { not: 'done' },
            orderLine: { orderId: orderId, voidedAt: null }
        }
    });

    if (pendingSteps === 0) {
        const totalSteps = await prisma.orderLineStep.count({
            where: { orderLine: { orderId: orderId, voidedAt: null } }
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

// Verifica si TODOS los pasos de una línea (prenda) están completados.
// Devuelve true si la prenda está totalmente finalizada (y tenía pasos).
async function isLineFullyDone(prisma, orderLineId) {
    const pending = await prisma.orderLineStep.count({
        where: { status: { not: 'done' }, orderLineId }
    });
    if (pending > 0) return false;
    const total = await prisma.orderLineStep.count({ where: { orderLineId } });
    return total > 0;
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

// Qué tiempo ocupa un recurso (sql/039)
const TIPOS_RECURSO = ['persona', 'maquina', 'tendido'];

// ── Tandas de trabajo (sql/039) ──
// Con una tanda abierta en la fase, cada prenda que se marca como hecha cuenta
// desde la marca anterior. Varias marcadas a la vez se reparten el hueco.
// Un hueco mayor que este (una pausa sin pulsar «Pausa») no se mide.
const TANDA_HUECO_MAX_MIN = 180;
const fechaMadrid = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

// Devuelve { sessionId, tramos: [{ startedAt, completedAt }] } para n prendas
// de la fase, o null si no hay tanda abierta (o no se puede medir). Mueve la
// marca de la tanda a "now".
async function tiemposDeTanda(db, stepKey, n, now) {
    const tanda = await db.workSession.findFirst({ where: { stepKey, endedAt: null } });
    if (!tanda || tanda.pausedAt || n < 1) return null;
    // Una tanda que se quedó abierta de otro día se cierra sin medir
    if (fechaMadrid(tanda.lastMarkAt) !== fechaMadrid(now)) {
        await db.workSession.update({ where: { id: tanda.id }, data: { endedAt: tanda.lastMarkAt } });
        return null;
    }
    const desde = new Date(tanda.lastMarkAt).getTime();
    const hueco = now.getTime() - desde;
    await db.workSession.update({ where: { id: tanda.id }, data: { lastMarkAt: now } });
    if (hueco < 0 || hueco > TANDA_HUECO_MAX_MIN * 60000) return null;
    const tramo = hueco / n;
    return {
        sessionId: tanda.id,
        tramos: Array.from({ length: n }, (_, i) => ({
            startedAt: new Date(desde + tramo * i),
            completedAt: i === n - 1 ? now : new Date(desde + tramo * (i + 1)),
        })),
    };
}

// Completa pasos aplicando las tandas abiertas. Los pasos deben venir con
// itineraryStep/stepConfig. Un paso ya iniciado conserva su inicio.
async function completarPasos(db, steps, userId, now) {
    const porFase = {};
    for (const s of steps) {
        if (s.status === 'done') continue;
        const key = getStepInfo(s).stepKey;
        (porFase[key] = porFase[key] || []).push(s);
    }
    for (const [stepKey, grupo] of Object.entries(porFase)) {
        const sinEmpezar = grupo.filter(s => s.status === 'pending' || !s.startedAt);
        const tanda = await tiemposDeTanda(db, stepKey, sinEmpezar.length, now);
        for (const s of grupo) {
            const i = sinEmpezar.indexOf(s);
            const medido = tanda && i >= 0 ? tanda.tramos[i] : null;
            await db.orderLineStep.update({
                where: { id: s.id },
                data: {
                    status: 'done',
                    startedAt: medido ? medido.startedAt : (s.startedAt || now),
                    completedAt: medido ? medido.completedAt : now,
                    completedBy: userId || null,
                    ...(medido ? { sessionId: tanda.sessionId } : {}),
                },
            });
        }
    }
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
                        voidedAt: null, // una prenda anulada en un ajuste ya no se hace
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
                                    client: { select: { id: true, firstName: true, lastName: true, alias: true } }
                                }
                            },
                            steps: {
                                include: {
                                    itineraryStep: { select: { stepKey: true, stepLabel: true, position: true, displayOrder: true, resourceKey: true } },
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
                    // Carga de máquina o tendido en la que está (sql/039)
                    loadId: step.loadId || null,
                    // Siguiente etapa de la prenda: al cargar una máquina se pueden
                    // elegir prendas que aún están en la etapa anterior (pretratamiento)
                    ...(() => {
                        const resto = (step.orderLine.steps || [])
                            .filter(s => s.status !== 'done' && s.id !== step.id)
                            .map(s => ({ id: s.id, ...getStepInfo(s) }))
                            .filter(s => s.position > info.position)
                            .sort((a, b) => a.position - b.position);
                        const sig = resto[0];
                        return sig
                            ? { nextStepId: sig.id, nextStepKey: sig.stepKey, nextStepLabel: sig.stepLabel, nextResourceKey: sig.resourceKey || null }
                            : { nextStepId: null, nextStepKey: null, nextStepLabel: null, nextResourceKey: null };
                    })(),
                    stepConfigId: step.stepConfigId,
                    itineraryStepId: step.itineraryStepId,
                    status: step.status,
                    startedAt: step.startedAt,
                    autoProgress: info.autoProgress,
                    stepDurationMin: info.durationMin,
                    orderLineId: step.orderLineId,
                    quantity: step.orderLine.quantity,
                    productName: step.orderLine.customName || step.orderLine.product?.name || '?',
                    productWeight: step.orderLine.product?.weight || 0,
                    color: step.orderLine.color || null,
                    orderId: step.orderLine.order.id,
                    orderNum: step.orderLine.order.orderNum,
                    fechaLimite: step.orderLine.order.fechaLimite,
                    orderStatus: step.orderLine.order.status,
                    clientId: step.orderLine.order.client?.id || null,
                    clientName: step.orderLine.order.client
                        ? `${step.orderLine.order.client.firstName} ${step.orderLine.order.client.lastName || ''}`.trim()
                        : '—',
                    clientAlias: step.orderLine.order.client?.alias || null,
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

            // Obtener recursos (con sus programas, sql/039)
            const resources = await prisma.resourceConfig.findMany({
                include: { programs: { where: { isActive: true }, orderBy: [{ position: 'asc' }, { durationMin: 'asc' }] } },
            });
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
                    // Capacidad 0 = sin límite (tendedero): una sola tanda
                    const cycles = resource.batchCapacity > 0 ? Math.ceil(load / resource.batchCapacity) : 1;
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

            // Cargas de máquina y tendidos abiertos, y tandas abiertas (sql/039)
            const loads = (await prisma.machineLoad.findMany({
                where: { finishedAt: null },
                orderBy: { startedAt: 'asc' },
                include: {
                    steps: {
                        select: {
                            id: true, status: true,
                            orderLine: {
                                select: {
                                    id: true, quantity: true, customName: true, color: true,
                                    product: { select: { name: true, weight: true } },
                                    order: { select: { id: true, orderNum: true, fechaLimite: true, client: { select: { firstName: true, lastName: true, alias: true } } } },
                                },
                            },
                        },
                    },
                },
            })).map(l => ({
                id: l.id,
                resourceKey: l.resourceKey,
                unitNo: l.unitNo,
                programName: l.programName,
                durationMin: l.durationMin,
                startedAt: l.startedAt,
                endsAt: new Date(new Date(l.startedAt).getTime() + l.durationMin * 60000),
                items: l.steps.map(s => ({
                    stepId: s.id,
                    orderLineId: s.orderLine.id,
                    orderId: s.orderLine.order.id,
                    orderNum: s.orderLine.order.orderNum,
                    fechaLimite: s.orderLine.order.fechaLimite,
                    quantity: s.orderLine.quantity,
                    productName: s.orderLine.customName || s.orderLine.product?.name || '?',
                    productWeight: s.orderLine.product?.weight || 0,
                    color: s.orderLine.color || null,
                    clientName: s.orderLine.order.client
                        ? `${s.orderLine.order.client.firstName} ${s.orderLine.order.client.lastName || ''}`.trim() : '—',
                    clientAlias: s.orderLine.order.client?.alias || null,
                })),
            }));
            const sessions = await prisma.workSession.findMany({ where: { endedAt: null } });

            return reply.send({ board, resources: resourceMap, loads, sessions });
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
                        where: { voidedAt: null }, // las prendas anuladas no se hacen
                        select: {
                            id: true,
                            quantity: true,
                            customName: true,
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
                // complete (con tanda abierta, el tiempo cuenta desde la marca anterior)
                if (step.status !== 'done') await completarPasos(prisma, [step], userId, now);
                data = {};
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
            let lineBecameReady = false;
            if (action === 'complete') {
                // ¿Esta prenda (línea) acaba de quedar totalmente finalizada?
                lineBecameReady = await isLineFullyDone(prisma, step.orderLineId);
                orderBecameReady = await autoMarkOrderReady(prisma, step.orderLine.orderId);
            }

            return reply.send({ ...updated, orderBecameReady, lineBecameReady, orderId: step.orderLine.orderId, orderLineId: step.orderLineId });
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
                    loadId: null,
                    sessionId: null,
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

    // ─── POST /api/tracking/steps/:stepId/repeat ── Repetir una etapa que no quedó bien ──
    // A diferencia de «deshacer» (corregir un toque equivocado, sin rastro), la
    // pasada que se deshace queda guardada en order_line_step_repeat con sus
    // tiempos. Las etapas posteriores ya hechas también vuelven a pendiente
    // (si el lavado no quedó bien, hay que volver a secar y planchar) y se
    // guardan como rehechas por arrastre (isCause = false).
    fastify.post('/steps/:stepId/repeat', async (req, reply) => {
        const stepId = Number(req.params.stepId);
        const userId = req.user?.userId || null;
        if (isNaN(stepId)) return reply.status(400).send({ error: 'ID inválido' });

        try {
            const step = await prisma.orderLineStep.findUnique({
                where: { id: stepId },
                include: {
                    stepConfig: true, itineraryStep: true,
                    orderLine: { include: { order: { select: { id: true, status: true } } } },
                },
            });
            if (!step) return reply.status(404).send({ error: 'Paso no encontrado' });
            if (step.status !== 'done') return reply.status(400).send({ error: 'Sólo se puede repetir una etapa ya hecha' });
            const order = step.orderLine.order;
            if (order.status === 'collected' || order.status === 'cancelled') {
                return reply.status(400).send({ error: 'El pedido ya está entregado o anulado' });
            }
            if (step.orderLine.voidedAt) return reply.status(400).send({ error: 'La prenda está anulada' });

            const info = getStepInfo(step);
            const lineSteps = await prisma.orderLineStep.findMany({
                where: { orderLineId: step.orderLineId },
                include: { stepConfig: true, itineraryStep: true },
            });
            const later = lineSteps.filter(s =>
                s.id !== step.id && s.status !== 'pending' && getStepInfo(s).position > info.position
            );
            const now = new Date();

            await prisma.$transaction(async (tx) => {
                for (const s of [step, ...later]) {
                    await tx.orderLineStepRepeat.create({
                        data: {
                            orderLineStepId: s.id,
                            startedAt: s.startedAt,
                            completedAt: s.completedAt,
                            completedBy: s.completedBy,
                            repeatedAt: now,
                            repeatedBy: userId,
                            isCause: s.id === step.id,
                        },
                    });
                }
                await tx.orderLineStep.updateMany({
                    where: { id: { in: [step.id, ...later.map(s => s.id)] } },
                    data: { status: 'pending', startedAt: null, completedAt: null, completedBy: null, loadId: null, sessionId: null },
                });
                if (order.status === 'ready') {
                    await tx.order.update({ where: { id: order.id }, data: { status: 'pending' } });
                }
            });

            return reply.send({
                ok: true,
                stepLabel: info.stepLabel,
                reset: 1 + later.length,
                orderBackToPending: order.status === 'ready',
            });
        } catch (err) {
            console.error('Error en POST /tracking/steps/:stepId/repeat:', err);
            return reply.status(500).send({ error: 'Error repitiendo la etapa' });
        }
    });

    // ─── PUT /api/tracking/lines/:lineId/itinerary ── Cambiar el itinerario de una prenda ──
    // Para corregir el del mostrador. Las etapas hechas se conservan (aunque el
    // itinerario nuevo no las tenga: el trabajo se hizo); una en curso se
    // conserva si el itinerario nuevo la tiene. Las pendientes se sustituyen por
    // las del itinerario nuevo que falten.
    fastify.put('/lines/:lineId/itinerary', async (req, reply) => {
        const lineId = Number(req.params.lineId);
        const itineraryId = Number(req.body?.itineraryId);
        const optionalStepIds = (req.body?.optionalStepIds || []).map(Number);
        if (isNaN(lineId) || !itineraryId) return reply.status(400).send({ error: 'Datos inválidos' });

        try {
            const line = await prisma.orderLine.findUnique({
                where: { id: lineId },
                include: {
                    order: { select: { id: true, status: true } },
                    steps: { include: { stepConfig: true, itineraryStep: true } },
                },
            });
            if (!line) return reply.status(404).send({ error: 'Prenda no encontrada' });
            if (line.voidedAt) return reply.status(400).send({ error: 'La prenda está anulada' });
            if (line.order.status === 'collected' || line.order.status === 'cancelled') {
                return reply.status(400).send({ error: 'El pedido ya está entregado o anulado' });
            }

            const itinerary = await prisma.itinerary.findUnique({
                where: { id: itineraryId },
                include: { steps: { orderBy: { position: 'asc' } } },
            });
            if (!itinerary || !itinerary.isActive || itinerary.steps.length === 0) {
                return reply.status(400).send({ error: 'Itinerario no disponible' });
            }

            const wanted = itinerary.steps.filter(s => !s.isOptional || optionalStepIds.includes(s.id));
            const wantedKeys = new Set(wanted.map(s => s.stepKey));
            const keep = line.steps.filter(s =>
                s.status === 'done' || (s.status === 'in_progress' && wantedKeys.has(getStepInfo(s).stepKey))
            );
            const keptKeys = new Set(keep.map(s => getStepInfo(s).stepKey));
            const toDelete = line.steps.filter(s => !keep.includes(s)).map(s => s.id);
            const toCreate = wanted.filter(s => !keptKeys.has(s.stepKey));

            await prisma.$transaction(async (tx) => {
                if (toDelete.length) await tx.orderLineStep.deleteMany({ where: { id: { in: toDelete } } });
                for (const s of toCreate) {
                    await tx.orderLineStep.create({
                        data: { orderLineId: lineId, itineraryStepId: s.id, status: 'pending' },
                    });
                }
                await tx.orderLine.update({ where: { id: lineId }, data: { itineraryId } });
                if (toCreate.length && line.order.status === 'ready') {
                    await tx.order.update({ where: { id: line.order.id }, data: { status: 'pending' } });
                }
            });

            // Si con el cambio ya no le queda nada a la prenda, el pedido puede quedar listo.
            const orderBecameReady = toCreate.length === 0 && await autoMarkOrderReady(prisma, line.order.id);
            return reply.send({ ok: true, itinerary: { id: itinerary.id, name: itinerary.name }, created: toCreate.length, orderBecameReady });
        } catch (err) {
            console.error('Error en PUT /tracking/lines/:lineId/itinerary:', err);
            return reply.status(500).send({ error: 'Error cambiando el itinerario' });
        }
    });

    // ═══ Cargas de máquina y tendidos (sql/039) ═══

    // Prendas de la carga que han dejado la prenda o el pedido terminados: el
    // taller imprime con esto sus etiquetas, igual que al completar en lote.
    async function listosTrasCompletar(stepIds) {
        const pasos = await prisma.orderLineStep.findMany({
            where: { id: { in: stepIds } },
            select: { orderLineId: true, orderLine: { select: { orderId: true } } },
        });
        const readyLineIds = [];
        for (const lid of [...new Set(pasos.map(p => p.orderLineId))]) {
            if (await isLineFullyDone(prisma, lid)) readyLineIds.push(lid);
        }
        const readyOrderIds = [];
        for (const oid of [...new Set(pasos.map(p => p.orderLine.orderId))]) {
            if (await autoMarkOrderReady(prisma, oid)) readyOrderIds.push(oid);
        }
        return { readyLineIds, readyOrderIds };
    }

    // ─── POST /api/tracking/loads ── Cargar una máquina (o tender) ──
    // stepIds: el paso actual de cada prenda. Si es de esta máquina, entra en la
    // carga; si es la etapa justo anterior (pretratamiento), se da por hecha
    // (con la tanda, si hay) y entra la siguiente.
    fastify.post('/loads', async (req, reply) => {
        const userId = req.user?.userId || null;
        const { resourceKey, unitNo = 1, programId = null, durationMin = null, stepIds = [] } = req.body || {};
        if (!resourceKey || !Array.isArray(stepIds) || stepIds.length === 0) {
            return reply.status(400).send({ error: 'Faltan la máquina o las prendas' });
        }
        try {
            const recurso = await prisma.resourceConfig.findUnique({ where: { resourceKey } });
            if (!recurso || !['maquina', 'tendido'].includes(recurso.resourceKind)) {
                return reply.status(400).send({ error: 'Ese recurso no es una máquina ni un tendedero' });
            }
            const unidad = Math.max(1, Math.min(Number(unitNo) || 1, recurso.units || 1));
            if (recurso.resourceKind === 'maquina') {
                const ocupada = await prisma.machineLoad.findFirst({ where: { resourceKey, unitNo: unidad, finishedAt: null } });
                if (ocupada) return reply.status(409).send({ error: `${recurso.label} ${unidad} ya tiene una carga dentro` });
            }
            let programa = null;
            if (programId) {
                programa = await prisma.resourceProgram.findFirst({ where: { id: Number(programId), resourceKey } });
                if (!programa) return reply.status(400).send({ error: 'Programa no válido' });
            }
            const duracion = programa ? programa.durationMin : Math.max(1, Number(durationMin) || recurso.cycleDurationMin || 1);

            const pasos = await prisma.orderLineStep.findMany({
                where: { id: { in: stepIds.map(Number) } },
                include: {
                    stepConfig: true, itineraryStep: true,
                    orderLine: { include: { steps: { include: { stepConfig: true, itineraryStep: true } } } },
                },
            });
            const aCompletar = [];
            const aCargar = [];
            for (const paso of pasos) {
                if (paso.status === 'done') continue;
                const info = getStepInfo(paso);
                if (info.resourceKey === resourceKey) {
                    if (paso.loadId) continue; // ya está en una carga
                    aCargar.push(paso.id);
                    continue;
                }
                const siguiente = paso.orderLine.steps
                    .filter(s => s.status !== 'done' && s.id !== paso.id && getStepInfo(s).position > info.position)
                    .sort((a, b) => getStepInfo(a).position - getStepInfo(b).position)[0];
                if (!siguiente || getStepInfo(siguiente).resourceKey !== resourceKey) {
                    return reply.status(400).send({ error: `Una de las prendas no va ahora a ${recurso.label}` });
                }
                aCompletar.push(paso);
                aCargar.push(siguiente.id);
            }
            if (aCargar.length === 0) return reply.status(400).send({ error: 'Ninguna de esas prendas se puede cargar' });

            const now = new Date();
            const carga = await prisma.$transaction(async (tx) => {
                const nueva = await tx.machineLoad.create({
                    data: {
                        resourceKey, unitNo: unidad,
                        programId: programa?.id || null, programName: programa?.name || null,
                        durationMin: duracion, startedAt: now, startedBy: userId,
                    },
                });
                await completarPasos(tx, aCompletar, userId, now);
                await tx.orderLineStep.updateMany({
                    where: { id: { in: aCargar } },
                    data: { status: 'in_progress', startedAt: now, completedAt: null, completedBy: null, loadId: nueva.id },
                });
                return nueva;
            });
            return reply.status(201).send({ ...carga, stepIds: aCargar, completedStepIds: aCompletar.map(p => p.id) });
        } catch (err) {
            console.error('Error en POST /tracking/loads:', err);
            return reply.status(500).send({ error: 'Error cargando la máquina' });
        }
    });

    // ─── POST /api/tracking/loads/:id/finish ── Sacar de la máquina / recoger ──
    fastify.post('/loads/:id/finish', async (req, reply) => {
        const id = Number(req.params.id);
        const userId = req.user?.userId || null;
        try {
            const carga = await prisma.machineLoad.findUnique({ where: { id } });
            if (!carga) return reply.status(404).send({ error: 'Carga no encontrada' });
            if (carga.finishedAt) return reply.status(400).send({ error: 'Esa carga ya se sacó' });
            const now = new Date();
            const pasos = await prisma.orderLineStep.findMany({ where: { loadId: id, status: { not: 'done' } }, select: { id: true } });
            const ids = pasos.map(p => p.id);
            await prisma.$transaction([
                prisma.machineLoad.update({ where: { id }, data: { finishedAt: now, finishedBy: userId } }),
                prisma.orderLineStep.updateMany({
                    where: { id: { in: ids } },
                    data: { status: 'done', completedAt: now, completedBy: userId },
                }),
            ]);
            const listos = await listosTrasCompletar(ids);
            return reply.send({ ok: true, stepIds: ids, ...listos });
        } catch (err) {
            console.error('Error en POST /tracking/loads/:id/finish:', err);
            return reply.status(500).send({ error: 'Error sacando la carga' });
        }
    });

    // ─── POST /api/tracking/loads/:id/reopen ── Deshacer «Sacar» ──
    fastify.post('/loads/:id/reopen', async (req, reply) => {
        const id = Number(req.params.id);
        try {
            const carga = await prisma.machineLoad.findUnique({
                where: { id },
                include: { steps: { select: { id: true, orderLine: { select: { orderId: true } } } } },
            });
            if (!carga || !carga.finishedAt) return reply.status(400).send({ error: 'Esa carga no está sacada' });
            const orderIds = [...new Set(carga.steps.map(s => s.orderLine.orderId))];
            await prisma.$transaction([
                prisma.machineLoad.update({ where: { id }, data: { finishedAt: null, finishedBy: null } }),
                prisma.orderLineStep.updateMany({
                    where: { loadId: id },
                    data: { status: 'in_progress', completedAt: null, completedBy: null },
                }),
                prisma.order.updateMany({ where: { id: { in: orderIds }, status: 'ready' }, data: { status: 'pending' } }),
            ]);
            return reply.send({ ok: true });
        } catch (err) {
            console.error('Error en POST /tracking/loads/:id/reopen:', err);
            return reply.status(500).send({ error: 'Error deshaciendo' });
        }
    });

    // ─── POST /api/tracking/loads/:id/cancel ── Anular una carga (se cargó por error) ──
    // Las prendas vuelven a esperar la máquina. Un pretratamiento que se dio por
    // hecho al cargar sigue hecho: el trabajo se hizo.
    fastify.post('/loads/:id/cancel', async (req, reply) => {
        const id = Number(req.params.id);
        try {
            const carga = await prisma.machineLoad.findUnique({ where: { id } });
            if (!carga) return reply.status(404).send({ error: 'Carga no encontrada' });
            if (carga.finishedAt) return reply.status(400).send({ error: 'Esa carga ya se sacó' });
            await prisma.$transaction([
                prisma.orderLineStep.updateMany({
                    where: { loadId: id },
                    data: { status: 'pending', startedAt: null, completedAt: null, completedBy: null, loadId: null },
                }),
                prisma.machineLoad.delete({ where: { id } }),
            ]);
            return reply.send({ ok: true });
        } catch (err) {
            console.error('Error en POST /tracking/loads/:id/cancel:', err);
            return reply.status(500).send({ error: 'Error anulando la carga' });
        }
    });

    // ═══ Tandas de trabajo de persona (sql/039) ═══

    // ─── POST /api/tracking/sessions ── Empezar tanda en una fase ──
    fastify.post('/sessions', async (req, reply) => {
        const stepKey = String(req.body?.stepKey || '').trim();
        if (!stepKey) return reply.status(400).send({ error: 'Falta la fase' });
        try {
            const abierta = await prisma.workSession.findFirst({ where: { stepKey, endedAt: null } });
            if (abierta) return reply.send(abierta);
            const now = new Date();
            const tanda = await prisma.workSession.create({
                data: { stepKey, startedAt: now, lastMarkAt: now, startedBy: req.user?.userId || null },
            });
            return reply.status(201).send(tanda);
        } catch (err) {
            console.error('Error en POST /tracking/sessions:', err);
            return reply.status(500).send({ error: 'Error empezando la tanda' });
        }
    });

    // ─── POST /api/tracking/sessions/:id/(pause|resume|end) ──
    // Al seguir tras una pausa, la marca se pone en ese momento: la pausa no cuenta.
    fastify.post('/sessions/:id/:accion', async (req, reply) => {
        const id = Number(req.params.id);
        const accion = req.params.accion;
        if (!['pause', 'resume', 'end'].includes(accion)) return reply.status(404).send({ error: 'Acción no válida' });
        try {
            const tanda = await prisma.workSession.findUnique({ where: { id } });
            if (!tanda || tanda.endedAt) return reply.status(400).send({ error: 'Esa tanda ya terminó' });
            const now = new Date();
            const data = accion === 'pause' ? { pausedAt: now }
                : accion === 'resume' ? { pausedAt: null, lastMarkAt: now }
                    : { endedAt: now };
            return reply.send(await prisma.workSession.update({ where: { id }, data }));
        } catch (err) {
            console.error('Error en POST /tracking/sessions/:id:', err);
            return reply.status(500).send({ error: 'Error en la tanda' });
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

            let updated;
            if (action === 'start') {
                updated = await prisma.orderLineStep.updateMany({
                    where: { id: { in: stepIds.map(Number) } },
                    data
                });
            } else {
                const pasos = await prisma.orderLineStep.findMany({
                    where: { id: { in: stepIds.map(Number) } },
                    include: { stepConfig: true, itineraryStep: true },
                });
                await completarPasos(prisma, pasos, userId, now);
                updated = { count: pasos.length };
            }

            // Auto-marcar pedidos como "ready" si se completaron
            const readyOrderIds = [];
            const readyLineIds = [];
            if (action === 'complete') {
                const affectedSteps = await prisma.orderLineStep.findMany({
                    where: { id: { in: stepIds.map(Number) } },
                    include: { orderLine: { select: { id: true, orderId: true } } }
                });
                // Prendas (líneas) que han quedado totalmente finalizadas
                const lineIds = [...new Set(affectedSteps.map(s => s.orderLineId))];
                for (const lid of lineIds) {
                    if (await isLineFullyDone(prisma, lid)) readyLineIds.push(lid);
                }
                // Pedidos que han pasado a "ready"
                const orderIds = [...new Set(affectedSteps.map(s => s.orderLine.orderId))];
                for (const oid of orderIds) {
                    const became = await autoMarkOrderReady(prisma, oid);
                    if (became) readyOrderIds.push(oid);
                }
            }

            return reply.send({ count: updated.count, readyOrderIds, readyLineIds });
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
            // Tope de carga diaria y cómo se comparan los días del último año
            // con los pesos actuales, para calibrarlo desde la pantalla.
            const [loadMax, loadStats, tramos] = await Promise.all([
                leerCargaMaxima(prisma),
                estadisticaCargaHistorica(prisma).catch((e) => { console.error('Error calculando carga histórica:', e); return null; }),
                leerSuplementoUrgencia(prisma),
            ]);
            return reply.send({ weekly, exceptions, loadMax, loadStats, urgencyPctPerDay: tramos.pctPorDia, urgencyMaxPct: tramos.pctMax });
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

        // array de 7 objetos (+ tope de carga diaria y tramos del suplemento de urgencia, opcionales)
        const { weekly, loadMax, urgencyPctPerDay, urgencyMaxPct } = req.body;
        if (!Array.isArray(weekly)) return reply.status(400).send({ error: 'weekly debe ser un array' });

        try {
            if (loadMax !== undefined) await guardarCargaMaxima(prisma, loadMax);
            if (urgencyPctPerDay !== undefined || urgencyMaxPct !== undefined) {
                await guardarSuplementoUrgencia(prisma, { pctPorDia: urgencyPctPerDay, pctMax: urgencyMaxPct });
            }
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

        const { date, isWorking, startTime, endTime, capacityMin, label, loadMax } = req.body;
        if (!date) return reply.status(400).send({ error: 'date es obligatorio' });
        // Tope de carga propio del día (sólo tiene sentido abierto); null = el general
        const tope = isWorking && Number(loadMax) > 0 ? Number(loadMax) : null;

        try {
            const exception = await prisma.workScheduleException.upsert({
                where: { date: new Date(date) },
                update: { isWorking: isWorking ?? false, startTime, endTime, capacityMin: capacityMin || 0, label, loadMax: tope },
                create: { date: new Date(date), isWorking: isWorking ?? false, startTime, endTime, capacityMin: capacityMin || 0, label, loadMax: tope }
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
            const resources = await prisma.resourceConfig.findMany({
                include: { programs: { where: { isActive: true }, orderBy: [{ position: 'asc' }, { durationMin: 'asc' }] } },
            });
            return reply.send(resources);
        } catch (err) {
            return reply.status(500).send({ error: 'Error cargando recursos' });
        }
    });

    // ─── POST /api/tracking/resources ── Crear recurso ──
    fastify.post('/resources', async (req, reply) => {
        if (req.user?.role !== 'admin') return reply.status(403).send({ error: 'Solo administradores' });

        const { resourceKey, label, units, processingMode, batchCapacity, cycleDurationMin, capacityUnit, resourceKind } = req.body;
        if (!resourceKey || !label) return reply.status(400).send({ error: 'resourceKey y label son obligatorios' });

        try {
            const resource = await prisma.resourceConfig.create({
                data: {
                    resourceKey,
                    label,
                    units: units || 1,
                    processingMode: processingMode || 'individual',
                    batchCapacity: batchCapacity != null && batchCapacity !== '' ? Math.max(0, Number(batchCapacity) || 0) : 1,
                    cycleDurationMin: cycleDurationMin || 0,
                    capacityUnit: capacityUnit || 'items',
                    resourceKind: TIPOS_RECURSO.includes(resourceKind) ? resourceKind
                        : (processingMode === 'batch' ? 'maquina' : 'persona'),
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
        const { label, units, processingMode, batchCapacity, cycleDurationMin, capacityUnit, resourceKind } = req.body;

        try {
            const data = {};
            if (resourceKind !== undefined && TIPOS_RECURSO.includes(resourceKind)) data.resourceKind = resourceKind;
            if (label !== undefined) data.label = label;
            if (units !== undefined) data.units = Number(units);
            if (processingMode !== undefined) data.processingMode = processingMode;
            if (batchCapacity !== undefined) data.batchCapacity = Math.max(0, Number(batchCapacity) || 0); // 0 = sin límite
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

    // ─── PUT /api/tracking/resources/:id/programs ── Programas de una máquina ──
    // Recibe la lista completa [{ id?, name, durationMin }]. Los que faltan se
    // desactivan (no se borran: las cargas antiguas los citan).
    fastify.put('/resources/:id/programs', async (req, reply) => {
        if (req.user?.role !== 'admin') return reply.status(403).send({ error: 'Solo administradores' });
        const id = Number(req.params.id);
        const lista = Array.isArray(req.body?.programs) ? req.body.programs : null;
        if (!lista) return reply.status(400).send({ error: 'Falta la lista de programas' });
        const limpios = lista
            .map((p, i) => ({ id: Number(p.id) || null, name: String(p.name || '').trim().slice(0, 60), durationMin: Math.round(Number(p.durationMin)), position: i }))
            .filter(p => p.name && p.durationMin > 0);
        try {
            const recurso = await prisma.resourceConfig.findUnique({ where: { id } });
            if (!recurso) return reply.status(404).send({ error: 'Recurso no encontrado' });
            const actuales = await prisma.resourceProgram.findMany({ where: { resourceKey: recurso.resourceKey } });
            const idsActuales = new Set(actuales.map(p => p.id));
            const seQuedan = new Set(limpios.filter(p => p.id && idsActuales.has(p.id)).map(p => p.id));
            await prisma.$transaction([
                prisma.resourceProgram.updateMany({
                    where: { resourceKey: recurso.resourceKey, id: { notIn: [...seQuedan] } },
                    data: { isActive: false },
                }),
                ...limpios.map(p => (p.id && seQuedan.has(p.id))
                    ? prisma.resourceProgram.update({ where: { id: p.id }, data: { name: p.name, durationMin: p.durationMin, position: p.position, isActive: true } })
                    : prisma.resourceProgram.create({ data: { resourceKey: recurso.resourceKey, name: p.name, durationMin: p.durationMin, position: p.position } })),
            ]);
            const programs = await prisma.resourceProgram.findMany({
                where: { resourceKey: recurso.resourceKey, isActive: true },
                orderBy: [{ position: 'asc' }, { durationMin: 'asc' }],
            });
            return reply.send(programs);
        } catch (err) {
            console.error('Error en PUT /tracking/resources/:id/programs:', err);
            return reply.status(500).send({ error: 'Error guardando los programas' });
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
                        where: { voidedAt: null },
                        select: {
                            id: true, quantity: true, customName: true,
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
                            // Capacidad 0 = sin límite (tendedero): una sola tanda
                    const cycles = resource.batchCapacity > 0 ? Math.ceil(load / resource.batchCapacity) : 1;
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
                    productName: line.customName || line.product?.name || '?',
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

