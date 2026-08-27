// backend/src/services/notify.js
// Servicio centralizado de notificaciones al cliente

import { sendSMScustomer } from './twilio.js';
import { sendTextMessage as sendWhatsApp, sendTemplateMessage as sendWhatsAppTemplate } from './whatsapp.js';
import { findOrCreateConversation, touchConversation } from './conversation.js';
import { normalizePhone } from '../utils/validatePhone.js';

// ── Datos del negocio (configurables por variables de entorno) ──
// Si no se define STORE_HOURS se mantiene el enlace de Google para no mostrar
// un horario que pueda quedar desactualizado o incorrecto.
const STORE_NAME = process.env.STORE_NAME || 'Tinte y Burbuja';
const STORE_ADDRESS = process.env.STORE_ADDRESS || 'Cronista Cazabán, 7';
const STORE_HOURS = process.env.STORE_HOURS || null;
const STORE_PHONE = process.env.STORE_PHONE || null;
const SCHEDULE_URL = 'https://share.google/d4uMKGaiCaBywfRt2';
// Imagen de la cabecera de la plantilla "pedido_listo" (header tipo IMAGE en Meta).
// Debe ser una URL pública accesible. Configurable por ENV.
const LISTO_HEADER_IMAGE = process.env.WHATSAPP_LISTO_HEADER_IMAGE || 'https://app.tinteyburbuja.com/fachada.jpg';

// Formatea un importe en formato español: 12.5 -> "12,50 €"
function formatAmount(value) {
    return `${Number(value || 0).toFixed(2).replace('.', ',')} €`;
}

function resolveChannel(client, forceSendSMS) {
    if (forceSendSMS === false) return null;
    if (forceSendSMS === 'whatsapp') return 'whatsapp';
    if (forceSendSMS === true) return 'sms';

    const preferred = client.notifyChannel || 'whatsapp';
    if (preferred === 'none') return null;
    return preferred;
}

// Capitaliza cada palabra del nombre: "MARI CARMEN" -> "Mari Carmen"
function toTitleCase(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/(^|[\s'-])([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ])/g, (_, sep, chr) => sep + chr.toUpperCase());
}

function buildOrderNotificationPayload(order, event) {
    const client = order.client;
    // Usar solo el nombre de pila y capitalizarlo (nunca en mayúsculas ni con apellidos)
    const firstName = toTitleCase(client.firstName) || 'cliente';
    const orderNum = order.orderNum || `#${order.id}`;

    if (event === 'collected') {
        return {
            message: `Hola ${firstName}, esperamos que todo haya ido perfecto en ${STORE_NAME}. Si puedes, déjanos una reseña: https://g.page/r/Cau9_6UCpQ8ZEBI/review`,
            templateName: 'pedido_recogido',
            templateComponents: [
                {
                    type: 'body',
                    parameters: [{ type: 'text', text: firstName }],
                },
            ],
        };
    }

    // ── Datos extra para reforzar la confianza en el mensaje de "pedido listo" ──
    // Nº de prendas (suma de cantidades de las líneas del pedido)
    const totalItems = Array.isArray(order.lines)
        ? order.lines.reduce((sum, l) => sum + (l.quantity || 0), 0)
        : 0;
    const itemsText = totalItems > 0
        ? ` (${totalItems} ${totalItems === 1 ? 'prenda' : 'prendas'})`
        : '';

    // Estado de pago: importe ya cobrado vs total
    const paidAmount = Array.isArray(order.payments)
        ? order.payments
            .filter((p) => p.status === 'completed')
            .reduce((sum, p) => sum + Number(p.amount || 0), 0)
        : 0;
    const pending = Math.max(0, Number(order.total || 0) - paidAmount);
    let paymentText = '';
    if (order.paid || pending <= 0.009) {
        paymentText = ' Ya está pagado.';
    } else {
        paymentText = ` Importe pendiente al recoger: ${formatAmount(pending)}.`;
    }

    // Horario: texto configurable o, si no existe, enlace de Google
    const scheduleText = STORE_HOURS
        ? `Horario: ${STORE_HOURS}.`
        : `Consulta nuestro horario: ${SCHEDULE_URL}`;

    // Teléfono de contacto (opcional)
    const phoneText = STORE_PHONE ? ` ¿Dudas? Llámanos al ${STORE_PHONE}.` : '';

    const message = `Hola ${firstName}, tu pedido ${orderNum}${itemsText} ya está listo para recoger en ${STORE_NAME}.${paymentText} Te esperamos en ${STORE_ADDRESS}. ${scheduleText}${phoneText}`;

    // La plantilla "pedido_listo" tiene una cabecera de imagen: hay que enviar
    // el parámetro de imagen además de las variables del cuerpo {{1}} y {{2}}.
    const templateComponents = [];
    if (LISTO_HEADER_IMAGE) {
        templateComponents.push({
            type: 'header',
            parameters: [{ type: 'image', image: { link: LISTO_HEADER_IMAGE } }],
        });
    }
    templateComponents.push({
        type: 'body',
        parameters: [
            { type: 'text', text: firstName },
            { type: 'text', text: orderNum },
        ],
    });

    return {
        message,
        templateName: 'pedido_listo',
        templateComponents,
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
                lines: {
                    select: { quantity: true },
                },
                payments: {
                    select: { amount: true, status: true },
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

// Exportado para reutilizar en el servicio de reintentos (reminders.js)
export { buildOrderNotificationPayload };



/**
 * Fallback a SMS cuando Meta acepta un mensaje de WhatsApp y después informa
 * por webhook de que NO se ha podido entregar (status = failed). Hasta ahora
 * ese caso se perdía: el aviso quedaba en "failed" y el cliente no se enteraba.
 *
 * Sólo actúa sobre mensajes salientes de texto con destinatario, una única vez
 * por mensaje (fallbackNotificationId) y nunca para clientes con avisos desactivados.
 */
export async function fallbackToSmsAfterWhatsAppFailure(prisma, message, { errorCode = null, errorMessage = null } = {}) {
    if (!message || message.direction !== 'outbound' || message.channel !== 'whatsapp') return null;
    if (message.fallbackNotificationId) return null;
    if (!message.content || message.mediaType) return null;

    const client = message.clientId
        ? await prisma.user.findUnique({ where: { id: message.clientId }, select: { id: true, phone: true, notifyChannel: true } })
        : null;
    if (client?.notifyChannel === 'none') return null;

    const normalizedPhone = normalizePhone(client?.phone || message.phone || '');
    if (!normalizedPhone) return null;

    const reason = `wa_delivery_failed${errorCode ? ` ${errorCode}` : ''}: ${(errorMessage || 'sin detalle').slice(0, 100)}`;
    const notification = await prisma.notification.create({
        data: {
            orderid: message.orderId || null,
            type: 'sms',
            recipient: normalizedPhone,
            content: message.content,
            status: 'pending',
            conversationId: message.conversationId || null,
            statusMessage: reason.slice(0, 255),
        },
    });
    // Marcar antes de enviar: si Meta repite el mismo status no se duplica el SMS
    await prisma.message.update({ where: { id: message.id }, data: { fallbackNotificationId: notification.id } });

    try {
        const sms = await sendSMScustomer(normalizedPhone, message.content);
        const baseMsg = (sms?.message || 'SMS enviado').slice(0, 120);
        await prisma.notification.update({
            where: { id: notification.id },
            data: {
                status: parseInt(sms?.code, 10) === 0 ? 'sent' : 'failed',
                statusCode: Number.parseInt(sms?.code, 10) || null,
                subid: sms?.subid || null,
                statusMessage: `${reason} | ${baseMsg}`.slice(0, 255),
            },
        });
        if (message.conversationId) await touchConversation(prisma, message.conversationId);
        console.log(`[Notify] Mensaje WA #${message.id} no entregado (${errorCode ?? 'N/A'}); reenviado por SMS (notif #${notification.id})`);
        return { ok: true, notificationId: notification.id };
    } catch (smsErr) {
        await prisma.notification.update({
            where: { id: notification.id },
            data: { status: 'failed', statusMessage: `${reason} | ${(smsErr.message || 'Error SMS')}`.slice(0, 255) },
        });
        console.error(`[Notify] Fallback SMS del mensaje WA #${message.id} también falló:`, smsErr.message);
        return { ok: false, notificationId: notification.id, error: smsErr.message };
    }
}
