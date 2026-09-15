import stripe, { createCheckoutSession, constructWebhookEvent } from '../services/stripe.js';
import { facturaDe } from '../utils/facturaDe.js';

// Stripe da importes en céntimos y fechas en segundos Unix
const aEuros = (centimos) => Number(((centimos || 0) / 100).toFixed(2));
const aFecha = (segundos) => (segundos ? new Date(segundos * 1000).toISOString() : null);
const saldoEur = (saldos) => aEuros((saldos || []).find(s => s.currency === 'eur')?.amount);

function mapearTransferencia(p) {
    // Con expand: ['data.destination'] la cuenta de destino llega como objeto
    const destino = typeof p.destination === 'object' && p.destination ? p.destination : null;
    return {
        id: p.id,
        amount: aEuros(p.amount),
        status: p.status,
        arrivalDate: aFecha(p.arrival_date),
        created: aFecha(p.created),
        automatic: p.automatic,
        bankName: destino?.bank_name || destino?.brand || null,
        last4: destino?.last4 || null,
        failureMessage: p.failure_message || null,
    };
}

// Movimientos del saldo de Stripe, cruzados con el Payment de la app por el
// payment_intent para saber a qué pedido, factura y cliente corresponde cada uno.
async function mapearMovimientos(prisma, movimientos) {
    const intentos = [...new Set(movimientos.map(m => m.source?.payment_intent).filter(Boolean))];
    const pagos = intentos.length ? await prisma.payment.findMany({
        where: { stripePaymentId: { in: intentos } },
        select: {
            stripePaymentId: true,
            order: { select: { id: true, orderNum: true } },
            invoice: { select: { id: true, number: true } },
            client: { select: { id: true, firstName: true, lastName: true } },
        },
    }) : [];
    const pagoPorIntento = new Map(pagos.map(p => [p.stripePaymentId, p]));

    return movimientos.map(m => {
        const pago = pagoPorIntento.get(m.source?.payment_intent);
        return {
            id: m.id,
            type: m.type,
            status: m.status,
            amount: aEuros(m.amount),
            fee: aEuros(m.fee),
            net: aEuros(m.net),
            created: aFecha(m.created),
            availableOn: aFecha(m.available_on),
            description: m.description || null,
            order: pago?.order || null,
            invoice: pago?.invoice || null,
            client: pago?.client || null,
        };
    });
}

export default async function (fastify) {
    const prisma = fastify.prisma;

    const requireAdmin = (req, reply) => {
        if (req.user?.role !== 'admin') {
            reply.code(403).send({ error: 'Solo administradores' });
            return false;
        }
        return true;
    };

    // Saldo de Stripe: lo retenido, lo disponible, las transferencias al banco y
    // los últimos movimientos. Se lee en vivo de Stripe; aquí no se guarda nada.
    fastify.get('/balance', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const [saldo, transferencias, movimientos, cuenta] = await Promise.all([
                stripe.balance.retrieve(),
                stripe.payouts.list({ limit: 20, expand: ['data.destination'] }),
                stripe.balanceTransactions.list({ limit: 50, expand: ['data.source'] }),
                stripe.accounts.retrieveCurrent(),
            ]);
            const calendario = cuenta.settings?.payouts?.schedule || {};

            return reply.send({
                livemode: saldo.livemode,
                available: saldoEur(saldo.available),
                pending: saldoEur(saldo.pending),
                schedule: {
                    interval: calendario.interval || null,
                    delayDays: calendario.delay_days ?? null,
                    weeklyAnchor: calendario.weekly_anchor || null,
                    monthlyAnchor: calendario.monthly_anchor || null,
                },
                payouts: transferencias.data.map(mapearTransferencia),
                transactions: await mapearMovimientos(prisma, movimientos.data),
            });
        } catch (e) {
            console.error('[Stripe] Error leyendo el saldo:', e);
            return reply.code(502).send({ error: e.message || 'No se pudo consultar Stripe' });
        }
    });

    // Qué cobros, devoluciones y comisiones componen una transferencia al banco
    fastify.get('/payouts/:id/transactions', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const { id } = req.params;
        if (!/^po_\w+$/.test(id)) {
            return reply.code(400).send({ error: 'Transferencia no válida' });
        }
        try {
            const movimientos = await stripe.balanceTransactions
                .list({ payout: id, limit: 100, expand: ['data.source'] })
                .autoPagingToArray({ limit: 1000 });
            // La propia transferencia también aparece en la lista: se quita
            const detalle = movimientos.filter(m => m.type !== 'payout');
            return reply.send(await mapearMovimientos(prisma, detalle));
        } catch (e) {
            console.error('[Stripe] Error leyendo la transferencia:', e);
            return reply.code(502).send({ error: e.message || 'No se pudo consultar Stripe' });
        }
    });

    // Crear sesión de checkout (requiere autenticación - admin/cashier)
    fastify.post('/checkout', async (req, reply) => {
        try {
            const { type, id } = req.body; // type: 'order' | 'invoice'

            if (!['order', 'invoice'].includes(type)) {
                return reply.code(400).send({ error: 'Tipo inválido. Usa: order o invoice' });
            }

            let amount, description, customerEmail, clientId;

            if (type === 'order') {
                const order = await prisma.order.findUnique({
                    where: { id: Number(id) },
                    include: { client: { select: { email: true, firstName: true, lastName: true, id: true } } }
                });
                if (!order) return reply.code(404).send({ error: 'Pedido no encontrado' });
                if (order.paid) return reply.code(400).send({ error: 'El pedido ya está pagado' });
                amount = order.total;
                description = `Pedido ${order.orderNum}`;
                customerEmail = order.client?.email;
                clientId = order.clientId;
            } else {
                const invoice = await prisma.invoices.findUnique({
                    where: { id: BigInt(id) },
                    include: { User: { select: { email: true, firstName: true, lastName: true, id: true } } }
                });
                if (!invoice) return reply.code(404).send({ error: 'Factura no encontrada' });
                if (invoice.paid === true || invoice.paymentStatus === 'paid') {
                    return reply.code(400).send({ error: 'La factura ya está cobrada' });
                }
                amount = Number(invoice.totalGross);
                description = `Factura ${invoice.number}`;
                customerEmail = invoice.User?.email;
                clientId = invoice.clientId;
            }

            const baseUrl = process.env.APP_URL || 'https://app.tinteyburbuja.com';

            const session = await createCheckoutSession({
                amount,
                description,
                metadata: { type, id },
                successUrl: `${baseUrl}/ventas?stripe_success=1`,
                cancelUrl: `${baseUrl}/ventas?stripe_cancel=1`,
                customerEmail,
            });

            // Crear Payment en estado pendiente
            await prisma.payment.create({
                data: {
                    amount,
                    method: 'stripe',
                    status: 'pending',
                    stripeSessionId: session.id,
                    orderId: type === 'order' ? Number(id) : null,
                    invoiceId: type === 'invoice' ? BigInt(id) : null,
                    clientId: clientId,
                    recordedBy: req.user?.userId || null,
                    note: `Checkout Stripe - ${description}`,
                }
            });

            return reply.send({ url: session.url, sessionId: session.id });
        } catch (e) {
            console.error('Error creando checkout Stripe:', e);
            return reply.code(500).send({ error: e.message || 'Error creando sesión de pago' });
        }
    });

    // Generar enlace de pago para enviar al cliente (devuelve la URL de checkout)
    fastify.get('/payment-link/:type/:id', async (req, reply) => {
        try {
            const { type, id } = req.params;

            if (!['order', 'invoice'].includes(type)) {
                return reply.code(400).send({ error: 'Tipo inválido' });
            }

            let amount, description, customerEmail, clientId;

            if (type === 'order') {
                const order = await prisma.order.findUnique({
                    where: { id: Number(id) },
                    include: { client: { select: { email: true, id: true } } }
                });
                if (!order) return reply.code(404).send({ error: 'Pedido no encontrado' });
                if (order.paid) return reply.code(400).send({ error: 'El pedido ya está pagado' });
                amount = order.total;
                description = `Pedido ${order.orderNum}`;
                customerEmail = order.client?.email;
                clientId = order.clientId;
            } else {
                const invoice = await prisma.invoices.findUnique({
                    where: { id: BigInt(id) },
                    include: { User: { select: { email: true, id: true } } }
                });
                if (!invoice) return reply.code(404).send({ error: 'Factura no encontrada' });
                if (invoice.paid === true) return reply.code(400).send({ error: 'La factura ya está cobrada' });
                amount = Number(invoice.totalGross);
                description = `Factura ${invoice.number}`;
                customerEmail = invoice.User?.email;
                clientId = invoice.clientId;
            }

            const baseUrl = process.env.APP_URL || 'https://app.tinteyburbuja.com';

            // Para el portal de cliente, la success/cancel URL apunta al portal
            const session = await createCheckoutSession({
                amount,
                description,
                metadata: { type, id },
                successUrl: `${baseUrl}/portal?payment_success=1`,
                cancelUrl: `${baseUrl}/portal?payment_cancel=1`,
                customerEmail,
            });

            // Crear Payment pendiente
            await prisma.payment.create({
                data: {
                    amount,
                    method: 'stripe',
                    status: 'pending',
                    stripeSessionId: session.id,
                    orderId: type === 'order' ? Number(id) : null,
                    invoiceId: type === 'invoice' ? BigInt(id) : null,
                    clientId: clientId,
                    recordedBy: req.user?.userId || null,
                    note: `Enlace de pago - ${description}`,
                }
            });

            return reply.send({ url: session.url, sessionId: session.id });
        } catch (e) {
            console.error('Error generando enlace de pago:', e);
            return reply.code(500).send({ error: e.message || 'Error generando enlace de pago' });
        }
    });
}

/**
 * Rutas del webhook de Stripe (registradas por separado, SIN JWT).
 * Necesitan acceso al raw body para verificar la firma.
 */
export async function stripeWebhookRoutes(fastify) {
    const prisma = fastify.prisma;

    // Configurar para recibir raw body en esta ruta
    fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
        done(null, body);
    });

    fastify.post('/webhook', async (req, reply) => {
        const signature = req.headers['stripe-signature'];

        if (!signature) {
            return reply.code(400).send({ error: 'Missing stripe-signature header' });
        }

        let event;
        try {
            event = constructWebhookEvent(req.body, signature);
        } catch (err) {
            console.error('Error verificando webhook Stripe:', err.message);
            return reply.code(400).send({ error: `Webhook signature verification failed: ${err.message}` });
        }

        // Procesar el evento
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const { type, id } = session.metadata || {};

            console.log(`[Stripe] Pago completado: type=${type}, id=${id}, session=${session.id}`);

            try {
                // Actualizar Payment de pending a completed
                const payment = await prisma.payment.findFirst({
                    where: { stripeSessionId: session.id }
                });

                if (payment) {
                    await prisma.payment.update({
                        where: { id: payment.id },
                        data: {
                            status: 'completed',
                            stripePaymentId: session.payment_intent,
                        }
                    });
                }

                if (type === 'order') {
                    const orderId = Number(id);
                    // Marcar pedido como pagado
                    const order = await prisma.order.findUnique({
                        where: { id: orderId },
                        include: { invoiceTickets: { include: { invoices: true } } }
                    });

                    if (order && !order.paid) {
                        await prisma.order.update({
                            where: { id: orderId },
                            data: { paid: true, paymentMethod: 'card' }
                        });

                        // Si tiene factura vinculada, marcarla como pagada
                        const facturaVigente = facturaDe(order);
                        if (facturaVigente) {
                            await prisma.invoices.update({
                                where: { id: facturaVigente.id },
                                data: { paid: true, paymentStatus: 'paid' }
                            });
                        }
                    }
                } else if (type === 'invoice') {
                    const invoiceId = BigInt(id);
                    const invoice = await prisma.invoices.findUnique({
                        where: { id: invoiceId },
                        include: { invoiceTickets: { include: { order: true } } }
                    });

                    if (invoice && invoice.paid !== true) {
                        // Marcar factura como pagada
                        await prisma.invoices.update({
                            where: { id: invoiceId },
                            data: { paid: true, paymentStatus: 'paid' }
                        });

                        // Marcar pedidos vinculados como pagados
                        for (const ticket of (invoice.invoiceTickets || [])) {
                            if (ticket.order && !ticket.order.paid) {
                                await prisma.order.update({
                                    where: { id: ticket.ticketId },
                                    data: { paid: true, paymentMethod: 'card' }
                                });
                            }
                        }
                    }
                }

                // Si no teníamos Payment previo (pago directo sin sesión previa), crear uno
                if (!payment) {
                    await prisma.payment.create({
                        data: {
                            amount: session.amount_total / 100,
                            method: 'stripe',
                            status: 'completed',
                            stripeSessionId: session.id,
                            stripePaymentId: session.payment_intent,
                            orderId: type === 'order' ? Number(id) : null,
                            invoiceId: type === 'invoice' ? BigInt(id) : null,
                        }
                    });
                }
            } catch (err) {
                console.error('[Stripe] Error procesando checkout.session.completed:', err);
                // No devolver error a Stripe para evitar reintentos innecesarios
            }
        }

        if (event.type === 'payment_intent.payment_failed') {
            const intent = event.data.object;
            console.error(`[Stripe] Pago fallido: ${intent.id}, error: ${intent.last_payment_error?.message}`);

            // Actualizar Payment si existe
            try {
                const payment = await prisma.payment.findFirst({
                    where: { stripePaymentId: intent.id }
                });
                if (payment) {
                    await prisma.payment.update({
                        where: { id: payment.id },
                        data: { status: 'failed' }
                    });
                }
            } catch (err) {
                console.error('[Stripe] Error actualizando payment fallido:', err);
            }
        }

        // Responder 200 siempre a Stripe
        return reply.code(200).send({ received: true });
    });
}
