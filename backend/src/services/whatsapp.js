/**
 * WhatsApp Cloud API service.
 *
 * Env vars:
 *   WHATSAPP_TOKEN          - Permanent/temporary access token from Meta
 *   WHATSAPP_PHONE_NUMBER_ID - Phone number ID (not the phone number itself)
 *   WHATSAPP_VERIFY_TOKEN    - Custom string to verify webhook
 */

const API_VERSION = 'v21.0';

function getBaseUrl() {
    return `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}`;
}

function getHeaders() {
    return {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
    };
}

/**
 * Enviar un mensaje de plantilla (template).
 * Las plantillas deben estar aprobadas en Meta Business.
 */
export async function sendTemplateMessage(phone, templateName, languageCode = 'es', components = []) {
    const url = `${getBaseUrl()}/messages`;
    const body = {
        messaging_product: 'whatsapp',
        to: phone.replace(/\D/g, ''),
        type: 'template',
        template: {
            name: templateName,
            language: { code: languageCode },
        },
    };

    if (components.length > 0) {
        body.template.components = components;
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
        console.error('[WhatsApp] Error enviando template:', data);
        throw new Error(data.error?.message || 'Error enviando template WhatsApp');
    }

    return data;
}

/**
 * Enviar un mensaje de texto libre.
 * Solo funciona dentro de la ventana de 24h desde el último mensaje del cliente.
 */
export async function sendTextMessage(phone, text) {
    const url = `${getBaseUrl()}/messages`;
    const body = {
        messaging_product: 'whatsapp',
        to: phone.replace(/\D/g, ''),
        type: 'text',
        text: { body: text },
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
        console.error('[WhatsApp] Error enviando texto:', data);
        throw new Error(data.error?.message || 'Error enviando mensaje WhatsApp');
    }

    return data;
}

/**
 * Procesar webhook entrante de Meta.
 * Extrae mensajes y actualizaciones de estado.
 */
export function parseWebhookPayload(body) {
    const results = { messages: [], statuses: [] };

    if (!body?.entry) return results;

    for (const entry of body.entry) {
        for (const change of (entry.changes || [])) {
            const value = change.value;
            if (!value) continue;

            // Mensajes entrantes
            if (value.messages) {
                for (const msg of value.messages) {
                    results.messages.push({
                        waMessageId: msg.id,
                        from: msg.from, // phone number
                        timestamp: msg.timestamp,
                        type: msg.type,
                        text: msg.text?.body || '',
                        mediaUrl: msg.image?.url || msg.document?.url || msg.audio?.url || null,
                    });
                }
            }

            // Actualizaciones de estado (sent, delivered, read, failed)
            if (value.statuses) {
                for (const status of value.statuses) {
                    results.statuses.push({
                        waMessageId: status.id,
                        status: status.status, // sent, delivered, read, failed
                        recipientId: status.recipient_id,
                        timestamp: status.timestamp,
                        errorCode: status.errors?.[0]?.code,
                        errorMessage: status.errors?.[0]?.message,
                    });
                }
            }
        }
    }

    return results;
}

/**
 * Obtener plantillas aprobadas de la cuenta de WhatsApp Business.
 */
export async function fetchTemplates() {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (!wabaId) {
        throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID no configurado');
    }

    const url = `https://graph.facebook.com/${API_VERSION}/${wabaId}/message_templates?status=APPROVED`;
    const res = await fetch(url, { headers: getHeaders() });
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error?.message || 'Error obteniendo plantillas');
    }

    return (data.data || []).map(t => ({
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components,
    }));
}
