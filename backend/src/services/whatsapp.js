/**
 * WhatsApp Cloud API service.
 *
 * Env vars:
 *   WHATSAPP_TOKEN          - Permanent/temporary access token from Meta
 *   WHATSAPP_PHONE_NUMBER_ID - Phone number ID (not the phone number itself)
 *   WHATSAPP_VERIFY_TOKEN    - Custom string to verify webhook
 */

import fs from 'fs';
import path from 'path';
import { normalizePhone } from '../utils/validatePhone.js';

const API_VERSION = 'v21.0';

export function formatWhatsAppPhone(phone) {
    const raw = `${phone || ''}`.trim();
    if (!raw) {
        throw new Error('Teléfono de WhatsApp vacío');
    }

    const normalizedSpanish = normalizePhone(raw);
    if (/^[6789]\d{8}$/.test(normalizedSpanish)) {
        return `34${normalizedSpanish}`;
    }

    const digits = raw.replace(/\D/g, '');
    if (!digits) {
        throw new Error('Teléfono de WhatsApp inválido');
    }

    if (digits.startsWith('00')) {
        return digits.slice(2);
    }

    return digits;
}

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
    const recipient = formatWhatsAppPhone(phone);
    const body = {
        messaging_product: 'whatsapp',
        to: recipient,
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
    const recipient = formatWhatsAppPhone(phone);
    const body = {
        messaging_product: 'whatsapp',
        to: recipient,
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
 * Subir un fichero a WhatsApp Cloud API y obtener un media_id.
 */
export async function uploadMediaToWhatsApp(filePath, mimeType) {
    const url = `${getBaseUrl()}/media`;
    const fileName = path.basename(filePath);

    // WhatsApp Cloud API expects multipart/form-data
    const { FormData } = await import('undici');
    // Use Node 18+ native fetch with FormData from undici or built-in
    const formData = new (globalThis.FormData || FormData)();

    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', mimeType);

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` },
        body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
        console.error('[WhatsApp] Error subiendo media:', data);
        throw new Error(data.error?.message || 'Error subiendo media a WhatsApp');
    }

    return data.id; // media_id
}

/**
 * Enviar un mensaje multimedia via WhatsApp Cloud API.
 * @param {string} phone - Número destino
 * @param {string} mediaType - image, video, audio, document
 * @param {string} mediaId - ID obtenido de uploadMediaToWhatsApp
 * @param {string} [caption] - Texto descriptivo (solo image, video, document)
 * @param {string} [filename] - Nombre del fichero (solo document)
 */
export async function sendMediaMessage(phone, mediaType, mediaId, caption, filename) {
    const url = `${getBaseUrl()}/messages`;
    const recipient = formatWhatsAppPhone(phone);

    const mediaObj = { id: mediaId };
    if (caption && ['image', 'video', 'document'].includes(mediaType)) {
        mediaObj.caption = caption;
    }
    if (filename && mediaType === 'document') {
        mediaObj.filename = filename;
    }

    const body = {
        messaging_product: 'whatsapp',
        to: recipient,
        type: mediaType,
        [mediaType]: mediaObj,
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
        console.error('[WhatsApp] Error enviando media:', data);
        throw new Error(data.error?.message || 'Error enviando media WhatsApp');
    }

    return data;
}

/**
 * Descargar un fichero multimedia de WhatsApp Cloud API.
 * 1) GET /{media_id} → obtiene url
 * 2) GET url con Authorization → descarga binario
 * 3) Guarda en uploads/chat-media/
 * @returns {{ localPath: string, mimeType: string }} ruta relativa y tipo MIME
 */
export async function downloadMedia(mediaId) {
    const authHeader = { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` };

    // Step 1: get the download URL
    const metaRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, { headers: authHeader });
    const metaData = await metaRes.json();
    if (!metaRes.ok || !metaData.url) {
        console.error('[WhatsApp] Error obteniendo URL de media:', metaData);
        throw new Error('No se pudo obtener la URL de descarga del media');
    }

    const mimeType = metaData.mime_type || 'application/octet-stream';

    // Step 2: download binary
    const dlRes = await fetch(metaData.url, { headers: authHeader });
    if (!dlRes.ok) {
        throw new Error('Error descargando media de WhatsApp');
    }

    const buffer = Buffer.from(await dlRes.arrayBuffer());

    // Determine extension from MIME
    const extMap = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
        'video/mp4': 'mp4', 'video/3gpp': '3gp',
        'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/amr': 'amr', 'audio/ogg': 'ogg',
        'application/pdf': 'pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'application/vnd.ms-powerpoint': 'ppt',
        'text/plain': 'txt',
    };
    const ext = extMap[mimeType] || 'bin';
    const filename = `wa_${mediaId}_${Date.now()}.${ext}`;

    const mediaDir = path.join(process.cwd(), 'uploads', 'chat-media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

    fs.writeFileSync(path.join(mediaDir, filename), buffer);

    return { localPath: `chat-media/${filename}`, mimeType };
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
                    const parsed = {
                        waMessageId: msg.id,
                        from: msg.from,
                        timestamp: msg.timestamp,
                        type: msg.type,
                        text: '',
                        mediaId: null,
                        mediaUrl: null,
                        mimeType: null,
                        filename: null,
                        caption: null,
                        location: null,
                        contacts: null,
                    };

                    switch (msg.type) {
                        case 'text':
                            parsed.text = msg.text?.body || '';
                            break;
                        case 'image':
                            parsed.mediaId = msg.image?.id;
                            parsed.mimeType = msg.image?.mime_type;
                            parsed.caption = msg.image?.caption || '';
                            parsed.text = parsed.caption || '[Imagen]';
                            break;
                        case 'video':
                            parsed.mediaId = msg.video?.id;
                            parsed.mimeType = msg.video?.mime_type;
                            parsed.caption = msg.video?.caption || '';
                            parsed.text = parsed.caption || '[Vídeo]';
                            break;
                        case 'audio':
                            parsed.mediaId = msg.audio?.id;
                            parsed.mimeType = msg.audio?.mime_type;
                            parsed.text = '[Audio]';
                            break;
                        case 'document':
                            parsed.mediaId = msg.document?.id;
                            parsed.mimeType = msg.document?.mime_type;
                            parsed.filename = msg.document?.filename || 'documento';
                            parsed.caption = msg.document?.caption || '';
                            parsed.text = parsed.caption || `[Documento: ${parsed.filename}]`;
                            break;
                        case 'sticker':
                            parsed.mediaId = msg.sticker?.id;
                            parsed.mimeType = msg.sticker?.mime_type;
                            parsed.text = '[Sticker]';
                            break;
                        case 'location':
                            parsed.location = {
                                latitude: msg.location?.latitude,
                                longitude: msg.location?.longitude,
                                name: msg.location?.name || '',
                                address: msg.location?.address || '',
                            };
                            parsed.text = '[Ubicación]';
                            break;
                        case 'contacts':
                            parsed.contacts = msg.contacts;
                            parsed.text = `[Contacto: ${msg.contacts?.[0]?.name?.formatted_name || ''}]`;
                            break;
                        default:
                            parsed.text = msg.text?.body || `[${msg.type}]`;
                            break;
                    }

                    results.messages.push(parsed);
                }
            }

            // Actualizaciones de estado (sent, delivered, read, failed)
            if (value.statuses) {
                for (const status of value.statuses) {
                    results.statuses.push({
                        waMessageId: status.id,
                        status: status.status,
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
 * Crear una plantilla de mensaje en WhatsApp Business.
 * La plantilla queda en estado PENDING hasta que Meta la aprueba.
 *
 * @param {string} name - Nombre de la plantilla (snake_case, sin espacios)
 * @param {string} category - MARKETING | UTILITY | AUTHENTICATION
 * @param {string} languageCode - Código de idioma (ej. 'es')
 * @param {Array} components - Componentes (HEADER, BODY, FOOTER, BUTTONS)
 * @returns {Promise<object>}
 */
export async function createTemplate(name, category, languageCode, components) {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (!wabaId) throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID no configurado');

    const url = `https://graph.facebook.com/${API_VERSION}/${wabaId}/message_templates`;
    const body = {
        name,
        category,
        language: languageCode,
        components,
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
        console.error('[WhatsApp] Error creando template:', data);
        throw new Error(data.error?.message || 'Error creando plantilla');
    }

    return data;
}

/**
 * Obtener TODAS las plantillas (cualquier estado) de la cuenta de WhatsApp Business.
 */
export async function fetchAllTemplates() {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (!wabaId) throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID no configurado');

    const url = `https://graph.facebook.com/${API_VERSION}/${wabaId}/message_templates`;
    const res = await fetch(url, { headers: getHeaders() });
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error?.message || 'Error obteniendo plantillas');
    }

    return (data.data || []).map(t => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components,
    }));
}

/**
 * Eliminar una plantilla por nombre.
 */
export async function deleteTemplate(templateName) {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (!wabaId) throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID no configurado');

    const url = `https://graph.facebook.com/${API_VERSION}/${wabaId}/message_templates?name=${templateName}`;
    const res = await fetch(url, {
        method: 'DELETE',
        headers: getHeaders(),
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error?.message || 'Error eliminando plantilla');
    }
    return data;
}

/**
 * Obtener plantillas de la cuenta de WhatsApp Business.
 * Devuelve todas (APPROVED, PENDING, REJECTED) para poder mostrar estado.
 */
export async function fetchTemplates() {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (!wabaId) {
        throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID no configurado');
    }

    const url = `https://graph.facebook.com/${API_VERSION}/${wabaId}/message_templates`;
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
