import { sendSMScustomer } from '../services/twilio.js';
import { sendTextMessage, uploadMediaToWhatsApp, sendMediaMessage } from '../services/whatsapp.js';
import { findOrCreateConversation, touchConversation, getWhatsAppWindow } from '../services/conversation.js';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

export default async function (fastify) {
    const prisma = fastify.prisma;

    /* ─────────────────────────────────────────────
     *  GET /conversations — Lista de conversaciones
     * ───────────────────────────────────────────── */
    fastify.get('/conversations', async (req, reply) => {
        try {
            const conversations = await prisma.conversation.findMany({
                orderBy: { lastMessageAt: 'desc' },
                include: {
                    client: {
                        select: { id: true, firstName: true, lastName: true, phone: true },
                    },
                },
            });

            // Obtener último mensaje de cada conversación (1 query batch)
            const convIds = conversations.map(c => c.id);
            const lastMessages = convIds.length > 0
                ? await prisma.$queryRaw`
                    SELECT DISTINCT ON (sub."conversationId")
                        sub."conversationId",
                        sub."content",
                        sub."channel",
                        sub."direction",
                        sub."mediaType",
                        sub."createdAt"
                    FROM (
                        SELECT "conversationId", "content", "channel", "direction", "mediaType", "createdAt"
                        FROM "Message"
                        WHERE "conversationId" = ANY(${convIds})
                        UNION ALL
                        SELECT "conversationId", "content", COALESCE("type",'sms') AS channel, 'outbound' AS direction, NULL AS "mediaType", "sentAt" AS "createdAt"
                        FROM "Notification"
                        WHERE "conversationId" = ANY(${convIds})
                    ) sub
                    ORDER BY sub."conversationId", sub."createdAt" DESC
                `
                : [];

            const lastMsgMap = new Map();
            for (const lm of lastMessages) lastMsgMap.set(lm.conversationId, lm);

            // Obtener ventana 24h de WhatsApp para cada conversación
            const windowResults = await Promise.all(
                conversations.map(c => getWhatsAppWindow(prisma, c.id))
            );

            const result = conversations.map((c, i) => {
                const lm = lastMsgMap.get(c.id);
                const win = windowResults[i];
                return {
                    id: c.id,
                    clientId: c.clientId,
                    phone: c.client?.phone || c.phone,
                    firstName: c.client?.firstName || null,
                    lastName: c.client?.lastName || null,
                    lastMessage: lm?.content || null,
                    lastChannel: lm?.channel || null,
                    lastDirection: lm?.direction || null,
                    lastMediaType: lm?.mediaType || null,
                    lastMessageAt: c.lastMessageAt,
                    unreadCount: c.unreadCount,
                    waWindowOpen: win.open,
                    waWindowExpiresAt: win.expiresAt,
                };
            });

            return reply.send(result);
        } catch (err) {
            console.error('[Messages] Error obteniendo conversaciones:', err);
            return reply.code(500).send({ error: 'Error obteniendo conversaciones' });
        }
    });

    /* ─────────────────────────────────────────────
     *  POST /read/:conversationId — Marcar como leído
     * ───────────────────────────────────────────── */
    fastify.post('/read/:conversationId', async (req, reply) => {
        const conversationId = Number(req.params.conversationId);
        if (isNaN(conversationId)) return reply.code(400).send({ error: 'conversationId inválido' });

        try {
            const result = await prisma.message.updateMany({
                where: {
                    conversationId,
                    direction: 'inbound',
                    status: 'received',
                },
                data: { status: 'read' },
            });

            await prisma.conversation.update({
                where: { id: conversationId },
                data: { unreadCount: 0 },
            });

            return reply.send({ ok: true, marked: result.count });
        } catch (err) {
            console.error('[Messages] Error marcando como leído:', err);
            return reply.code(500).send({ error: 'Error marcando como leído' });
        }
    });

    /* ─────────────────────────────────────────────
     *  GET / — Historial de mensajes de una conversación
     * ───────────────────────────────────────────── */
    fastify.get('/', async (req, reply) => {
        const { conversationId, page = 0, size = 50 } = req.query;

        if (!conversationId) {
            return reply.code(400).send({ error: 'conversationId obligatorio' });
        }

        const convId = Number(conversationId);

        try {
            const messages = await prisma.message.findMany({
                where: { conversationId: convId },
                orderBy: { createdAt: 'asc' },
                skip: Number(page) * Number(size),
                take: Number(size),
            });

            const notifications = await prisma.notification.findMany({
                where: { conversationId: convId },
                orderBy: { sentAt: 'asc' },
                select: {
                    id: true, type: true, content: true, status: true,
                    sentAt: true, recipient: true, orderid: true,
                },
            });

            const combined = [
                ...messages.map(m => ({
                    id: `msg_${m.id}`,
                    channel: m.channel,
                    direction: m.direction,
                    content: m.content,
                    status: m.status,
                    createdAt: m.createdAt,
                    phone: m.phone,
                    orderId: m.orderId,
                    mediaUrl: m.mediaUrl || null,
                    mediaType: m.mediaType || null,
                    source: 'message',
                })),
                ...notifications.map(n => ({
                    id: `notif_${n.id}`,
                    channel: n.type || 'sms',
                    direction: 'outbound',
                    content: n.content,
                    status: n.status,
                    createdAt: n.sentAt,
                    phone: n.recipient,
                    orderId: n.orderid,
                    source: 'notification',
                })),
            ];

            combined.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            return reply.send(combined);
        } catch (err) {
            console.error('[Messages] Error obteniendo mensajes:', err);
            return reply.code(500).send({ error: 'Error obteniendo mensajes' });
        }
    });

    /* ─────────────────────────────────────────────
     *  POST /send — Enviar mensaje de texto
     * ───────────────────────────────────────────── */
    fastify.post('/send', async (req, reply) => {
        const { conversationId, channel, content, orderId } = req.body;

        if (!conversationId || !channel || !content) {
            return reply.code(400).send({ error: 'conversationId, channel y content son obligatorios' });
        }

        if (!['sms', 'whatsapp'].includes(channel)) {
            return reply.code(400).send({ error: 'Canal inválido. Usa: sms o whatsapp' });
        }

        try {
            const conversation = await prisma.conversation.findUnique({
                where: { id: Number(conversationId) },
                include: { client: { select: { id: true, phone: true, firstName: true } } },
            });

            if (!conversation) return reply.code(404).send({ error: 'Conversación no encontrada' });

            const phone = conversation.client?.phone || conversation.phone;
            if (!phone) return reply.code(400).send({ error: 'Sin teléfono para enviar' });

            // Verificar ventana 24h de WhatsApp para mensajes libres
            if (channel === 'whatsapp') {
                const win = await getWhatsAppWindow(prisma, conversation.id);
                if (!win.open) {
                    return reply.code(403).send({
                        error: 'La ventana de 24h de WhatsApp está cerrada. Usa una plantilla para iniciar la conversación.',
                        code: 'WA_WINDOW_CLOSED',
                        expiresAt: win.expiresAt,
                    });
                }
            }

            let externalId = null;
            if (channel === 'sms') {
                const smsResult = await sendSMScustomer(phone, content);
                externalId = smsResult?.subid || null;
            } else {
                const waResult = await sendTextMessage(phone, content);
                externalId = waResult?.messages?.[0]?.id || null;
            }

            const message = await prisma.message.create({
                data: {
                    externalId,
                    channel,
                    direction: 'outbound',
                    clientId: conversation.clientId || null,
                    phone,
                    content,
                    status: 'sent',
                    orderId: orderId ? Number(orderId) : null,
                    conversationId: conversation.id,
                },
            });

            await touchConversation(prisma, conversation.id);

            return reply.send({ ok: true, message });
        } catch (err) {
            console.error('[Messages] Error enviando mensaje:', err);
            return reply.code(500).send({ error: err.message || 'Error enviando mensaje' });
        }
    });

    /* ─────────────────────────────────────────────
     *  POST /send-media — Enviar archivo multimedia
     * ───────────────────────────────────────────── */
    fastify.post('/send-media', async (req, reply) => {
        const ALLOWED_MIME = {
            image: ['image/jpeg', 'image/png', 'image/webp'],
            video: ['video/mp4', 'video/3gpp'],
            audio: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/opus'],
            document: [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-powerpoint',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'text/plain',
            ],
        };

        try {
            const data = await req.file();
            if (!data) return reply.code(400).send({ error: 'Se requiere un fichero' });

            const fields = {};
            for (const [key, field] of Object.entries(data.fields)) {
                if (field.value !== undefined) fields[key] = field.value;
            }

            const { conversationId, caption, channel } = fields;
            if (!conversationId) return reply.code(400).send({ error: 'conversationId obligatorio' });

            const conversation = await prisma.conversation.findUnique({
                where: { id: Number(conversationId) },
                include: { client: { select: { id: true, phone: true } } },
            });
            if (!conversation) return reply.code(404).send({ error: 'Conversación no encontrada' });

            const phone = conversation.client?.phone || conversation.phone;
            if (!phone) return reply.code(400).send({ error: 'Sin teléfono para enviar' });

            // Verificar ventana 24h de WhatsApp
            if ((channel || 'whatsapp') !== 'sms') {
                const win = await getWhatsAppWindow(prisma, conversation.id);
                if (!win.open) {
                    return reply.code(403).send({
                        error: 'La ventana de 24h de WhatsApp está cerrada. Usa una plantilla para iniciar la conversación.',
                        code: 'WA_WINDOW_CLOSED',
                    });
                }
            }

            const mimeType = data.mimetype;
            const originalName = data.filename || 'file';

            let mediaType = null;
            for (const [type, mimes] of Object.entries(ALLOWED_MIME)) {
                if (mimes.includes(mimeType)) { mediaType = type; break; }
            }
            if (!mediaType) {
                return reply.code(400).send({ error: `Tipo de archivo no soportado: ${mimeType}` });
            }

            const mediaDir = path.join(process.cwd(), 'uploads', 'chat-media');
            if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

            const ext = path.extname(originalName) || '.bin';
            const filename = `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
            const filePath = path.join(mediaDir, filename);

            await pipeline(data.file, fs.createWriteStream(filePath));
            const localMediaUrl = `chat-media/${filename}`;

            let externalId = null;
            if (channel !== 'sms') {
                const waPhone = phone.startsWith('34') ? phone : `34${phone}`;
                const waMediaId = await uploadMediaToWhatsApp(filePath, mimeType);
                const waRes = await sendMediaMessage(waPhone, mediaType, waMediaId, caption || undefined, mediaType === 'document' ? originalName : undefined);
                externalId = waRes?.messages?.[0]?.id || null;
            }

            const message = await prisma.message.create({
                data: {
                    externalId,
                    channel: channel || 'whatsapp',
                    direction: 'outbound',
                    clientId: conversation.clientId || null,
                    phone,
                    content: caption || `[${mediaType}]`,
                    mediaUrl: localMediaUrl,
                    mediaType,
                    status: 'sent',
                    conversationId: conversation.id,
                },
            });

            await touchConversation(prisma, conversation.id);

            return reply.send({ ok: true, message });
        } catch (err) {
            console.error('[Messages] Error enviando media:', err);
            return reply.code(500).send({ error: err.message || 'Error enviando media' });
        }
    });

    /* ─────────────────────────────────────────────
     *  POST /conversations/:id/link-client — Vincular número desconocido a cliente
     * ───────────────────────────────────────────── */
    fastify.post('/conversations/:id/link-client', async (req, reply) => {
        const convId = Number(req.params.id);
        const { clientId } = req.body;

        if (isNaN(convId) || !clientId) {
            return reply.code(400).send({ error: 'conversationId y clientId obligatorios' });
        }

        try {
            const conversation = await prisma.conversation.findUnique({ where: { id: convId } });
            if (!conversation) return reply.code(404).send({ error: 'Conversación no encontrada' });
            if (conversation.clientId) return reply.code(400).send({ error: 'La conversación ya tiene un cliente vinculado' });

            const [updatedConv] = await prisma.$transaction([
                prisma.conversation.update({
                    where: { id: convId },
                    data: { clientId: Number(clientId) },
                }),
                prisma.message.updateMany({
                    where: { conversationId: convId },
                    data: { clientId: Number(clientId) },
                }),
            ]);

            return reply.send({ ok: true, conversation: updatedConv });
        } catch (err) {
            console.error('[Messages] Error vinculando cliente:', err);
            return reply.code(500).send({ error: 'Error vinculando cliente' });
        }
    });
}
