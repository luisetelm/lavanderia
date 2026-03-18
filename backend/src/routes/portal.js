import jwt from 'jsonwebtoken';
import { sendSMScustomer } from '../services/twilio.js';

export default async function (fastify) {
    const prisma = fastify.prisma;

    // Solicitar acceso al portal (envía magic link por SMS)
    fastify.post('/request-access', async (req, reply) => {
        const { phone } = req.body;

        if (!phone) {
            return reply.code(400).send({ error: 'Teléfono obligatorio' });
        }

        // Buscar cliente por teléfono
        const client = await prisma.user.findFirst({
            where: { phone, role: 'customer' },
            select: { id: true, firstName: true, phone: true }
        });

        if (!client) {
            // No revelar si el usuario existe o no (seguridad)
            return reply.send({ ok: true, message: 'Si existe una cuenta con ese teléfono, recibirás un SMS con el enlace de acceso.' });
        }

        // Generar JWT de portal (24h de expiración)
        const portalToken = jwt.sign(
            { id: client.id, role: 'portal_client' },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        const baseUrl = process.env.APP_URL || 'https://app.tinteyburbuja.es';
        const link = `${baseUrl}/portal/verify/${portalToken}`;

        // Enviar SMS con el enlace
        try {
            await sendSMScustomer(
                client.phone,
                `Hola ${client.firstName}, accede a tu portal de cliente de Tinte y Burbuja: ${link}`
            );
        } catch (err) {
            console.error('[Portal] Error enviando SMS:', err);
            // No fallar - el link se ha generado igualmente
        }

        return reply.send({ ok: true, message: 'Si existe una cuenta con ese teléfono, recibirás un SMS con el enlace de acceso.' });
    });

    // Verificar token del magic link
    fastify.get('/verify/:token', async (req, reply) => {
        try {
            const payload = jwt.verify(req.params.token, process.env.JWT_SECRET);

            if (payload.role !== 'portal_client') {
                return reply.code(401).send({ error: 'Token inválido' });
            }

            // Generar un nuevo token de sesión de portal (más larga duración)
            const sessionToken = jwt.sign(
                { id: payload.id, role: 'portal_client' },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            const client = await prisma.user.findUnique({
                where: { id: payload.id },
                select: { id: true, firstName: true, lastName: true, email: true, phone: true }
            });

            return reply.send({ token: sessionToken, user: client });
        } catch (err) {
            return reply.code(401).send({ error: 'Enlace inválido o expirado' });
        }
    });

    // --- Rutas protegidas del portal (requieren JWT de portal) ---

    // Middleware helper para verificar portal token
    // Como las rutas /api/portal/ están excluidas del JWT middleware global,
    // este middleware parsea el Bearer token y verifica que sea de portal
    const requirePortalAuth = async (req, reply) => {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
            return reply.code(401).send({ error: 'Acceso no autorizado' });
        }
        try {
            const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
            if (payload.role !== 'portal_client') {
                return reply.code(401).send({ error: 'Acceso no autorizado' });
            }
            req.user = payload;
        } catch {
            return reply.code(401).send({ error: 'Sesión expirada o inválida' });
        }
    };

    // Obtener perfil del cliente
    fastify.get('/me', { preHandler: requirePortalAuth }, async (req, reply) => {
        const client = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true, firstName: true, lastName: true,
                email: true, phone: true,
                denominacionsocial: true, nif: true
            }
        });
        if (!client) return reply.code(404).send({ error: 'Cliente no encontrado' });
        return reply.send(client);
    });

    // Listar pedidos del cliente
    fastify.get('/orders', { preHandler: requirePortalAuth }, async (req, reply) => {
        const orders = await prisma.order.findMany({
            where: { clientId: req.user.id },
            include: {
                lines: {
                    select: {
                        id: true, quantity: true, unitPrice: true,
                        totalPrice: true, discount: true,
                        product: { select: { id: true, name: true } }
                    }
                },
                invoiceTickets: {
                    include: { invoices: { select: { id: true, number: true, paid: true, paymentStatus: true, type: true } } }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        return reply.send(orders);
    });

    // Detalle de un pedido
    fastify.get('/orders/:id', { preHandler: requirePortalAuth }, async (req, reply) => {
        const orderId = Number(req.params.id);
        const order = await prisma.order.findFirst({
            where: { id: orderId, clientId: req.user.id },
            include: {
                lines: {
                    select: {
                        id: true, quantity: true, unitPrice: true,
                        totalPrice: true, discount: true, notes: true,
                        product: { select: { id: true, name: true } }
                    }
                },
                invoiceTickets: {
                    include: { invoices: true }
                }
            }
        });

        if (!order) return reply.code(404).send({ error: 'Pedido no encontrado' });
        return reply.send(order);
    });

    // Listar facturas del cliente
    fastify.get('/invoices', { preHandler: requirePortalAuth }, async (req, reply) => {
        const invoices = await prisma.invoices.findMany({
            where: { clientId: req.user.id },
            include: {
                invoiceTickets: {
                    include: { order: { select: { id: true, orderNum: true, total: true } } }
                }
            },
            orderBy: { issuedAt: 'desc' }
        });

        // Convertir BigInt para serialización
        const serialized = JSON.parse(JSON.stringify(invoices, (_, v) =>
            typeof v === 'bigint' ? v.toString() : v
        ));

        return reply.send(serialized);
    });

    // Descargar PDF de factura (solo facturas del cliente)
    fastify.get('/invoices/:id/pdf', { preHandler: requirePortalAuth }, async (req, reply) => {
        const invoiceId = BigInt(req.params.id);
        const invoice = await prisma.invoices.findFirst({
            where: { id: invoiceId, clientId: req.user.id }
        });

        if (!invoice) return reply.code(404).send({ error: 'Factura no encontrada' });

        // Redirigir al endpoint de PDF existente
        const filename = `factura_${invoiceId}.pdf`;
        return reply.redirect(`/invoices_pdfs/${filename}`);
    });

    // Iniciar pago Stripe desde el portal
    fastify.post('/pay', { preHandler: requirePortalAuth }, async (req, reply) => {
        const { type, id } = req.body;

        if (!['order', 'invoice'].includes(type)) {
            return reply.code(400).send({ error: 'Tipo inválido' });
        }

        let amount, description;
        const baseUrl = process.env.APP_URL || 'https://app.tinteyburbuja.es';

        if (type === 'order') {
            const order = await prisma.order.findFirst({
                where: { id: Number(id), clientId: req.user.id }
            });
            if (!order) return reply.code(404).send({ error: 'Pedido no encontrado' });
            if (order.paid) return reply.code(400).send({ error: 'El pedido ya está pagado' });
            amount = order.total;
            description = `Pedido ${order.orderNum}`;
        } else {
            const invoice = await prisma.invoices.findFirst({
                where: { id: BigInt(id), clientId: req.user.id }
            });
            if (!invoice) return reply.code(404).send({ error: 'Factura no encontrada' });
            if (invoice.paid === true) return reply.code(400).send({ error: 'La factura ya está cobrada' });
            amount = Number(invoice.totalGross);
            description = `Factura ${invoice.number}`;
        }

        // Usar el servicio de Stripe
        const { createCheckoutSession } = await import('../services/stripe.js');
        const session = await createCheckoutSession({
            amount,
            description,
            metadata: { type, id },
            successUrl: `${baseUrl}/portal?payment_success=1`,
            cancelUrl: `${baseUrl}/portal?payment_cancel=1`,
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
                clientId: req.user.id,
                note: `Portal - ${description}`,
            }
        });

        return reply.send({ url: session.url });
    });
}
