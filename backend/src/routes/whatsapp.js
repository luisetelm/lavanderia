import {
    sendTemplateMessage,
    sendTextMessage,
    parseWebhookPayload,
    fetchTemplates
} from '../services/whatsapp.js';

/**
 * Rutas autenticadas de WhatsApp (admin/cashier).
 */
export default async function (fastify) {
    const prisma = fastify.prisma;

    // Enviar mensaje de WhatsApp
    fastify.post('/send', async (req, reply) => {
        try {
            const { phone, content, templateName, templateComponents, orderId, clientId } = req.body;

            if (!phone) return reply.code(400).send({ error: 'Teléfono obligatorio' });
            if (!content && !templateName) return reply.code(400).send({ error: 'Debes indicar content o templateName' });

            let waResponse;
            let messageContent = content;

            if (templateName) {
                waResponse = await sendTemplateMessage(phone, templateName, 'es', templateComponents || []);
                messageContent = `[Template: ${templateName}]`;
            } else {
                waResponse = await sendTextMessage(phone, content);
            }

            const waMessageId = waResponse?.messages?.[0]?.id || null;

            // Guardar en la tabla Message
            const message = await prisma.message.create({
                data: {
                    externalId: waMessageId,
                    channel: 'whatsapp',
                    direction: 'outbound',
                    clientId: clientId ? Number(clientId) : null,
                    phone,
                    content: messageContent,
                    templateName: templateName || null,
                    status: 'sent',
                    orderId: orderId ? Number(orderId) : null,
                }
            });

            return reply.send({ ok: true, messageId: message.id, waMessageId });
        } catch (e) {
            console.error('[WhatsApp] Error enviando mensaje:', e);
            return reply.code(500).send({ error: e.message || 'Error enviando mensaje WhatsApp' });
        }
    });

    // Obtener plantillas aprobadas
    fastify.get('/templates', async (req, reply) => {
        try {
            const templates = await fetchTemplates();
            return reply.send(templates);
        } catch (e) {
            console.error('[WhatsApp] Error obteniendo plantillas:', e);
            return reply.code(500).send({ error: e.message || 'Error obteniendo plantillas' });
        }
    });

    // Historial de mensajes por cliente
    fastify.get('/messages', async (req, reply) => {
        const { clientId, page = 0, size = 50 } = req.query;

        const where = {};
        if (clientId) where.clientId = Number(clientId);
        where.channel = 'whatsapp';

        const messages = await prisma.message.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: Number(page) * Number(size),
            take: Number(size),
            include: {
                client: { select: { id: true, firstName: true, lastName: true, phone: true } }
            }
        });

        return reply.send(messages);
    });
}

/**
 * Rutas del webhook de WhatsApp (PÚBLICO, sin JWT).
 * Registrar por separado con prefix distinto o excluir del JWT middleware.
 */
export async function whatsappWebhookRoutes(fastify) {
    const prisma = fastify.prisma;

    // Verificación del webhook por Meta (GET con challenge)
    fastify.get('/webhook', async (req, reply) => {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
            console.log('[WhatsApp] Webhook verificado');
            return reply.code(200).send(challenge);
        }

        return reply.code(403).send({ error: 'Verification failed' });
    });

    // Recepción de mensajes y actualizaciones de estado
    fastify.post('/webhook', async (req, reply) => {
        try {
            const { messages, statuses } = parseWebhookPayload(req.body);

            // Procesar mensajes entrantes
            for (const msg of messages) {
                // Buscar cliente por teléfono
                const phone = msg.from.startsWith('34') ? msg.from : `34${msg.from}`;
                const client = await prisma.user.findFirst({
                    where: { phone: { contains: msg.from.slice(-9) } },
                    select: { id: true }
                });

                await prisma.message.create({
                    data: {
                        externalId: msg.waMessageId,
                        channel: 'whatsapp',
                        direction: 'inbound',
                        clientId: client?.id || null,
                        phone: msg.from,
                        content: msg.text || `[${msg.type}]`,
                        mediaUrl: msg.mediaUrl,
                        status: 'received',
                    }
                });

                console.log(`[WhatsApp] Mensaje recibido de ${msg.from}: ${msg.text?.substring(0, 50)}`);
            }

            // Procesar actualizaciones de estado
            for (const status of statuses) {
                if (status.waMessageId) {
                    await prisma.message.updateMany({
                        where: { externalId: status.waMessageId },
                        data: {
                            status: status.status,
                            updatedAt: new Date(),
                        }
                    });
                }
            }
        } catch (err) {
            console.error('[WhatsApp] Error procesando webhook:', err);
        }

        // Siempre responder 200 a Meta
        return reply.code(200).send({ received: true });
    });
}
