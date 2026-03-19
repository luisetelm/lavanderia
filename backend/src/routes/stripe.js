import { createCheckoutSession, constructWebhookEvent } from '../services/stripe.js';

export default async function (fastify) {
    const prisma = fastify.prisma;

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
                    recordedBy: req.user?.id || null,
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
                    recordedBy: req.user?.id || null,
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
                        if (order.invoiceTickets?.invoices) {
                            await prisma.invoices.update({
                                where: { id: order.invoiceTickets.invoices.id },
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
