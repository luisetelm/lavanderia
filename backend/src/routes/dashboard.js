// backend/src/routes/dashboard.js
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

            const from = req.query.from ? new Date(req.query.from) : defaultFrom;
            const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : defaultTo;

            if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
                return reply.status(400).send({ error: 'Rango de fechas inválido' });
            }

            // Excluimos pedidos cancelados
            const lines = await prisma.orderLine.findMany({
                where: {
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
     *   - totalDurationMin : suma de tiempos (completedAt - startedAt)
     *   - avgStepMin       : tiempo medio por proceso
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

            // Período anterior de IGUAL duración: termina justo antes de "from"
            const rangeMs = to.getTime() - from.getTime();
            const prevTo = new Date(from.getTime() - 1);
            const prevFrom = new Date(prevTo.getTime() - rangeMs);

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
                    startedAt: true,
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
                        select: { id: true, firstName: true, lastName: true, role: true, isActive: true },
                    },
                },
            });

            const [currentSteps, previousSteps] = await Promise.all([
                loadSteps(from, to),
                loadSteps(prevFrom, prevTo),
            ]);

            const labelOf = (s) => s.stepConfig?.stepLabel || s.itineraryStep?.stepLabel || 'Otro';

            const aggregate = (steps) => {
                const byWorker = new Map();
                let totals = {
                    stepsCompleted: 0,
                    ordersCount: 0,
                    linesCount: 0,
                    totalDurationMin: 0,
                };
                const totalOrders = new Set();
                const totalLines = new Set();

                for (const s of steps) {
                    const wid = s.completedBy;
                    if (!wid) continue;
                    let row = byWorker.get(wid);
                    if (!row) {
                        row = {
                            workerId: wid,
                            name: s.completedByUser
                                ? `${s.completedByUser.firstName || ''} ${s.completedByUser.lastName || ''}`.trim()
                                : `#${wid}`,
                            role: s.completedByUser?.role || null,
                            isActive: s.completedByUser?.isActive ?? true,
                            stepsCompleted: 0,
                            _orders: new Set(),
                            _lines: new Set(),
                            totalDurationMin: 0,
                            _durationsCount: 0,
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
                    if (s.startedAt && s.completedAt) {
                        const min = (new Date(s.completedAt) - new Date(s.startedAt)) / 60000;
                        if (min >= 0 && min < 60 * 24) { // descartamos outliers > 24h
                            row.totalDurationMin += min;
                            row._durationsCount += 1;
                            totals.totalDurationMin += min;
                        }
                    }
                    // Puntualidad: ¿el paso se cerró antes de la fechaLimite del pedido?
                    const limit = s.orderLine?.order?.fechaLimite;
                    if (limit && s.completedAt) {
                        row._onTimeEligible += 1;
                        if (new Date(s.completedAt) <= new Date(limit)) {
                            row._onTime += 1;
                        }
                    }
                    const lbl = labelOf(s);
                    row.byStepLabel[lbl] = (row.byStepLabel[lbl] || 0) + 1;
                }

                const workers = Array.from(byWorker.values()).map(r => ({
                    workerId: r.workerId,
                    name: r.name,
                    role: r.role,
                    isActive: r.isActive,
                    stepsCompleted: r.stepsCompleted,
                    ordersCount: r._orders.size,
                    linesCount: r._lines.size,
                    totalDurationMin: Math.round(r.totalDurationMin),
                    avgStepMin: r._durationsCount > 0
                        ? Number((r.totalDurationMin / r._durationsCount).toFixed(1))
                        : null,
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
                totals.totalDurationMin = Math.round(totals.totalDurationMin);

                return { workers, totals };
            };

            const cur = aggregate(currentSteps);
            const prev = aggregate(previousSteps);

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
                        role: w.role,
                        isActive: w.isActive,
                        current: {
                            workerId: w.workerId, name: w.name,
                            stepsCompleted: 0, ordersCount: 0, linesCount: 0,
                            totalDurationMin: 0, avgStepMin: null, byStepLabel: {},
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
                    totalDurationMin: 0, avgStepMin: null,
                    onTimePct: null, onTimeEligible: 0, onTimeCount: 0,
                };
                return {
                    workerId: row.workerId,
                    name: row.name,
                    role: row.role,
                    isActive: row.isActive,
                    current: {
                        stepsCompleted: c.stepsCompleted,
                        ordersCount:    c.ordersCount,
                        linesCount:     c.linesCount,
                        totalDurationMin: c.totalDurationMin,
                        avgStepMin:     c.avgStepMin,
                        byStepLabel:    c.byStepLabel,
                        onTimePct:      c.onTimePct,
                        onTimeEligible: c.onTimeEligible,
                        onTimeCount:    c.onTimeCount,
                    },
                    previous: {
                        stepsCompleted: p.stepsCompleted,
                        ordersCount:    p.ordersCount,
                        linesCount:     p.linesCount,
                        totalDurationMin: p.totalDurationMin,
                        avgStepMin:     p.avgStepMin,
                        onTimePct:      p.onTimePct,
                    },
                    deltas: {
                        stepsCompletedPct: pct(c.stepsCompleted, p.stepsCompleted),
                        ordersCountPct:    pct(c.ordersCount,    p.ordersCount),
                        linesCountPct:     pct(c.linesCount,     p.linesCount),
                    },
                    sharePct: cur.totals.stepsCompleted > 0
                        ? Number(((c.stepsCompleted / cur.totals.stepsCompleted) * 100).toFixed(1))
                        : 0,
                };
            }).sort((a, b) => b.current.stepsCompleted - a.current.stepsCompleted);

            const days = Math.max(1, Math.round((to - from) / (1000 * 60 * 60 * 24)) + 1);

            return reply.send({
                range:    { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
                previous: { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) },
                totals: {
                    current:  cur.totals,
                    previous: prev.totals,
                    deltas: {
                        stepsCompletedPct: pct(cur.totals.stepsCompleted, prev.totals.stepsCompleted),
                        ordersCountPct:    pct(cur.totals.ordersCount,    prev.totals.ordersCount),
                        linesCountPct:     pct(cur.totals.linesCount,     prev.totals.linesCount),
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
