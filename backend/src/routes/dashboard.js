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
                pendingOrders: pendingOrders.map(o => ({
                    id: o.id,
                    orderNum: o.orderNum,
                    total: o.total,
                    fechaLimite: o.fechaLimite,
                    createdAt: o.createdAt,
                    status: o.status,
                    client: o.client,
                    linesSummary: o.lines.map(l => `${l.quantity}x ${l.product.name}`).join(', '),
                    linesCount: o.lines.reduce((sum, l) => sum + l.quantity, 0),
                })),
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
}

