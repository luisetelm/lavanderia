// backend/src/routes/printJobs.js
//
// Cola de impresión: permite que un dispositivo sin impresora (la tablet del
// taller) mande a imprimir en la impresora del ordenador principal.
//
// El flujo es:
//   1. la tablet crea un encargo            POST /api/print-jobs
//   2. el puesto con impresora los reclama  POST /api/print-jobs/claim
//   3. imprime y confirma                   POST /api/print-jobs/:id/done
//                                        o  POST /api/print-jobs/:id/failed
//
// El encargo dice QUÉ imprimir (tipo + pedido), no el contenido ya compuesto:
// así el puesto receptor usa la misma lógica de impresión de siempre.

const TIPOS = ['finished_label', 'garment_label'];

export default async function (fastify) {
    const prisma = fastify.prisma;

    // ─── POST /api/print-jobs ────────────────────────────────────────────────
    // Encola una impresión. Lo llama el dispositivo que NO tiene impresora.
    fastify.post('/', async (req, reply) => {
        const {type, orderId = null, payload = null} = req.body || {};

        if (!TIPOS.includes(type)) {
            return reply.status(400).send({error: `Tipo de impresión inválido. Usa: ${TIPOS.join(', ')}`});
        }
        if (type === 'finished_label' && !orderId) {
            return reply.status(400).send({error: 'Falta el pedido a imprimir.'});
        }

        try {
            if (orderId) {
                const existe = await prisma.order.findUnique({where: {id: Number(orderId)}, select: {id: true}});
                if (!existe) return reply.status(404).send({error: 'Pedido no encontrado'});
            }

            // Si ya hay un encargo igual sin imprimir, no se duplica: en el
            // taller es fácil pulsar dos veces, y dos etiquetas iguales sólo
            // generan confusión.
            const duplicado = await prisma.print_job.findFirst({
                where: {
                    type,
                    orderId: orderId ? Number(orderId) : null,
                    status: {in: ['pending', 'printing']},
                },
            });
            if (duplicado) {
                return reply.send({...duplicado, duplicado: true});
            }

            const job = await prisma.print_job.create({
                data: {
                    type,
                    orderId: orderId ? Number(orderId) : null,
                    payload: payload || undefined,
                    createdBy: req.user?.userId || null,
                },
            });
            return reply.send(job);
        } catch (err) {
            req.log.error(err);
            return reply.status(500).send({error: 'No se pudo encolar la impresión'});
        }
    });

    // ─── POST /api/print-jobs/claim ──────────────────────────────────────────
    // El puesto con impresora reclama encargos pendientes. Body: {puesto, max}
    //
    // El reparto se hace en una sola sentencia con SKIP LOCKED: si hubiera dos
    // puestos con impresora, cada encargo se lo lleva uno solo y nada se
    // imprime por duplicado.
    fastify.post('/claim', async (req, reply) => {
        const {puesto = 'sin-nombre', max = 5} = req.body || {};
        const limite = Math.min(Math.max(Number(max) || 5, 1), 20);

        try {
            const jobs = await prisma.$queryRawUnsafe(`
                UPDATE print_job SET
                    status = 'printing',
                    "claimedBy" = $1,
                    "claimedAt" = now(),
                    attempts = attempts + 1
                WHERE id IN (
                    SELECT id FROM print_job
                    WHERE status = 'pending'
                    ORDER BY "createdAt"
                    FOR UPDATE SKIP LOCKED
                    LIMIT ${limite}
                )
                RETURNING id, type, "orderId", payload, attempts
            `, String(puesto).slice(0, 80));

            return reply.send(jobs);
        } catch (err) {
            req.log.error(err);
            return reply.status(500).send({error: 'No se pudieron reclamar impresiones'});
        }
    });

    // ─── POST /api/print-jobs/:id/done ───────────────────────────────────────
    fastify.post('/:id/done', async (req, reply) => {
        const id = Number(req.params.id);
        if (isNaN(id)) return reply.status(400).send({error: 'ID inválido'});
        try {
            const job = await prisma.print_job.update({
                where: {id},
                data: {status: 'done', doneAt: new Date(), error: null},
            });
            return reply.send(job);
        } catch (err) {
            req.log.error(err);
            return reply.status(500).send({error: 'No se pudo marcar como impreso'});
        }
    });

    // ─── POST /api/print-jobs/:id/failed ─────────────────────────────────────
    // Vuelve a 'pending' para reintentarlo, salvo que ya se haya intentado
    // demasiadas veces: así un encargo imposible no se reintenta sin fin.
    fastify.post('/:id/failed', async (req, reply) => {
        const id = Number(req.params.id);
        if (isNaN(id)) return reply.status(400).send({error: 'ID inválido'});
        const motivo = String(req.body?.error || 'error desconocido').slice(0, 500);

        try {
            const actual = await prisma.print_job.findUnique({where: {id}});
            if (!actual) return reply.status(404).send({error: 'Encargo no encontrado'});

            const agotado = actual.attempts >= 3;
            const job = await prisma.print_job.update({
                where: {id},
                data: {status: agotado ? 'failed' : 'pending', error: motivo},
            });
            return reply.send(job);
        } catch (err) {
            req.log.error(err);
            return reply.status(500).send({error: 'No se pudo registrar el fallo'});
        }
    });

    // ─── GET /api/print-jobs ─────────────────────────────────────────────────
    // Estado de la cola, para poder mirar qué está pasando.
    fastify.get('/', async (req, reply) => {
        const {status} = req.query || {};
        try {
            const jobs = await prisma.print_job.findMany({
                where: status ? {status} : {status: {in: ['pending', 'printing', 'failed']}},
                orderBy: {createdAt: 'desc'},
                take: 100,
                include: {order: {select: {id: true, orderNum: true}}},
            });
            return reply.send(jobs);
        } catch (err) {
            req.log.error(err);
            return reply.status(500).send({error: 'No se pudo consultar la cola'});
        }
    });
}
