// javascript
// Fastify + Prisma (ESM). Sin preHandler local: usa el preHandler global del server.
// Prefijo ya lo añade server: '/api/cash' => aquí solo '/movements', '/close', etc.

import puppeteer from 'puppeteer';

const ALLOWED_TYPES = ['sale_cash_in', 'withdrawal', 'deposit', 'refund_cash_out', 'opening', 'correction'];
// Tipos que se pueden crear manualmente desde el frontend. 'sale_cash_in' queda excluido:
// los cobros de pedidos generan su movimiento de caja automáticamente en el backend (POST /orders/:id/pay).
const MANUAL_TYPES = ['withdrawal', 'deposit', 'refund_cash_out', 'opening', 'correction'];

const toNum = (v) => (v && typeof v.toNumber === 'function' ? v.toNumber() : Number(v));
const toDec = (v) => (v == null ? '0' : String(v));

function signedAmount(type, amount) {
    const out = ['withdrawal', 'refund_cash_out'];
    const n = Math.abs(Number(amount || 0));
    return out.includes(type) ? -n : n;
}

export default async function cashRoutes(fastify) {
    const prisma = fastify.prisma;

    // Métodos de pago que NO suponen entrada/salida de efectivo en caja
    const NON_CASH_METHODS = ['card_pos', 'card', 'stripe', 'transfer'];

    // Devuelve la fecha del último cierre (o null si no hay)
    async function getLastClosureDate() {
        const last = await prisma.cashClosure.findFirst({
            orderBy: { closedat: 'desc' },
            select: { closedat: true },
        });
        return last ? last.closedat : null;
    }

    // Pagos no-efectivo registrados desde el último cierre (informativo)
    async function getUnclosedCardPayments() {
        const since = await getLastClosureDate();
        return prisma.payment.findMany({
            where: {
                status: 'completed',
                method: { in: NON_CASH_METHODS },
                ...(since ? { createdAt: { gt: since } } : {}),
            },
            orderBy: { createdAt: 'asc' },
            include: {
                order: { select: { id: true, orderNum: true } },
            },
        });
    }

    // Desglosa una lista de pagos por método: { card_pos: 12.5, transfer: 30, ... }
    function breakdownByMethod(payments) {
        return payments.reduce((acc, p) => {
            const k = p.method || 'card';
            acc[k] = Number(((acc[k] || 0) + Number(p.amount || 0)).toFixed(2));
            return acc;
        }, {});
    }

    // GET /api/cash/last-closure
    fastify.get('/last-closure', async () => {
        return prisma.cashClosure.findFirst({orderBy: {closedat: 'desc'}});
    });

    // GET /api/cash/movements/unclosed
    // Mantenemos el array de movimientos en efectivo (compatibilidad con el frontend actual).
    fastify.get('/movements/unclosed', async () => {
        return prisma.cashMovement.findMany({
            where: {closureId: null},
            orderBy: {movementat: 'asc'},
            include: {personUser: {select: {id: true, firstName: true, lastName: true, email: true}}},
        });
    });

    // GET /api/cash/unclosed-summary
    // Devuelve movimientos en efectivo + pagos con tarjeta pendientes de cierre, listos
    // para mostrar en el modal de cierre.
    fastify.get('/unclosed-summary', async () => {
        const [movements, cardPayments] = await Promise.all([
            prisma.cashMovement.findMany({
                where: {closureId: null},
                orderBy: {movementat: 'asc'},
                include: {
                    personUser: {select: {id: true, firstName: true, lastName: true, email: true}},
                    order: {select: {id: true, orderNum: true}},
                },
            }),
            getUnclosedCardPayments(),
        ]);
        const cardTotal = cardPayments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
        return {
            movements,
            cardPayments,
            cardTotal: Number(cardTotal.toFixed(2)),
            nonCashByMethod: breakdownByMethod(cardPayments),
        };
    });

    // POST /api/cash/movements
    fastify.post('/movements', async (request, reply) => {
        const {type, amount, note, personUserId} = request.body || {};
        if (!type || !MANUAL_TYPES.includes(type)) {
            return reply.code(400).send({error: 'type inválido. Los cobros de pedidos se registran automáticamente al cobrar.'});
        }
        const num = Number(amount);
        if (!Number.isFinite(num) || num <= 0) return reply.code(400).send({error: 'amount inválido'});

        // El autor del movimiento es siempre el usuario autenticado (no se confía en el frontend)
        const userId = request.user?.userId;
        if (!userId) return reply.code(401).send({error: 'No autenticado'});

        const created = await prisma.cashMovement.create({
            data: {
                type,
                amount: toDec(Math.abs(num)),
                userid: userId,                       // quién registra el movimiento
                personUserId: personUserId ?? null,   // persona atribuida (opcional)
                note: note || null,
                orderid: null, // los movimientos manuales no se vinculan a pedidos
            },
            include: {
                user: {select: {id: true, firstName: true, lastName: true, email: true}},
                personUser: {select: {id: true, firstName: true, lastName: true, email: true}},
            },
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

    // GET /api/cash/closures/:id/movements
    fastify.get('/closures/:id/movements', async (request, reply) => {
        const id = Number(request.params.id);
        if (!Number.isInteger(id)) return reply.code(400).send({error: 'id inválido'});

        const closure = await prisma.cashClosure.findUnique({
            where: {id},
            include: {
                user: {select: {id: true, firstName: true, lastName: true}},
            }
        });
        if (!closure) return reply.code(404).send({error: 'Cierre no encontrado'});

        // Cierre anterior para acotar el periodo de los pagos con tarjeta
        const prevClosure = await prisma.cashClosure.findFirst({
            where: {closedat: {lt: closure.closedat}},
            orderBy: {closedat: 'desc'},
            select: {closedat: true},
        });
        const periodFrom = prevClosure ? prevClosure.closedat : new Date(0);

        const [movements, cardPayments] = await Promise.all([
            prisma.cashMovement.findMany({
                where: {closureId: id},
                orderBy: {movementat: 'asc'},
                include: {
                    personUser: {select: {id: true, firstName: true, lastName: true}},
                    order: {select: {id: true, orderNum: true}},
                },
            }),
            prisma.payment.findMany({
                where: {
                    status: 'completed',
                    method: {in: NON_CASH_METHODS},
                    createdAt: {gt: periodFrom, lte: closure.closedat},
                },
                orderBy: {createdAt: 'asc'},
                include: {
                    order: {select: {id: true, orderNum: true}},
                    client: {select: {id: true, firstName: true, lastName: true}},
                },
            }),
        ]);

        const cardTotal = Number(
            cardPayments.reduce((acc, p) => acc + Number(p.amount || 0), 0).toFixed(2)
        );
        const reconciledTotal = Number(
            cardPayments.filter(p => p.reconciled).reduce((acc, p) => acc + Number(p.amount || 0), 0).toFixed(2)
        );

        return {
            closure,
            movements,
            cardPayments,
            cardTotal,
            reconciledTotal,
            pendingTotal: Number((cardTotal - reconciledTotal).toFixed(2)),
            nonCashByMethod: breakdownByMethod(cardPayments),
        };
    });

    // PATCH /api/cash/payments/:id/reconcile
    // Marca/desmarca un pago no-efectivo como conciliado contra el extracto del banco/TPV.
    fastify.patch('/payments/:id/reconcile', async (request, reply) => {
        const id = Number(request.params.id);
        if (!Number.isInteger(id)) return reply.code(400).send({error: 'id inválido'});

        const {reconciled} = request.body || {};
        const value = !!reconciled;

        const payment = await prisma.payment.findUnique({where: {id}, select: {id: true, method: true}});
        if (!payment) return reply.code(404).send({error: 'Pago no encontrado'});
        if (!NON_CASH_METHODS.includes(payment.method)) {
            return reply.code(400).send({error: 'Solo se concilian pagos no en efectivo (TPV, transferencia, etc.)'});
        }

        const updated = await prisma.payment.update({
            where: {id},
            data: {
                reconciled: value,
                reconciledAt: value ? new Date() : null,
                reconciledBy: value ? (request.user?.userId ?? null) : null,
            },
            select: {id: true, reconciled: true, reconciledAt: true, reconciledBy: true},
        });
        return updated;
    });

    // GET /api/cash/closures
    fastify.get('/closures', async (request) => {
        const {from, to} = request.query || {};
        const where = {};
        if (from || to) {
            where.closedat = {};
            if (from) where.closedat.gte = new Date(`${from}T00:00:00.000`);
            if (to)   where.closedat.lte = new Date(`${to}T23:59:59.999`);
        }
        const closures = await prisma.cashClosure.findMany({
            where,
            orderBy: {closedat: 'desc'},
            include: {
                user: {select: {id: true, firstName: true, lastName: true}},
            }
        });

        if (closures.length === 0) return closures;

        // Totales no-efectivo por cierre (en una sola consulta + bucketing por periodo)
        const asc = [...closures].sort((a, b) => new Date(a.closedat) - new Date(b.closedat));
        const oldest = asc[0];
        const newest = asc[asc.length - 1];

        // Inicio del periodo del cierre más antiguo = cierre inmediatamente anterior (puede estar fuera del rango)
        const prevOfOldest = await prisma.cashClosure.findFirst({
            where: {closedat: {lt: oldest.closedat}},
            orderBy: {closedat: 'desc'},
            select: {closedat: true},
        });
        const lowerBound = prevOfOldest ? prevOfOldest.closedat : new Date(0);

        const payments = await prisma.payment.findMany({
            where: {
                status: 'completed',
                method: {in: NON_CASH_METHODS},
                createdAt: {gt: lowerBound, lte: newest.closedat},
            },
            orderBy: {createdAt: 'asc'},
            select: {amount: true, reconciled: true, createdAt: true},
        });

        // Asigna cada pago al primer cierre (asc) cuyo cierre ocurre en/después del pago
        const totals = {}; // closureId -> {card, reconciled}
        asc.forEach(c => { totals[c.id] = {card: 0, reconciled: 0}; });
        for (const p of payments) {
            const created = new Date(p.createdAt).getTime();
            const c = asc.find(cl => new Date(cl.closedat).getTime() >= created);
            if (!c) continue;
            const amt = Number(p.amount || 0);
            totals[c.id].card += amt;
            if (p.reconciled) totals[c.id].reconciled += amt;
        }

        return closures.map(c => {
            const t = totals[c.id] || {card: 0, reconciled: 0};
            const cardTotal = Number(t.card.toFixed(2));
            const reconciledTotal = Number(t.reconciled.toFixed(2));
            return {
                ...c,
                cardTotal,
                reconciledTotal,
                pendingTotal: Number((cardTotal - reconciledTotal).toFixed(2)),
            };
        });
    });

    // Reúne el detalle de un cierre (movimientos en efectivo + pagos no-efectivo del periodo)
    async function getClosureDetail(closure) {
        const prevClosure = await prisma.cashClosure.findFirst({
            where: {closedat: {lt: closure.closedat}},
            orderBy: {closedat: 'desc'},
            select: {closedat: true},
        });
        const periodFrom = prevClosure ? prevClosure.closedat : new Date(0);

        const [movements, cardPayments] = await Promise.all([
            prisma.cashMovement.findMany({
                where: {closureId: closure.id},
                orderBy: {movementat: 'asc'},
                include: {
                    personUser: {select: {id: true, firstName: true, lastName: true}},
                    order: {select: {id: true, orderNum: true}},
                },
            }),
            prisma.payment.findMany({
                where: {
                    status: 'completed',
                    method: {in: NON_CASH_METHODS},
                    createdAt: {gt: periodFrom, lte: closure.closedat},
                },
                orderBy: {createdAt: 'asc'},
                include: {
                    order: {select: {id: true, orderNum: true}},
                    client: {select: {id: true, firstName: true, lastName: true}},
                },
            }),
        ]);
        const cardTotal = Number(cardPayments.reduce((a, p) => a + Number(p.amount || 0), 0).toFixed(2));
        const reconciledTotal = Number(cardPayments.filter(p => p.reconciled).reduce((a, p) => a + Number(p.amount || 0), 0).toFixed(2));
        return {movements, cardPayments, cardTotal, reconciledTotal, pendingTotal: Number((cardTotal - reconciledTotal).toFixed(2))};
    }

    // GET /api/cash/closures/report.pdf?from=&to=
    // Informe en PDF del periodo, con un cierre por página.
    fastify.get('/closures/report.pdf', async (request, reply) => {
        const {from, to} = request.query || {};
        const where = {};
        if (from || to) {
            where.closedat = {};
            if (from) where.closedat.gte = new Date(`${from}T00:00:00.000`);
            if (to)   where.closedat.lte = new Date(`${to}T23:59:59.999`);
        }
        const closures = await prisma.cashClosure.findMany({
            where,
            orderBy: {closedat: 'asc'},
            include: {user: {select: {id: true, firstName: true, lastName: true}}},
        });

        const details = await Promise.all(closures.map(c => getClosureDetail(c)));
        const html = buildClosuresReportHtml({from, to, closures, details});

        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        let pdf;
        try {
            const page = await browser.newPage();
            await page.setContent(html, {waitUntil: 'load'});
            pdf = await page.pdf({format: 'A4', printBackground: true, margin: {top: '14mm', bottom: '14mm', left: '12mm', right: '12mm'}});
        } finally {
            await browser.close();
        }

        const fname = `cierres_${from || 'inicio'}_${to || 'fin'}.pdf`;
        return reply
            .type('application/pdf')
            .header('Content-Disposition', `attachment; filename="${fname}"`)
            .send(pdf);
    });
}

// ── Helpers de presentación para el informe PDF ──
const TYPE_LABELS = {
    sale_cash_in: 'Venta (efectivo)', withdrawal: 'Retirada', deposit: 'Ingreso',
    refund_cash_out: 'Devolución', opening: 'Apertura', correction: 'Corrección',
};
const METHOD_LABELS = {card_pos: 'Tarjeta (TPV)', card: 'Tarjeta', stripe: 'Stripe', transfer: 'Transferencia'};
const isNeg = (t) => ['withdrawal', 'refund_cash_out'].includes(t);
const eur = (n) => `${Number(n || 0).toFixed(2)} €`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fechaCorta = (d) => new Date(d).toLocaleDateString('es-ES', {dateStyle: 'medium'});
const hora = (d) => new Date(d).toLocaleTimeString('es-ES', {hour: '2-digit', minute: '2-digit'});

function buildClosuresReportHtml({from, to, closures, details}) {
    const totalDescuadre = closures.reduce((a, c) => a + Number(c.diff || 0), 0);
    const totalNoEfectivo = details.reduce((a, d) => a + Number(d.cardTotal || 0), 0);
    const totalConciliado = details.reduce((a, d) => a + Number(d.reconciledTotal || 0), 0);

    const pages = closures.map((c, i) => {
        const d = details[i];
        const movRows = (d.movements || []).map(m => {
            const neg = isNeg(m.type);
            return `<tr>
                <td>${hora(m.movementat)}</td>
                <td>${esc(TYPE_LABELS[m.type] || m.type)}</td>
                <td class="r ${neg ? 'neg' : 'pos'}">${neg ? '-' : '+'}${eur(m.amount)}</td>
                <td>${m.order ? '#' + esc(m.order.orderNum) : '-'}</td>
                <td>${m.personUser ? esc(m.personUser.firstName + ' ' + m.personUser.lastName) : '-'}</td>
                <td>${esc(m.note || '-')}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="6" class="muted">Sin movimientos</td></tr>`;

        const payRows = (d.cardPayments || []).map(p => `<tr>
                <td class="c">${p.reconciled ? '☑' : '☐'}</td>
                <td>${hora(p.createdAt)}</td>
                <td>${esc(METHOD_LABELS[p.method] || p.method)}</td>
                <td class="r">${eur(p.amount)}</td>
                <td>${p.order ? '#' + esc(p.order.orderNum) : '-'}</td>
                <td>${p.client ? esc(p.client.firstName + ' ' + p.client.lastName) : '-'}</td>
                <td>${p.reconciledAt ? esc(new Date(p.reconciledAt).toLocaleDateString('es-ES')) : '-'}</td>
            </tr>`).join('') || `<tr><td colspan="7" class="muted">Sin pagos no en efectivo</td></tr>`;

        const diff = Number(c.diff || 0);
        return `<section class="page">
            <div class="head">
                <div>
                    <h2>Cierre de caja</h2>
                    <div class="sub">${esc(fechaCorta(c.closedat))} · ${esc(hora(c.closedat))}</div>
                </div>
                <div class="cajero">Cajero<br><b>${c.user ? esc(c.user.firstName + ' ' + c.user.lastName) : '-'}</b></div>
            </div>

            <div class="cards">
                <div class="kpi"><span>Apertura</span><b>${eur(c.openingamount)}</b></div>
                <div class="kpi"><span>Esperado</span><b>${eur(c.expectedamount)}</b></div>
                <div class="kpi"><span>Contado</span><b>${eur(c.countedamount)}</b></div>
                <div class="kpi ${Math.abs(diff) > 0.01 ? 'bad' : 'good'}"><span>Descuadre</span><b>${diff > 0 ? '+' : ''}${eur(diff)}</b></div>
            </div>

            <h3>Movimientos en efectivo</h3>
            <table>
                <thead><tr><th>Hora</th><th>Tipo</th><th class="r">Importe</th><th>Pedido</th><th>Persona</th><th>Nota</th></tr></thead>
                <tbody>${movRows}</tbody>
            </table>

            <h3>Pagos no en efectivo (conciliación banco/TPV)</h3>
            <div class="totals">
                Total: <b>${eur(d.cardTotal)}</b> ·
                <span class="good">Conciliado: ${eur(d.reconciledTotal)}</span> ·
                <span class="${d.pendingTotal > 0.01 ? 'bad' : 'muted'}">Pendiente: ${eur(d.pendingTotal)}</span>
            </div>
            <table>
                <thead><tr><th class="c">Conc.</th><th>Hora</th><th>Método</th><th class="r">Importe</th><th>Pedido</th><th>Cliente</th><th>Fecha conc.</th></tr></thead>
                <tbody>${payRows}</tbody>
            </table>
            ${c.notes ? `<p class="notes"><b>Notas:</b> ${esc(c.notes)}</p>` : ''}
        </section>`;
    }).join('');

    const empty = closures.length === 0
        ? `<section class="page"><p class="muted" style="text-align:center;margin-top:40px">No hay cierres en el periodo seleccionado.</p></section>`
        : '';

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 11px; margin: 0; }
        h1 { font-size: 18px; margin: 0 0 2px; }
        h2 { font-size: 15px; margin: 0; }
        h3 { font-size: 12px; margin: 16px 0 6px; color: #475569; text-transform: uppercase; letter-spacing: .03em; }
        .cover { margin-bottom: 18px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
        .cover .sub { color: #64748b; font-size: 12px; }
        .cover .resumen { margin-top: 10px; display: flex; gap: 18px; font-size: 12px; }
        .page { page-break-after: always; }
        .page:last-child { page-break-after: auto; }
        .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
        .head .sub { color: #64748b; }
        .cajero { text-align: right; color: #64748b; font-size: 10px; }
        .cards { display: flex; gap: 8px; margin: 12px 0; }
        .kpi { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; text-align: center; }
        .kpi span { display: block; font-size: 9px; text-transform: uppercase; color: #64748b; }
        .kpi b { font-size: 14px; }
        .kpi.bad b { color: #dc2626; } .kpi.good b { color: #16a34a; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #eef2f6; padding: 4px 6px; text-align: left; }
        th { background: #f8fafc; font-size: 10px; text-transform: uppercase; color: #475569; }
        td.r, th.r { text-align: right; } td.c, th.c { text-align: center; }
        .pos { color: #16a34a; } .neg { color: #dc2626; }
        .muted { color: #94a3b8; text-align: center; }
        .good { color: #16a34a; } .bad { color: #dc2626; }
        .totals { font-size: 11px; margin-bottom: 4px; }
        .notes { margin-top: 10px; font-size: 10px; color: #475569; }
    </style></head><body>
        <div class="cover">
            <h1>Informe de cierres de caja</h1>
            <div class="sub">Periodo: ${esc(from || '—')} a ${esc(to || '—')} · ${closures.length} cierre(s)</div>
            <div class="resumen">
                <span>Descuadre total: <b class="${Math.abs(totalDescuadre) > 0.01 ? 'bad' : 'good'}">${eur(totalDescuadre)}</b></span>
                <span>No efectivo: <b>${eur(totalNoEfectivo)}</b></span>
                <span class="good">Conciliado: <b>${eur(totalConciliado)}</b></span>
                <span class="${(totalNoEfectivo - totalConciliado) > 0.01 ? 'bad' : 'muted'}">Pendiente: <b>${eur(totalNoEfectivo - totalConciliado)}</b></span>
            </div>
        </div>
        ${pages}${empty}
    </body></html>`;
}