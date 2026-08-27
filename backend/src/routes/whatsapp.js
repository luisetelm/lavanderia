import {
    sendTemplateMessage,
    sendTextMessage,
    parseWebhookPayload,
    fetchTemplates,
    fetchAllTemplates,
    createTemplate,
    deleteTemplate,
    uploadMediaToWhatsApp,
    sendMediaMessage,
    downloadMedia
} from '../services/whatsapp.js';
import { findOrCreateConversation, touchConversation } from '../services/conversation.js';
import { fallbackToSmsAfterWhatsAppFailure } from '../services/notify.js';

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

            // Buscar/crear conversación
            const conversation = await findOrCreateConversation(prisma, {
                clientId: clientId ? Number(clientId) : null,
                phone,
            });

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
                    conversationId: conversation.id,
                }
            });

            await touchConversation(prisma, conversation.id);

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

    // ─── Gestión de plantillas (solo admin) ───

    // Listar TODAS las plantillas (cualquier estado)
    fastify.get('/templates/all', async (req, reply) => {
        if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Solo admin' });
        try {
            const templates = await fetchAllTemplates();
            return reply.send(templates);
        } catch (e) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // Crear una plantilla
    fastify.post('/templates', async (req, reply) => {
        if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Solo admin' });
        const { name, category, language, components } = req.body;
        if (!name || !category || !components) {
            return reply.code(400).send({ error: 'name, category y components son obligatorios' });
        }
        try {
            const result = await createTemplate(name, category, language || 'es', components);
            return reply.send({ ok: true, ...result });
        } catch (e) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // Eliminar una plantilla
    fastify.delete('/templates/:name', async (req, reply) => {
        if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Solo admin' });
        try {
            const result = await deleteTemplate(req.params.name);
            return reply.send({ ok: true, ...result });
        } catch (e) {
            return reply.code(500).send({ error: e.message });
        }
    });

    // Crear las plantillas estándar de la lavandería (conveniencia)
    fastify.post('/templates/setup-defaults', async (req, reply) => {
        if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Solo admin' });

        const defaults = [
            {
                name: 'pedido_listo',
                category: 'UTILITY',
                language: 'es',
                components: [
                    {
                        type: 'BODY',
                        text: 'Hola {{1}}, tu pedido {{2}} está listo para recoger. 🧺\n\nConsulta nuestro horario de apertura: https://share.google/d4uMKGaiCaBywfRt2',
                        example: { body_text: [['Laura', 'TPV/2025/0001']] },
                    },
                ],
            },
            {
                name: 'pedido_recogido',
                category: 'UTILITY',
                language: 'es',
                components: [
                    {
                        type: 'BODY',
                        text: 'Hola {{1}}, esperamos que todo haya ido perfecto en Tinte y Burbuja. ✨\n\nSi puedes, déjanos una reseña: https://g.page/r/Cau9_6UCpQ8ZEBI/review',
                        example: { body_text: [['Laura']] },
                    },
                ],
            },
        ];

        const results = [];
        for (const tpl of defaults) {
            try {
                const result = await createTemplate(tpl.name, tpl.category, tpl.language, tpl.components);
                results.push({ name: tpl.name, status: 'created', id: result.id });
            } catch (e) {
                results.push({ name: tpl.name, status: 'error', error: e.message });
            }
        }

        return reply.send({ ok: true, results });
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
                const client = await prisma.user.findFirst({
                    where: { phone: { contains: msg.from.slice(-9) } },
                    select: { id: true }
                });

                let localMediaUrl = null;
                let mediaType = null;

                // Determinar mediaType
                const mediaTypes = ['image', 'video', 'audio', 'document', 'sticker'];
                if (mediaTypes.includes(msg.type)) {
                    mediaType = msg.type;
                } else if (msg.type === 'location') {
                    mediaType = 'location';
                } else if (msg.type === 'contacts') {
                    mediaType = 'contact';
                }

                // Descargar media si hay mediaId
                if (msg.mediaId) {
                    try {
                        const { localPath } = await downloadMedia(msg.mediaId);
                        localMediaUrl = localPath;
                    } catch (dlErr) {
                        console.error(`[WhatsApp] Error descargando media ${msg.mediaId}:`, dlErr.message);
                    }
                }

                // Construir content según tipo
                let content = msg.text || `[${msg.type}]`;
                if (msg.type === 'location' && msg.location) {
                    content = JSON.stringify(msg.location);
                } else if (msg.type === 'contacts' && msg.contacts) {
                    content = JSON.stringify(msg.contacts);
                }

                // Buscar/crear conversación
                const conversation = await findOrCreateConversation(prisma, {
                    clientId: client?.id || null,
                    phone: msg.from,
                });

                await prisma.message.create({
                    data: {
                        externalId: msg.waMessageId,
                        channel: 'whatsapp',
                        direction: 'inbound',
                        clientId: client?.id || null,
                        phone: msg.from,
                        content,
                        mediaUrl: localMediaUrl,
                        mediaType,
                        status: 'received',
                        conversationId: conversation.id,
                    }
                });

                await touchConversation(prisma, conversation.id, { incrementUnread: true });

                console.log(`[WhatsApp] Mensaje ${msg.type} recibido de ${msg.from}${mediaType ? ` (${mediaType})` : ''}`);
            }

            // Procesar actualizaciones de estado
            for (const status of statuses) {
                if (!status.waMessageId) continue;

                if (status.status === 'failed') {
                    // Guardar el motivo (antes sólo se escribía en consola y no se
                    // podía diagnosticar desde la app por qué un cliente no recibía avisos)
                    const errorCode = Number.isFinite(Number(status.errorCode)) ? Number(status.errorCode) : null;
                    const errorMessage = status.errorMessage ? String(status.errorMessage).slice(0, 255) : null;
                    console.error(
                        `[WhatsApp] Mensaje ${status.waMessageId} FALLIDO`,
                        `→ code=${errorCode ?? 'N/A'}`,
                        `msg="${errorMessage ?? 'sin detalle'}"`,
                    );
                    const failed = await prisma.message.findUnique({ where: { externalId: status.waMessageId } });
                    if (!failed) continue;
                    await prisma.message.update({
                        where: { id: failed.id },
                        data: { status: 'failed', errorCode, errorMessage, updatedAt: new Date() },
                    });
                    try {
                        await fallbackToSmsAfterWhatsAppFailure(prisma, failed, { errorCode, errorMessage });
                    } catch (fbErr) {
                        console.error(`[WhatsApp] Error en fallback SMS del mensaje ${status.waMessageId}:`, fbErr);
                    }
                    continue;
                }

                await prisma.message.updateMany({
                    where: { externalId: status.waMessageId },
                    data: {
                        status: status.status,
                        updatedAt: new Date(),
                    }
                });
            }
        } catch (err) {
            console.error('[WhatsApp] Error procesando webhook:', err);
        }

        // Siempre responder 200 a Meta
        return reply.code(200).send({ received: true });
    });
}
