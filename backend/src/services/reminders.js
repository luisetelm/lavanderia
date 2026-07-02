// backend/src/services/reminders.js
// Tareas programadas (cron) relacionadas con notificaciones:
//   1) retryFailedNotifications  -> reintenta envíos fallidos con backoff exponencial.
//   2) remindUncollectedOrders   -> recuerda una sola vez los pedidos listos no recogidos.

import { sendTemplateMessage, sendTextMessage } from './whatsapp.js';
import { sendSMScustomer } from './twilio.js';
import { buildOrderNotificationPayload, sendReadyNotification } from './notify.js';

// ── Configuración (ajustable por variables de entorno) ──
const MAX_RETRIES = Number.parseInt(process.env.NOTIFY_MAX_RETRIES || '5', 10);
// Base del backoff exponencial: 1ª reintento a 1h, luego 2h, 4h, 8h, 16h...
const RETRY_BASE_MS = Number.parseInt(process.env.NOTIFY_RETRY_BASE_MIN || '60', 10) * 60 * 1000;
// Solo reintentar mensajes fallidos de las últimas N horas (evita rebotar mensajes muy viejos)
const RETRY_WINDOW_MS = Number.parseInt(process.env.NOTIFY_RETRY_WINDOW_H || '72', 10) * 60 * 60 * 1000;
// Días tras los que se recuerda un pedido listo sin recoger
const REMINDER_DAYS = Number.parseInt(process.env.NOTIFY_REMINDER_DAYS || '7', 10);

// Calcula el siguiente instante de reintento según el nº de intentos ya realizados
function computeNextRetryAt(retryCount) {
    const delay = RETRY_BASE_MS * Math.pow(2, retryCount);
    return new Date(Date.now() + delay);
}

// Deriva el evento (ready/collected) a partir de la plantilla o del contenido
function inferEvent({ templateName, content }) {
    if (templateName === 'pedido_recogido') return 'collected';
    if (templateName === 'pedido_listo') return 'ready';
    if (content && /rese[ñn]a/i.test(content)) return 'collected';
    return 'ready';
}

/**
 * Reintenta las notificaciones fallidas (WhatsApp y SMS) con backoff exponencial.
 * Actualiza la MISMA fila en lugar de crear duplicados.
 */
export async function retryFailedNotifications(prisma) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - RETRY_WINDOW_MS);
    let retried = 0;
    let recovered = 0;

    // ── 1) Mensajes de WhatsApp fallidos ──
    const failedMessages = await prisma.message.findMany({
        where: {
            channel: 'whatsapp',
            direction: 'outbound',
            status: 'failed',
            retryCount: { lt: MAX_RETRIES },
            createdAt: { gte: windowStart },
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        take: 100,
    });

    for (const msg of failedMessages) {
        retried++;
        try {
            let waResponse;
            // Si el mensaje está asociado a un pedido, reintentar SIEMPRE con la
            // plantilla reconstruida desde el pedido (aunque en su día cayera a
            // texto libre). El texto libre fuera de la ventana de 24h no se entrega,
            // por lo que la plantilla es la única vía fiable de recuperación.
            if (msg.orderId) {
                const order = await prisma.order.findUnique({
                    where: { id: msg.orderId },
                    include: {
                        client: { select: { id: true, firstName: true, lastName: true } },
                        lines: { select: { quantity: true } },
                        payments: { select: { amount: true, status: true } },
                    },
                });
                const event = inferEvent(msg);
                const payload = order?.client
                    ? buildOrderNotificationPayload(order, event)
                    : null;
                if (payload?.templateName) {
                    waResponse = await sendTemplateMessage(
                        msg.phone,
                        payload.templateName,
                        'es',
                        payload.templateComponents || [],
                    );
                } else {
                    waResponse = await sendTextMessage(msg.phone, msg.content);
                }
            } else if (msg.templateName) {
                waResponse = await sendTemplateMessage(msg.phone, msg.templateName, 'es', []);
            } else {
                // Sin plantilla ni pedido: reintentar como texto libre
                waResponse = await sendTextMessage(msg.phone, msg.content);
            }

            const waMessageId = waResponse?.messages?.[0]?.id || null;
            await prisma.message.update({
                where: { id: msg.id },
                data: {
                    status: 'sent',
                    externalId: waMessageId || msg.externalId,
                    // Si recuperamos vía plantilla, dejar constancia del templateName
                    templateName: msg.orderId ? (inferEvent(msg) === 'collected' ? 'pedido_recogido' : 'pedido_listo') : msg.templateName,
                    retryCount: msg.retryCount + 1,
                    nextRetryAt: null,
                    updatedAt: now,
                },
            });
            recovered++;
        } catch (err) {
            const nextCount = msg.retryCount + 1;
            await prisma.message.update({
                where: { id: msg.id },
                data: {
                    retryCount: nextCount,
                    nextRetryAt: computeNextRetryAt(nextCount),
                    updatedAt: now,
                },
            });
            console.warn(`[Reminders] Reintento WhatsApp #${nextCount} fallido para message ${msg.id}:`, err.message);
        }
    }

    // ── 2) SMS fallidos (tabla Notification) ──
    const failedSms = await prisma.notification.findMany({
        where: {
            type: 'sms',
            status: 'failed',
            retryCount: { lt: MAX_RETRIES },
            sentAt: { gte: windowStart },
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        take: 100,
    });

    for (const sms of failedSms) {
        retried++;
        try {
            const result = await sendSMScustomer(sms.recipient, sms.content);
            const ok = Number.parseInt(result?.code, 10) === 0;
            await prisma.notification.update({
                where: { id: sms.id },
                data: {
                    status: ok ? 'sent' : 'failed',
                    statusCode: Number.parseInt(result?.code, 10) || null,
                    subid: result?.subid || sms.subid,
                    retryCount: sms.retryCount + 1,
                    nextRetryAt: ok ? null : computeNextRetryAt(sms.retryCount + 1),
                },
            });
            if (ok) recovered++;
        } catch (err) {
            const nextCount = sms.retryCount + 1;
            await prisma.notification.update({
                where: { id: sms.id },
                data: {
                    retryCount: nextCount,
                    nextRetryAt: computeNextRetryAt(nextCount),
                    statusMessage: (err.message || 'Error SMS').slice(0, 255),
                },
            });
            console.warn(`[Reminders] Reintento SMS #${nextCount} fallido para notification ${sms.id}:`, err.message);
        }
    }

    const summary = { retried, recovered };
    if (retried > 0) console.log('[Reminders] Reintento de notificaciones:', summary);
    return summary;
}

/**
 * Recuerda (una sola vez) los pedidos que llevan más de REMINDER_DAYS días
 * en estado "ready" sin recoger. Reutiliza sendReadyNotification.
 */
export async function remindUncollectedOrders(prisma) {
    const cutoff = new Date(Date.now() - REMINDER_DAYS * 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
        where: {
            status: 'ready',
            readyReminderAt: null,
            updatedAt: { lte: cutoff },
            clientId: { not: null },
        },
        select: { id: true },
        take: 200,
    });

    let reminded = 0;
    for (const order of orders) {
        try {
            const result = await sendReadyNotification(prisma, order.id);
            if (result?.ok) reminded++;
        } catch (err) {
            console.warn(`[Reminders] Error recordando pedido #${order.id}:`, err.message);
        } finally {
            // Marcar como recordado aunque falle, para no reintentar el recordatorio
            // (el reintento del envío en sí lo cubre retryFailedNotifications).
            await prisma.order.update({
                where: { id: order.id },
                data: { readyReminderAt: new Date() },
            });
        }
    }

    const summary = { candidates: orders.length, reminded };
    if (orders.length > 0) console.log('[Reminders] Recordatorio de pedidos no recogidos:', summary);
    return summary;
}

