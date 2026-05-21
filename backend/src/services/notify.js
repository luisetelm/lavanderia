// backend/src/services/notify.js
// Servicio centralizado de notificaciones al cliente

import { sendSMScustomer } from './twilio.js';
import { sendTextMessage as sendWhatsApp, sendTemplateMessage as sendWhatsAppTemplate } from './whatsapp.js';
import { findOrCreateConversation, touchConversation } from './conversation.js';
import { normalizePhone } from '../utils/validatePhone.js';

function resolveChannel(client, forceSendSMS) {
    if (forceSendSMS === false) return null;
    if (forceSendSMS === 'whatsapp') return 'whatsapp';
    if (forceSendSMS === true) return 'sms';

    const preferred = client.notifyChannel || 'whatsapp';
    if (preferred === 'none') return null;
    return preferred;
}

function buildOrderNotificationPayload(order, event) {
    const client = order.client;
    const firstName = client.firstName || 'cliente';
    const fullName = `${client.firstName || ''} ${client.lastName || ''}`.trim() || firstName;
    const orderNum = order.orderNum || `#${order.id}`;

    if (event === 'collected') {
        return {
            message: `Hola ${fullName}, esperamos que todo haya ido perfecto en Tinte y Burbuja. Si puedes, déjanos una reseña: https://g.page/r/Cau9_6UCpQ8ZEBI/review`,
            templateName: 'pedido_recogido',
            templateComponents: [
                {
                    type: 'body',
                    parameters: [{ type: 'text', text: firstName }],
                },
            ],
        };
    }

    return {
        message: `Hola ${firstName}, tu pedido ${orderNum} está listo para recoger. Consulta nuestro horario de apertura: https://share.google/d4uMKGaiCaBywfRt2`,
        templateName: 'pedido_listo',
        templateComponents: [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: firstName },
                    { type: 'text', text: orderNum },
                ],
            },
        ],
    };
}

async function sendOrderNotification(prisma, orderId, event, forceSendSMS = null) {
    const label = event === 'collected' ? 'collected' : 'ready';

    try {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                client: {
                    select: { id: true, firstName: true, lastName: true, phone: true, notifyChannel: true },
                },
            },
        });

        if (!order?.client) {
            console.warn(`[Notify] Pedido #${orderId} sin cliente asociado, no se puede notificar.`);
            return { ok: false, skipped: true, reason: 'missing_client' };
        }

        const client = order.client;
        const normalizedPhone = normalizePhone(client.phone || '');
        if (!normalizedPhone) {
            console.warn(`[Notify] Cliente #${client.id} sin teléfono, no se puede notificar pedido #${orderId}.`);
            return { ok: false, skipped: true, reason: 'missing_phone' };
        }

        const channel = resolveChannel(client, forceSendSMS);
        if (!channel) {
            console.log(`[Notify] Notificación ${label} omitida para pedido #${orderId} (sin canal o cliente opt-out).`);
            return { ok: false, skipped: true, reason: 'channel_disabled' };
        }

        const { message, templateName, templateComponents } = buildOrderNotificationPayload(order, event);

        let conversation = null;
        try {
            conversation = await findOrCreateConversation(prisma, { clientId: client.id, phone: normalizedPhone });
        } catch (conversationErr) {
            console.error(`[Notify] No se pudo resolver la conversación del pedido #${orderId}:`, conversationErr);
        }

        // ── Helper: enviar por SMS y registrar en tabla Notification (canal legacy con callbacks LabsMobile) ──
        const sendViaSms = async (reasonNote = null) => {
            const notification = await prisma.notification.create({
                data: {
                    orderid: orderId,
                    type: 'sms',
                    recipient: normalizedPhone,
                    content: message,
                    status: 'pending',
                    conversationId: conversation?.id || null,
                },
            });
            try {
                const sms = await sendSMScustomer(normalizedPhone, message);
                const baseMsg = (sms?.message || 'SMS enviado').slice(0, 200);
                const finalMsg = reasonNote ? `${reasonNote} | ${baseMsg}`.slice(0, 255) : baseMsg;
                await prisma.notification.update({
                    where: { id: notification.id },
                    data: {
                        status: parseInt(sms?.code, 10) === 0 ? 'sent' : 'failed',
                        statusCode: Number.parseInt(sms?.code, 10) || null,
                        subid: sms?.subid || null,
                        statusMessage: finalMsg,
                    },
                });
                return { ok: true, channel: 'sms', notificationId: notification.id };
            } catch (smsErr) {
                await prisma.notification.update({
                    where: { id: notification.id },
                    data: {
                        status: 'failed',
                        statusMessage: (smsErr.message || 'Error SMS').slice(0, 255),
                    },
                });
                throw smsErr;
            }
        };

        try {
            await prisma.user.update({
                where: { id: client.id },
                data: { notifyChannel: channel },
            });

            if (channel === 'whatsapp') {
                // ── WhatsApp: registrar en tabla Message para que el webhook actualice estados via externalId ──
                let response;
                let usedTemplate = templateName;
                let waError = null;

                try {
                    response = await sendWhatsAppTemplate(normalizedPhone, templateName, 'es', templateComponents);
                } catch (templateErr) {
                    console.warn(`[WhatsApp] Template ${templateName} falló para pedido #${orderId}; intentando texto libre:`, templateErr.message);
                    waError = templateErr.message;
                    try {
                        response = await sendWhatsApp(normalizedPhone, message);
                        usedTemplate = null;
                    } catch (textErr) {
                        // Ambos fallaron (típicamente ventana 24h cerrada y plantilla no aprobada).
                        // Fallback automático a SMS para no perder la comunicación con el cliente.
                        console.warn(`[WhatsApp] Texto libre también falló para pedido #${orderId}; fallback a SMS:`, textErr.message);
                        const fallbackReason = `wa_fallback: ${(waError || textErr.message || '').slice(0, 120)}`;
                        const smsResult = await sendViaSms(fallbackReason);
                        if (conversation?.id) await touchConversation(prisma, conversation.id);
                        console.log(`[Notify] Notificación "${label}" enviada por SMS (fallback WhatsApp) para pedido #${orderId}`);
                        return { ...smsResult, fallback: true, waError };
                    }
                }

                const waMessageId = response?.messages?.[0]?.id || null;

                // Persistir en Message (NO en Notification): así el webhook /webhook
                // actualizará el status (delivered/read/failed) emparejando por externalId.
                const messageRow = await prisma.message.create({
                    data: {
                        externalId: waMessageId,
                        channel: 'whatsapp',
                        direction: 'outbound',
                        clientId: client.id,
                        phone: normalizedPhone,
                        content: message,
                        templateName: usedTemplate || null,
                        status: 'sent',
                        orderId: orderId,
                        conversationId: conversation?.id || null,
                    },
                });

                if (conversation?.id) await touchConversation(prisma, conversation.id);

                console.log(`[Notify] Notificación "${label}" enviada por whatsapp (msgId=${waMessageId}) para pedido #${orderId}`);
                return { ok: true, channel: 'whatsapp', messageId: messageRow.id, waMessageId };
            }

            // ── SMS directo ──
            const smsResult = await sendViaSms();
            if (conversation?.id) await touchConversation(prisma, conversation.id);
            console.log(`[Notify] Notificación "${label}" enviada por sms para pedido #${orderId}`);
            return smsResult;
        } catch (sendErr) {
            console.error(`[Notify] Error enviando notificación ${label} para pedido #${orderId}:`, sendErr);
            return { ok: false, channel, error: sendErr.message };
        }
    } catch (err) {
        console.error(`[Notify] Error preparando notificación ${label} para pedido #${orderId}:`, err);
        return { ok: false, error: err.message };
    }
}

/**
 * Envía notificación de "pedido listo" al cliente.
 * Usa el canal preferido del cliente (notifyChannel) o 'whatsapp' por defecto.
 *
 * @param {PrismaClient} prisma
 * @param {number} orderId
 * @param {string|boolean|null} forceSendSMS  - false = no enviar, true = sms, 'whatsapp' = whatsapp, null/undefined = auto (según preferencia)
 */
export async function sendReadyNotification(prisma, orderId, forceSendSMS = null) {
    return sendOrderNotification(prisma, orderId, 'ready', forceSendSMS);
}

export async function sendCollectedNotification(prisma, orderId, forceSendSMS = null) {
    return sendOrderNotification(prisma, orderId, 'collected', forceSendSMS);
}

