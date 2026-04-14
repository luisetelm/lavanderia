// backend/src/services/notify.js
// Servicio centralizado de notificaciones al cliente

import { sendSMScustomer } from './twilio.js';
import { sendTextMessage as sendWhatsApp, sendTemplateMessage as sendWhatsAppTemplate } from './whatsapp.js';
import { findOrCreateConversation, touchConversation } from './conversation.js';

/**
 * Envía notificación de "pedido listo" al cliente.
 * Usa el canal preferido del cliente (notifyChannel) o 'whatsapp' por defecto.
 *
 * @param {PrismaClient} prisma
 * @param {number} orderId
 * @param {string|boolean|null} forceSendSMS  - false = no enviar, true = sms, 'whatsapp' = whatsapp, null/undefined = auto (según preferencia)
 */
export async function sendReadyNotification(prisma, orderId, forceSendSMS = null) {
    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                client: {
                    select: { id: true, firstName: true, lastName: true, phone: true, notifyChannel: true },
                },
            },
        });

        if (!order || !order.client?.phone) return;

        const client = order.client;
        const orderNum = order.orderNum || '';
        const clientName = client.firstName || '';
        const message = `Hola ${clientName}, tu pedido ${orderNum} está listo para recoger. Consulta nuestro horario de apertura: https://share.google/d4uMKGaiCaBywfRt2`;

        // Determinar canal
        let channel;
        if (forceSendSMS === false) return; // explícitamente no notificar
        if (forceSendSMS === 'whatsapp') channel = 'whatsapp';
        else if (forceSendSMS === true) channel = 'sms';
        else {
            // Auto: usar preferencia del cliente, o 'whatsapp' por defecto
            channel = client.notifyChannel || 'whatsapp';
            if (channel === 'none') return; // cliente optó por no recibir notificaciones
        }

        // Guardar preferencia de canal
        await prisma.user.update({ where: { id: client.id }, data: { notifyChannel: channel } });

        // Buscar/crear conversación
        const conversation = await findOrCreateConversation(prisma, { clientId: client.id, phone: client.phone });

        if (channel === 'whatsapp') {
            try {
                const phone = `34${client.phone}`;
                try {
                    await sendWhatsAppTemplate(phone, 'pedido_listo', 'es', [
                        { type: 'body', parameters: [{ type: 'text', text: clientName }, { type: 'text', text: orderNum }] }
                    ]);
                } catch (templateErr) {
                    console.warn('[WhatsApp] Template pedido_listo falló, intentando texto libre:', templateErr.message);
                    await sendWhatsApp(phone, message);
                }
                await prisma.notification.create({
                    data: { orderid: orderId, type: 'whatsapp', recipient: client.phone, content: message, status: 'sent', conversationId: conversation.id },
                });
            } catch (err) {
                console.error('Error enviando WhatsApp ready:', err);
                await prisma.notification.create({
                    data: { orderid: orderId, type: 'whatsapp', recipient: client.phone, content: message, status: 'failed', statusMessage: err.message?.slice(0, 255), conversationId: conversation.id },
                });
            }
        } else {
            try {
                const sms = await sendSMScustomer(client.phone, message);
                await prisma.notification.create({
                    data: { orderid: orderId, type: 'sms', recipient: client.phone, content: message, status: 'sent', statusCode: parseInt(sms.code), subid: sms.subid, statusMessage: sms.message, conversationId: conversation.id },
                });
            } catch (err) {
                console.error('Error enviando SMS ready:', err);
                await prisma.notification.create({
                    data: { orderid: orderId, type: 'sms', recipient: client.phone, content: message, status: 'failed', conversationId: conversation.id },
                });
            }
        }

        await touchConversation(prisma, conversation.id);
        console.log(`[Notify] Notificación "ready" enviada por ${channel} para pedido #${orderId}`);
    } catch (err) {
        console.error(`[Notify] Error enviando notificación ready para pedido #${orderId}:`, err);
    }
}

