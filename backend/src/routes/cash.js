// javascript
// Fastify + Prisma (ESM). Sin preHandler local: usa el preHandler global del server.
// Prefijo ya lo añade server: '/api/cash' => aquí solo '/movements', '/close', etc.

const ALLOWED_TYPES = ['sale_cash_in', 'withdrawal', 'deposit', 'refund_cash_out', 'opening', 'correction'];

const toNum = (v) => (v && typeof v.toNumber === 'function' ? v.toNumber() : Number(v));
const toDec = (v) => (v == null ? '0' : String(v));

function signedAmount(type, amount) {
    const out = ['withdrawal', 'refund_cash_out'];
    const n = Math.abs(Number(amount || 0));
    return out.includes(type) ? -n : n;
}

export default async function cashRoutes(fastify) {
    const prisma = fastify.prisma;

    // GET /api/cash/last-closure
    fastify.get('/last-closure', async () => {
        return prisma.cashClosure.findFirst({orderBy: {closedat: 'desc'}});
    });

    // GET /api/cash/movements/unclosed
    fastify.get('/movements/unclosed', async () => {
        return prisma.cashMovement.findMany({
            where: {closureId: null},
            orderBy: {movementat: 'asc'},
            include: {personUser: {select: {id: true, firstName: true, lastName: true, email: true}}},
        });
    });

    // POST /api/cash/movements
    fastify.post('/movements', async (request, reply) => {
        const {type, amount, note, personUserId, person} = request.body || {};
        if (!type || !ALLOWED_TYPES.includes(type)) return reply.code(400).send({error: 'type inválido'});
        const num = Number(amount);
        if (!Number.isFinite(num) || num <= 0) return reply.code(400).send({error: 'amount inválido'});

        const created = await prisma.cashMovement.create({
            data: {
                type,
                amount: toDec(Math.abs(num)),
                userid: person ?? null,
                personUserId: personUserId ?? null,
                note: note || null,
            },
            include: {personUser: {select: {id: true, firstName: true, lastName: true, email: true}}},
        });
        return created;
    });

    // PATCH /api/cash/movements/:id
    fastify.patch('/movements/:id', async (request, reply) => {
        const id = Number(request.params.id);
        if (!Number.isInteger(id)) return reply.code(400).send({error: 'id inválido'});

        const current = await prisma.cashMovement.findUnique({where: {id}});
        if (!current) return reply.code(404).send({error: 'Movimiento no encontrado'});
        if (current.closureId) return reply.code(400).send({error: 'Movimiento ya cerrado'});

        const {type, amount, note, personUserId} = request.body || {};
        if (type && !ALLOWED_TYPES.includes(type)) return reply.code(400).send({error: 'type inválido'});
        if (amount !== undefined) {
            const num = Number(amount);
            if (!Number.isFinite(num) || num <= 0) return reply.code(400).send({error: 'amount inválido'});
        }

        const updated = await prisma.cashMovement.update({
            where: {id},
            data: {
                type: type ?? undefined,
                amount: amount !== undefined ? toDec(Math.abs(Number(amount))) : undefined,
                note: note !== undefined ? (note || null) : undefined,
                personUserId: personUserId !== undefined ? (personUserId || null) : undefined,
            },
            include: {personUser: {select: {id: true, firstName: true, lastName: true, email: true}}},
        });
        return updated;
    });

    // DELETE /api/cash/movements/:id
    fastify.delete('/movements/:id', async (request, reply) => {
        const id = Number(request.params.id);
        if (!Number.isInteger(id)) return reply.code(400).send({error: 'id inválido'});

        const current = await prisma.cashMovement.findUnique({where: {id}, select: {closureId: true}});
        if (!current) return reply.code(404).send({error: 'Movimiento no encontrado'});
        if (current.closureId) return reply.code(400).send({error: 'Movimiento ya cerrado'});

        await prisma.cashMovement.delete({where: {id}});
        return {ok: true};
    });

    // POST /api/cash/close
    fastify.post('/close', async (request, reply) => {
        const {countedAmount, notes, user} = request.body || {};
        if (countedAmount === undefined) return reply.code(400).send({error: 'countedAmount requerido'});
        const counted = Number(countedAmount);
        if (!Number.isFinite(counted)) return reply.code(400).send({error: 'countedAmount inválido'});

        const last = await prisma.cashClosure.findFirst({orderBy: {closedat: 'desc'}});
        const openingAmount = last ? toNum(last.countedamount) : 0;

        const moves = await prisma.cashMovement.findMany({
            where: {closureId: null},
            orderBy: {movementat: 'asc'},
        });

        const expected = openingAmount + moves.reduce((acc, m) => acc + signedAmount(m.type, toNum(m.amount)), 0);
        const diff = Number((counted - expected).toFixed(2));

        const closure = await prisma.cashClosure.create({
            data: {
                openingamount: toDec(openingAmount),
                expectedamount: toDec(expected),
                countedamount: toDec(counted),
                diff: toDec(diff),
                userId: user,
                notes: notes || null,
            },
        });

        if (moves.length) {
            await prisma.cashMovement.updateMany({
                where: {id: {in: moves.map((m) => m.id)}},
                data: {closureId: closure.id},
            });
        }
        return {closure, movesIncluded: moves.length};
    });

    // GET /api/cash/closures
    fastify.get('/closures', async (request) => {
        const {from, to} = request.query || {};
        const where = {};
        if (from || to) {
            where.closedat = {};
            if (from) where.closedat.gte = new Date(from);
            if (to) where.closedat.lte = new Date(to);
        }
        return prisma.cashClosure.findMany({where, orderBy: {closedat: 'desc'}});
    });
}