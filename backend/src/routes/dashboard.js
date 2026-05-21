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
}
