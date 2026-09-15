// backend/src/routes/dashboard.js
import { ymd } from '../utils/workCalendar.js';

export default async function dashboardRoutes(fastify) {
    const prisma = fastify.prisma;

    fastify.get('/', async (req, reply) => {
        try {
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

            // Ejecutar todas las queries en paralelo
            const [
                todayOrders,
                pendingOrders,
                readyOrders,
                lastClosure,
                unclosedMovements,
                recentActivity,
            ] = await Promise.all([
                // 1. Pedidos de hoy (para KPIs)
                prisma.order.findMany({
                    where: { createdAt: { gte: todayStart, lte: todayEnd } },
                    select: {
                        id: true,
                        total: true,
                        paid: true,
                        paymentMethod: true,
                        status: true,
                    },
                }),

                // 2. Pedidos pendientes de hacer (status = pending)
                prisma.order.findMany({
                    where: { status: 'pending' },
                    orderBy: [
                        { fechaLimite: 'asc' },
                        { createdAt: 'asc' },
                    ],
                    take: 15,
                    include: {
                        client: { select: { id: true, firstName: true, lastName: true, phone: true, notifyChannel: true } },
                        lines: {
                            select: {
                                id: true,
                                quantity: true,
                                product: { select: { name: true } },
                                 steps: { select: { status: true } },
                            },
                        },
                    },
                }),

                // 3. Pedidos listos para recoger (status = ready)
                prisma.order.findMany({
                    where: { status: 'ready' },
                    orderBy: { updatedAt: 'asc' },
                    take: 15,
                    include: {
                        client: { select: { id: true, firstName: true, lastName: true, phone: true, notifyChannel: true } },
                    },
                }),

                // 4. Último cierre de caja
                prisma.cashClosure.findFirst({
                    orderBy: { closedat: 'desc' },
                    include: {
                        user: { select: { firstName: true, lastName: true } },
                    },
                }),

                // 5. Movimientos de caja sin cerrar
                prisma.cashMovement.findMany({
                    where: { closureId: null },
                    select: { type: true, amount: true },
                }),

                // 6. Actividad reciente: últimos pedidos actualizados
                prisma.order.findMany({
                    orderBy: { updatedAt: 'desc' },
                    take: 10,
                    include: {
                        client: { select: { id: true, firstName: true, lastName: true } },
                    },
                }),
            ]);

            // Calcular KPIs del día
            const todayStats = {
                ordersCount: todayOrders.length,
                totalRevenue: todayOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0),
                paidCount: todayOrders.filter(o => o.paid).length,
                paidRevenue: todayOrders.filter(o => o.paid).reduce((sum, o) => sum + (Number(o.total) || 0), 0),
                unpaidCount: todayOrders.filter(o => !o.paid).length,
                unpaidRevenue: todayOrders.filter(o => !o.paid).reduce((sum, o) => sum + (Number(o.total) || 0), 0),
                cashCount: todayOrders.filter(o => o.paymentMethod === 'cash').length,
                cardCount: todayOrders.filter(o => o.paymentMethod === 'card' || o.paymentMethod === 'card_pos').length,
            };

            // Distribución por estado (todos, no solo hoy)
            const ordersByStatus = {
                pending: pendingOrders.length,  // puede haber más de 15 reales
                ready: readyOrders.length,
            };
            // Contar reales desde la base de datos
            const [pendingCount, readyCount, collectedTodayCount] = await Promise.all([
                prisma.order.count({ where: { status: 'pending' } }),
                prisma.order.count({ where: { status: 'ready' } }),
                prisma.order.count({
                    where: {
                        status: 'collected',
                        updatedAt: { gte: todayStart, lte: todayEnd },
                    },
                }),
            ]);
            ordersByStatus.pending = pendingCount;
            ordersByStatus.ready = readyCount;
            ordersByStatus.collectedToday = collectedTodayCount;

            // Estado de caja
            const outTypes = ['withdrawal', 'refund_cash_out'];
            const toNum = (v) => (v && typeof v.toNumber === 'function' ? v.toNumber() : Number(v));
            const openingAmount = lastClosure ? toNum(lastClosure.countedamount) : 0;
            const movementsTotal = unclosedMovements.reduce((acc, m) => {
                const n = Math.abs(toNum(m.amount));
                return acc + (outTypes.includes(m.type) ? -n : n);
            }, 0);

            const cashStatus = {
                openingAmount,
                currentBalance: Number((openingAmount + movementsTotal).toFixed(2)),
                movementsCount: unclosedMovements.length,
                lastClosureAt: lastClosure?.closedat || null,
                lastClosureBy: lastClosure?.user
                    ? `${lastClosure.user.firstName} ${lastClosure.user.lastName}`
                    : null,
            };


            return reply.send({
                todayStats,
                ordersByStatus,
                pendingOrders: pendingOrders.map(o => {
                    const allSteps = o.lines.flatMap(l => l.steps || []);
                    const hasTracking = allSteps.length > 0;
                    const allStepsDone = hasTracking ? allSteps.every(s => s.status === 'done') : true;
                    return {
                        id: o.id,
                        orderNum: o.orderNum,
                        total: o.total,
                        fechaLimite: o.fechaLimite,
                        createdAt: o.createdAt,
                        status: o.status,
                        client: o.client,
                        linesSummary: o.lines.map(l => `${l.quantity}x ${l.product.name}`).join(', '),
                        linesCount: o.lines.reduce((sum, l) => sum + l.quantity, 0),
                        hasTracking,
                        allStepsDone,
                    };
                }),
                readyOrders: readyOrders.map(o => ({
                    id: o.id,
                    orderNum: o.orderNum,
                    total: o.total,
                    paid: o.paid,
                    updatedAt: o.updatedAt,
                    client: o.client,
                })),
                cashStatus,
                recentActivity: recentActivity.map(o => ({
                    id: o.id,
                    orderNum: o.orderNum,
                    total: o.total,
                    status: o.status,
                    paid: o.paid,
                    updatedAt: o.updatedAt,
                    client: o.client,
                })),
            });
        } catch (err) {
            console.error('Error en GET /api/dashboard:', err);
            return reply.status(500).send({ error: 'Error al obtener datos del dashboard' });
        }
    });

    /**
     * GET /api/dashboard/top-products
     * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=10&groupBy=month|range
     *
     * Devuelve productos más pedidos agrupados por mes (groupBy=month) o totalizados
     * en el rango completo (groupBy=range).
     *
     * Estructura de respuesta:
     *   {
     *     range: { from, to, groupBy },
     *     months: [
     *       { month: '2026-03', label: 'Marzo 2026', totalQty, totalRevenue, items: [{productId, productName, qty, revenue}] }
     *     ]
     *   }
     */
    fastify.get('/top-products', async (req, reply) => {
        try {
            const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
            const groupBy = req.query.groupBy === 'range' ? 'range' : 'month';

            const now = new Date();
            // Por defecto: últimos 6 meses naturales
            const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1);
            const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

            const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000`) : defaultFrom;
            const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : defaultTo;

            if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
                return reply.status(400).send({ error: 'Rango de fechas inválido' });
            }

            // Excluimos pedidos cancelados y líneas anuladas al ajustar un pedido
            const lines = await prisma.orderLine.findMany({
                where: {
                    voidedAt: null,
                    order: {
                        createdAt: { gte: from, lte: to },
                        status: { not: 'cancelled' },
                    },
                },
                select: {
                    quantity: true,
                    unitPrice: true,
                    discount: true,
                    productId: true,
                    product: { select: { id: true, name: true } },
                    order: { select: { createdAt: true } },
                },
            });

            // Agrupar por (mes, producto) o (rango, producto)
            const bucketMap = new Map(); // key = bucketKey -> Map<productId, {qty, revenue, name}>

            const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const monthLabel = (key) => {
                const [y, m] = key.split('-').map(Number);
                const date = new Date(y, m - 1, 1);
                return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
            };

            for (const l of lines) {
                const created = l.order?.createdAt ? new Date(l.order.createdAt) : null;
                if (!created) continue;
                const key = groupBy === 'month' ? monthKey(created) : 'all';
                if (!bucketMap.has(key)) bucketMap.set(key, new Map());
                const productAcc = bucketMap.get(key);

                const pid = l.productId;
                if (!pid) continue;
                const qty = Number(l.quantity) || 0;
                const unit = Number(l.unitPrice) || 0;
                const disc = Number(l.discount) || 0;
                const revenue = qty * unit * (1 - disc / 100);

                const entry = productAcc.get(pid) || {
                    productId: pid,
                    productName: l.product?.name || `#${pid}`,
                    qty: 0,
                    revenue: 0,
                };
                entry.qty += qty;
                entry.revenue += revenue;
                productAcc.set(pid, entry);
            }

            // Construir array ordenado por mes ascendente
            const buckets = Array.from(bucketMap.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, productAcc]) => {
                    const items = Array.from(productAcc.values())
                        .sort((a, b) => b.qty - a.qty)
                        .slice(0, limit)
                        .map(it => ({
                            ...it,
                            qty: Math.round(it.qty),
                            revenue: Number(it.revenue.toFixed(2)),
                        }));
                    const totalQty = items.reduce((s, it) => s + it.qty, 0);
                    const totalRevenue = Number(items.reduce((s, it) => s + it.revenue, 0).toFixed(2));
                    return {
                        month: key,
                        label: groupBy === 'month' ? monthLabel(key) : 'Rango completo',
                        totalQty,
                        totalRevenue,
                        items,
                    };
                });

            return reply.send({
                range: {
                    from: from.toISOString().slice(0, 10),
                    to: to.toISOString().slice(0, 10),
                    groupBy,
                    limit,
                },
                months: buckets,
            });
        } catch (err) {
            console.error('Error en GET /api/dashboard/top-products:', err);
            return reply.status(500).send({ error: 'Error obteniendo top productos' });
        }
    });

    /**
     * GET /api/dashboard/worker-performance
     * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
     *
     * Devuelve, para el rango pedido y el rango anterior de igual duración,
     * el rendimiento de cada trabajadora basado en los pasos (OrderLineStep)
     * que ha completado.
     *
     * Métricas por trabajadora y período:
     *   - stepsCompleted   : nº de procesos cerrados (status=done)
     *   - ordersCount      : nº de pedidos distintos en los que intervino
     *   - linesCount       : nº de líneas (prendas) distintas tocadas
     *   - onTimePct        : % de procesos cerrados el día de entrega o antes
     *
     * No hay tiempos por proceso: en el taller se pulsa «Completar» sin «Iniciar»
     * y completedAt - startedAt sale a cero. Los tiempos contados desde el alta
     * del pedido están en la ficha de cada producto (GET /api/products/:id/times).
     *   - byStepLabel      : { 'Lavado': 12, 'Planchado': 7, ... }
     */
    fastify.get('/worker-performance', async (req, reply) => {
        try {
            const now = new Date();
            const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            const defaultFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);

            const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000`) : defaultFrom;
            const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : defaultTo;

            if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
                return reply.status(400).send({ error: 'Rango de fechas inválido' });
            }

            // Período anterior de IGUAL nº de días, terminando el día antes de "from".
            // Se construye por días locales y no restando milisegundos, para que el
            // cambio de hora no lo desplace.
            const days = Math.max(1, Math.round((to - from) / (1000 * 60 * 60 * 24)));
            const prevFrom = new Date(from.getFullYear(), from.getMonth(), from.getDate() - days, 0, 0, 0, 0);
            const prevTo = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1, 23, 59, 59, 999);

            // Carga de pasos completados en ambos rangos
            const loadSteps = (gte, lte) => prisma.orderLineStep.findMany({
                where: {
                    status: 'done',
                    completedBy: { not: null },
                    completedAt: { gte, lte },
                },
                select: {
                    id: true,
                    orderLineId: true,
                    completedAt: true,
                    completedBy: true,
                    stepConfig:    { select: { stepLabel: true } },
                    itineraryStep: { select: { stepLabel: true } },
                    orderLine:     {
                        select: {
                            orderId: true,
                            order: { select: { fechaLimite: true } },
                        },
                    },
                    completedByUser: {
                        select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true },
                    },
                },
            });

            const [currentSteps, previousSteps] = await Promise.all([
                loadSteps(from, to),
                loadSteps(prevFrom, prevTo),
            ]);

            // ---- Métrica "Pedidos finalizados" ----
            // Un pedido se considera finalizado en un período cuando TODOS sus pasos están cerrados
            // y el ÚLTIMO de esos pasos (por completedAt) cae dentro del período.
            // La trabajadora que cierra ese último paso recibe el crédito.
            const touchedOrderIds = [...new Set(
                [...currentSteps, ...previousSteps]
                    .map(s => s.orderLine?.orderId)
                    .filter(Boolean)
            )];

            let allOrderSteps = [];
            const orderTotalsMap = new Map();
            if (touchedOrderIds.length > 0) {
                allOrderSteps = await prisma.orderLineStep.findMany({
                    where: { orderLine: { orderId: { in: touchedOrderIds } } },
                    select: {
                        status: true,
                        completedAt: true,
                        completedBy: true,
                        orderLine: { select: { orderId: true } },
                    },
                });
                const orderRows = await prisma.order.findMany({
                    where: { id: { in: touchedOrderIds } },
                    select: { id: true, total: true },
                });
                for (const o of orderRows) {
                    orderTotalsMap.set(o.id, Number(o.total) || 0);
                }
            }

            const stepsByOrder = new Map();
            for (const s of allOrderSteps) {
                const oid = s.orderLine?.orderId;
                if (!oid) continue;
                if (!stepsByOrder.has(oid)) stepsByOrder.set(oid, []);
                stepsByOrder.get(oid).push(s);
            }

            const computeFinished = (gte, lte) => {
                const perWorker = new Map();
                const perWorkerAmount = new Map();
                let total = 0;
                let totalAmount = 0;
                for (const [orderId, steps] of stepsByOrder.entries()) {
                    if (!steps.length) continue;
                    if (!steps.every(s => s.status === 'done' && s.completedAt)) continue;
                    const last = steps.reduce((a, b) =>
                        new Date(a.completedAt) >= new Date(b.completedAt) ? a : b
                    );
                    const t = new Date(last.completedAt);
                    if (t < gte || t > lte) continue;
                    const amount = orderTotalsMap.get(orderId) || 0;
                    total += 1;
                    totalAmount += amount;
                    if (last.completedBy) {
                        perWorker.set(last.completedBy, (perWorker.get(last.completedBy) || 0) + 1);
                        perWorkerAmount.set(last.completedBy, (perWorkerAmount.get(last.completedBy) || 0) + amount);
                    }
                }
                return { perWorker, perWorkerAmount, total, totalAmount };
            };

            const finishedCur = computeFinished(from, to);
            const finishedPrev = computeFinished(prevFrom, prevTo);

            const labelOf = (s) => s.stepConfig?.stepLabel || s.itineraryStep?.stepLabel || 'Otro';

            const aggregate = (steps) => {
                const byWorker = new Map();
                let totals = {
                    stepsCompleted: 0,
                    ordersCount: 0,
                    linesCount: 0,
                    onTimeEligible: 0,
                    onTimeCount: 0,
                };
                const totalOrders = new Set();
                const totalLines = new Set();

                for (const s of steps) {
                    const wid = s.completedBy;
                    if (!wid) continue;
                    let row = byWorker.get(wid);
                    if (!row) {
                        const u = s.completedByUser;
                        const fullName = u
                            ? `${u.firstName || ''} ${u.lastName || ''}`.trim()
                            : '';
                        row = {
                            workerId: wid,
                            name: fullName || u?.email || `#${wid}`,
                            firstName: u?.firstName || null,
                            lastName: u?.lastName || null,
                            email: u?.email || null,
                            role: u?.role || null,
                            isActive: u?.isActive ?? true,
                            stepsCompleted: 0,
                            _orders: new Set(),
                            _lines: new Set(),
                            byStepLabel: {},
                            _onTimeEligible: 0,
                            _onTime: 0,
                        };
                        byWorker.set(wid, row);
                    }
                    row.stepsCompleted += 1;
                    if (s.orderLine?.orderId) {
                        row._orders.add(s.orderLine.orderId);
                        totalOrders.add(s.orderLine.orderId);
                    }
                    if (s.orderLineId) {
                        row._lines.add(s.orderLineId);
                        totalLines.add(s.orderLineId);
                    }
                    // Puntualidad: ¿el paso se cerró el día de entrega o antes? Se
                    // comparan días locales porque fechaLimite se guarda a las 00:00
                    // y con la hora exacta todo lo cerrado ese día contaría como tarde.
                    const limit = s.orderLine?.order?.fechaLimite;
                    if (limit && s.completedAt) {
                        row._onTimeEligible += 1;
                        totals.onTimeEligible += 1;
                        if (ymd(new Date(s.completedAt)) <= ymd(new Date(limit))) {
                            row._onTime += 1;
                            totals.onTimeCount += 1;
                        }
                    }
                    const lbl = labelOf(s);
                    row.byStepLabel[lbl] = (row.byStepLabel[lbl] || 0) + 1;
                }

                const workers = Array.from(byWorker.values()).map(r => ({
                    workerId: r.workerId,
                    name: r.name,
                    firstName: r.firstName,
                    lastName: r.lastName,
                    email: r.email,
                    role: r.role,
                    isActive: r.isActive,
                    stepsCompleted: r.stepsCompleted,
                    ordersCount: r._orders.size,
                    linesCount: r._lines.size,
                    byStepLabel: r.byStepLabel,
                    onTimePct: r._onTimeEligible > 0
                        ? Number(((r._onTime / r._onTimeEligible) * 100).toFixed(1))
                        : null,
                    onTimeEligible: r._onTimeEligible,
                    onTimeCount: r._onTime,
                }));

                totals.stepsCompleted = steps.length;
                totals.ordersCount = totalOrders.size;
                totals.linesCount = totalLines.size;
                totals.onTimePct = totals.onTimeEligible > 0
                    ? Number(((totals.onTimeCount / totals.onTimeEligible) * 100).toFixed(1))
                    : null;

                return { workers, totals };
            };

            const cur = aggregate(currentSteps);
            const prev = aggregate(previousSteps);

            // Inyectar ordersFinishedCount en cada worker y en los totales
            const injectFinished = (agg, finished) => {
                for (const w of agg.workers) {
                    w.ordersFinishedCount = finished.perWorker.get(w.workerId) || 0;
                    w.ordersFinishedAmount = Number((finished.perWorkerAmount.get(w.workerId) || 0).toFixed(2));
                }
                agg.totals.ordersFinishedCount = finished.total;
                agg.totals.ordersFinishedAmount = Number((finished.totalAmount || 0).toFixed(2));
            };
            injectFinished(cur, finishedCur);
            injectFinished(prev, finishedPrev);

            // Mezclamos para tener una fila por trabajadora con ambos períodos
            const map = new Map();
            for (const w of cur.workers) {
                map.set(w.workerId, { ...w, current: w, previous: null });
            }
            for (const w of prev.workers) {
                if (!map.has(w.workerId)) {
                    map.set(w.workerId, {
                        workerId: w.workerId,
                        name: w.name,
                        firstName: w.firstName,
                        lastName: w.lastName,
                        email: w.email,
                        role: w.role,
                        isActive: w.isActive,
                        current: {
                            workerId: w.workerId, name: w.name,
                            stepsCompleted: 0, ordersCount: 0, linesCount: 0,
                            byStepLabel: {},
                            onTimePct: null, onTimeEligible: 0, onTimeCount: 0,
                        },
                        previous: w,
                    });
                } else {
                    map.get(w.workerId).previous = w;
                }
            }

            const pct = (a, b) => {
                if (b === 0 || b == null) return a > 0 ? 100 : 0;
                return Number((((a - b) / b) * 100).toFixed(1));
            };

            const workers = Array.from(map.values()).map(row => {
                const c = row.current;
                const p = row.previous || {
                    stepsCompleted: 0, ordersCount: 0, linesCount: 0,
                    onTimePct: null, onTimeEligible: 0, onTimeCount: 0,
                    ordersFinishedCount: 0,
                    ordersFinishedAmount: 0,
                };
                return {
                    workerId: row.workerId,
                    name: row.name,
                    firstName: row.firstName,
                    lastName: row.lastName,
                    email: row.email,
                    role: row.role,
                    isActive: row.isActive,
                    current: {
                        stepsCompleted: c.stepsCompleted,
                        ordersCount:    c.ordersCount,
                        linesCount:     c.linesCount,
                        byStepLabel:    c.byStepLabel,
                        onTimePct:      c.onTimePct,
                        onTimeEligible: c.onTimeEligible,
                        onTimeCount:    c.onTimeCount,
                        ordersFinishedCount: c.ordersFinishedCount || 0,
                        ordersFinishedAmount: c.ordersFinishedAmount || 0,
                    },
                    previous: {
                        stepsCompleted: p.stepsCompleted,
                        ordersCount:    p.ordersCount,
                        linesCount:     p.linesCount,
                        onTimePct:      p.onTimePct,
                        ordersFinishedCount: p.ordersFinishedCount || 0,
                        ordersFinishedAmount: p.ordersFinishedAmount || 0,
                    },
                    deltas: {
                        stepsCompletedPct: pct(c.stepsCompleted, p.stepsCompleted),
                        ordersCountPct:    pct(c.ordersCount,    p.ordersCount),
                        linesCountPct:     pct(c.linesCount,     p.linesCount),
                        ordersFinishedPct: pct(c.ordersFinishedCount || 0, p.ordersFinishedCount || 0),
                        ordersFinishedAmountPct: pct(c.ordersFinishedAmount || 0, p.ordersFinishedAmount || 0),
                    },
                    sharePct: cur.totals.stepsCompleted > 0
                        ? Number(((c.stepsCompleted / cur.totals.stepsCompleted) * 100).toFixed(1))
                        : 0,
                };
            }).sort((a, b) => b.current.stepsCompleted - a.current.stepsCompleted);

            return reply.send({
                // Fechas en hora local: toISOString() daba la de inicio un día antes
                range:    { from: ymd(from), to: ymd(to), days },
                previous: { from: ymd(prevFrom), to: ymd(prevTo) },
                totals: {
                    current:  cur.totals,
                    previous: prev.totals,
                    deltas: {
                        stepsCompletedPct: pct(cur.totals.stepsCompleted, prev.totals.stepsCompleted),
                        ordersCountPct:    pct(cur.totals.ordersCount,    prev.totals.ordersCount),
                        linesCountPct:     pct(cur.totals.linesCount,     prev.totals.linesCount),
                        ordersFinishedPct: pct(cur.totals.ordersFinishedCount || 0, prev.totals.ordersFinishedCount || 0),
                        ordersFinishedAmountPct: pct(cur.totals.ordersFinishedAmount || 0, prev.totals.ordersFinishedAmount || 0),
                    },
                },
                workers,
            });
        } catch (err) {
            console.error('Error en GET /api/dashboard/worker-performance:', err);
            return reply.status(500).send({ error: 'Error obteniendo rendimiento de trabajadoras' });
        }
    });
}
