import { sendSMScustomer } from '../services/twilio.js';
import { sendTextMessage, sendTemplateMessage } from '../services/whatsapp.js';

export default async function (fastify) {
    const prisma = fastify.prisma;

    // Lista de conversaciones (clientes con mensajes, agrupados)
    fastify.get('/conversations', async (req, reply) => {
        try {
            // Obtener el último mensaje de cada cliente
            const conversations = await prisma.$queryRaw`
                SELECT DISTINCT ON (m."clientId")
                    m."clientId",
                    m."content" as "lastMessage",
                    m."channel" as "lastChannel",
                    m."direction" as "lastDirection",
                    m."createdAt" as "lastMessageAt",
                    u."firstName",
                    u."lastName",
                    u."phone",
                    (SELECT COUNT(*)::int FROM "Message" m2
                     WHERE m2."clientId" = m."clientId"
                       AND m2."direction" = 'inbound'
                       AND m2."status" = 'received') as "unreadCount"
                FROM "Message" m
                LEFT JOIN "User" u ON u."id" = m."clientId"
                WHERE m."clientId" IS NOT NULL
                ORDER BY m."clientId", m."createdAt" DESC
            `;

            // Ordenar por fecha del último mensaje (más reciente primero)
            const sorted = conversations.sort((a, b) =>
                new Date(b.lastMessageAt) - new Date(a.lastMessageAt)
            );

            return reply.send(sorted);
        } catch (err) {
            console.error('[Messages] Error obteniendo conversaciones:', err);
            return reply.code(500).send({ error: 'Error obteniendo conversaciones' });
        }
    });

    // Historial de mensajes unificado (SMS + WhatsApp) para un cliente
    fastify.get('/', async (req, reply) => {
        const { clientId, page = 0, size = 50 } = req.query;

        if (!clientId) {
            return reply.code(400).send({ error: 'clientId obligatorio' });
        }

        try {
            // Mensajes de la tabla Message (WhatsApp + SMS nuevos)
            const messages = await prisma.message.findMany({
                where: { clientId: Number(clientId) },
                orderBy: { createdAt: 'asc' },
                skip: Number(page) * Number(size),
                take: Number(size),
            });

            // También incluir notificaciones antiguas (SMS del sistema Notification)
            const notifications = await prisma.notification.findMany({
                where: {
                    order: { clientId: Number(clientId) }
                },
                orderBy: { sentAt: 'asc' },
                select: {
                    id: true, type: true, content: true, status: true,
                    sentAt: true, recipient: true, orderid: true,
                }
            });

            // Combinar y formatear como mensajes unificados
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

            // Ordenar por fecha
            combined.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            return reply.send(combined);
        } catch (err) {
            console.error('[Messages] Error obteniendo mensajes:', err);
            return reply.code(500).send({ error: 'Error obteniendo mensajes' });
        }
    });

    // Enviar mensaje unificado (elige canal)
    fastify.post('/send', async (req, reply) => {
        const { clientId, channel, content, orderId } = req.body;

        if (!clientId || !channel || !content) {
            return reply.code(400).send({ error: 'clientId, channel y content son obligatorios' });
        }

        if (!['sms', 'whatsapp'].includes(channel)) {
            return reply.code(400).send({ error: 'Canal inválido. Usa: sms o whatsapp' });
        }

        try {
            const client = await prisma.user.findUnique({
                where: { id: Number(clientId) },
                select: { id: true, phone: true, firstName: true }
            });

            if (!client || !client.phone) {
                return reply.code(400).send({ error: 'Cliente no encontrado o sin teléfono' });
            }

            let externalId = null;

            if (channel === 'sms') {
                const smsResult = await sendSMScustomer(client.phone, content);
                externalId = smsResult?.subid || null;
            } else {
                const waResult = await sendTextMessage(client.phone, content);
                externalId = waResult?.messages?.[0]?.id || null;
            }

            // Guardar en la tabla Message
            const message = await prisma.message.create({
                data: {
                    externalId,
                    channel,
                    direction: 'outbound',
                    clientId: Number(clientId),
                    phone: client.phone,
                    content,
                    status: 'sent',
                    orderId: orderId ? Number(orderId) : null,
                }
            });

            return reply.send({ ok: true, message });
        } catch (err) {
            console.error('[Messages] Error enviando mensaje:', err);
            return reply.code(500).send({ error: err.message || 'Error enviando mensaje' });
        }
    });
}
