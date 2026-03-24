/**
 * Busca o crea una conversación para un contacto.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ clientId?: number, phone: string }} opts
 * @returns {Promise<{ id: number, clientId: number|null, phone: string }>}
 */
export async function findOrCreateConversation(prisma, { clientId, phone }) {
    if (!phone) throw new Error('phone es obligatorio para findOrCreateConversation');

    // 1. Buscar por clientId (si se conoce)
    if (clientId) {
        const existing = await prisma.conversation.findFirst({
            where: { clientId },
        });
        if (existing) return existing;
    }

    // 2. Buscar por phone (números desconocidos o fallback)
    const byPhone = await prisma.conversation.findFirst({
        where: { phone },
    });
    if (byPhone) {
        // Si ahora conocemos el clientId y la conversación no lo tenía, vincular
        if (clientId && !byPhone.clientId) {
            return prisma.conversation.update({
                where: { id: byPhone.id },
                data: { clientId },
            });
        }
        return byPhone;
    }

    // 3. Crear nueva conversación
    return prisma.conversation.create({
        data: {
            clientId: clientId || null,
            phone,
            lastMessageAt: new Date(),
            unreadCount: 0,
        },
    });
}

/**
 * Actualiza lastMessageAt y opcionalmente incrementa unreadCount.
 */
export async function touchConversation(prisma, conversationId, { incrementUnread = false } = {}) {
    const data = { lastMessageAt: new Date(), updatedAt: new Date() };
    if (incrementUnread) {
        data.unreadCount = { increment: 1 };
    }
    return prisma.conversation.update({
        where: { id: conversationId },
        data,
    });
}

/**
 * Comprueba si la ventana de 24h de WhatsApp está abierta para una conversación.
 * La ventana se abre cuando el cliente envía un mensaje (inbound) y dura 24h.
 *
 * @returns {{ open: boolean, lastInboundAt: Date|null, expiresAt: Date|null }}
 */
export async function getWhatsAppWindow(prisma, conversationId) {
    const lastInbound = await prisma.message.findFirst({
        where: {
            conversationId,
            direction: 'inbound',
            channel: 'whatsapp',
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    });

    if (!lastInbound) {
        return { open: false, lastInboundAt: null, expiresAt: null };
    }

    const expiresAt = new Date(lastInbound.createdAt.getTime() + 24 * 60 * 60 * 1000);
    const open = expiresAt > new Date();

    return {
        open,
        lastInboundAt: lastInbound.createdAt,
        expiresAt,
    };
}

