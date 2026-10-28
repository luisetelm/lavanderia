// backend/src/routes/campaigns.js
// Campañas de marketing por WhatsApp (solo admin).

import {
    sendTemplateMessage,
    fetchTemplates,
    formatWhatsAppPhone,
    uploadMediaBuffer,
} from '../services/whatsapp.js';
import { findOrCreateConversation, touchConversation } from '../services/conversation.js';
import { normalizePhone } from '../utils/validatePhone.js';

// Capitaliza el nombre: "MARI CARMEN" -> "Mari Carmen"
function toTitleCase(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/(^|[\s'-])([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ])/g, (_, sep, chr) => sep + chr.toUpperCase());
}

// Cuenta cuántas variables {{n}} tiene el BODY de una plantilla
function countBodyVariables(template) {
    const body = (template?.components || []).find(c => (c.type || '').toUpperCase() === 'BODY');
    if (!body?.text) return 0;
    const matches = body.text.match(/\{\{\s*\d+\s*\}\}/g);
    return matches ? new Set(matches).size : 0;
}

// Partes de la plantilla que no son el cuerpo y que Meta pide rellenar en cada
// envío. Si falta alguna, Meta rechaza todos los mensajes con el error #132012.
const ARCHIVO_CABECERA = {
    IMAGE: { type: 'image', nombre: 'una imagen', mime: 'image/jpeg', ext: 'jpg' },
    VIDEO: { type: 'video', nombre: 'un vídeo', mime: 'video/mp4', ext: 'mp4' },
    DOCUMENT: { type: 'document', nombre: 'un documento', mime: 'application/pdf', ext: 'pdf' },
};
const tieneVariables = (texto) => /\{\{[^}]+\}\}/.test(texto || '');

/**
 * Componentes fijos (iguales para todos los destinatarios) que necesita la
 * plantilla además del cuerpo. La imagen, vídeo o documento de la cabecera es el
 * mismo con el que Meta aprobó la plantilla: se descarga y se sube una vez a
 * WhatsApp para adjuntarlo a cada mensaje.
 * Lanza un Error con el motivo, en castellano, si hay algo que no sabemos rellenar.
 */
async function componentesFijos(template) {
    const comps = template?.components || [];
    const resultado = [];

    const cabecera = comps.find(c => (c.type || '').toUpperCase() === 'HEADER');
    const formato = (cabecera?.format || '').toUpperCase();
    if (formato === 'TEXT' && tieneVariables(cabecera.text)) {
        throw new Error('La plantilla tiene una variable en el título y las campañas aún no saben rellenarla. Usa una plantilla con el título fijo.');
    }
    const archivo = ARCHIVO_CABECERA[formato];
    if (archivo) {
        const url = cabecera.example?.header_handle?.[0];
        if (!url) {
            throw new Error(`La plantilla lleva ${archivo.nombre} en la cabecera y Meta no devuelve el archivo con el que se aprobó.`);
        }
        let mediaId;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const mime = (res.headers.get('content-type') || archivo.mime).split(';')[0];
            const buffer = Buffer.from(await res.arrayBuffer());
            mediaId = await uploadMediaBuffer(buffer, mime, `cabecera-${template.name}.${archivo.ext}`);
        } catch (e) {
            throw new Error(`No se pudo preparar ${archivo.nombre} de la cabecera de la plantilla (${e.message}). Prueba otra vez en unos minutos.`);
        }
        resultado.push({ type: 'header', parameters: [{ type: archivo.type, [archivo.type]: { id: mediaId } }] });
    } else if (formato === 'LOCATION') {
        throw new Error('La plantilla lleva una ubicación en la cabecera y las campañas aún no saben enviarla.');
    }

    const botones = comps.find(c => (c.type || '').toUpperCase() === 'BUTTONS')?.buttons || [];
    if (botones.some(b => (b.type || '').toUpperCase() === 'URL' && tieneVariables(b.url))) {
        throw new Error('La plantilla tiene un botón con un enlace variable y las campañas aún no saben rellenarlo. Usa un enlace fijo.');
    }

    const cuerpo = comps.find(c => (c.type || '').toUpperCase() === 'BODY');
    if (tieneVariables(cuerpo?.text) && countBodyVariables(template) === 0) {
        throw new Error('La plantilla usa variables con nombre (como {{nombre}}) y las campañas sólo rellenan {{1}} con el nombre del cliente.');
    }
    if (countBodyVariables(template) > 1) {
        throw new Error('La plantilla tiene más de una variable y las campañas sólo rellenan {{1}} con el nombre del cliente.');
    }
    return resultado;
}

// Construye el filtro Prisma de audiencia a partir de los filtros del cliente
function buildAudienceWhere(filters = {}) {
    const where = {
        role: 'customer',
        phone: { not: null },
        // Consentimiento: usar el canal actual. Excluye solo a quien optó por 'none'.
        notifyChannel: { not: 'none' },
    };

    // Restringir a quienes tienen WhatsApp como canal (o sin preferencia explícita)
    // Prisma no admite null dentro de `in`, así que usamos OR con equals/null.
    if (filters.onlyWhatsApp) {
        delete where.notifyChannel;
        where.OR = [
            { notifyChannel: 'whatsapp' },
            { notifyChannel: null },
        ];
    }

    // Clientes con al menos un pedido en los últimos N meses
    if (filters.lastOrderMonths) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - Number(filters.lastOrderMonths));
        where.orders = { some: { createdAt: { gte: cutoff } } };
    }

    return where;
}

export default async function (fastify) {
    const prisma = fastify.prisma;

    const requireAdmin = (req, reply) => {
        if (req.user?.role !== 'admin') {
            reply.code(403).send({ error: 'Solo administradores' });
            return false;
        }
        return true;
    };

    // Plantillas disponibles (marca las de marketing aprobadas)
    fastify.get('/templates', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const templates = await fetchTemplates();
            const enriched = templates.map(t => ({
                ...t,
                bodyVariables: countBodyVariables(t),
                usable: t.status === 'APPROVED',
                isMarketing: (t.category || '').toUpperCase() === 'MARKETING',
            }));
            return reply.send(enriched);
        } catch (e) {
            return reply.code(500).send({ error: e.message || 'Error obteniendo plantillas' });
        }
    });

    // Previsualizar audiencia según filtros: nº total + muestra
    fastify.post('/audience/preview', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const where = buildAudienceWhere(req.body?.filters || {});
            const [count, sample] = await Promise.all([
                prisma.user.count({ where }),
                prisma.user.findMany({
                    where,
                    select: { id: true, firstName: true, lastName: true, phone: true },
                    take: 20,
                    orderBy: { id: 'desc' },
                }),
            ]);
            return reply.send({ count, sample });
        } catch (e) {
            return reply.code(500).send({ error: e.message || 'Error calculando audiencia' });
        }
    });

    // Listar campañas
    fastify.get('/', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const campaigns = await prisma.campaign.findMany({
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        return reply.send(campaigns);
    });

    // Detalle de una campaña con estadísticas
    fastify.get('/:id', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const id = Number(req.params.id);
        const campaign = await prisma.campaign.findUnique({ where: { id } });
        if (!campaign) return reply.code(404).send({ error: 'Campaña no encontrada' });

        const recipients = await prisma.campaignRecipient.findMany({
            where: { campaignId: id },
            orderBy: { id: 'asc' },
            take: 500,
        });
        const stats = recipients.reduce((acc, r) => {
            acc[r.status] = (acc[r.status] || 0) + 1;
            return acc;
        }, {});
        return reply.send({ campaign, recipients, stats });
    });

    // Crear campaña (snapshot de la audiencia como destinatarios en estado 'pending')
    fastify.post('/', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const { name, templateName, language = 'es', filters = {} } = req.body || {};
        if (!name || !templateName) {
            return reply.code(400).send({ error: 'name y templateName son obligatorios' });
        }
        try {
            const where = buildAudienceWhere(filters);
            const audience = await prisma.user.findMany({
                where,
                select: { id: true, firstName: true, phone: true },
            });

            if (audience.length === 0) {
                return reply.code(400).send({ error: 'La audiencia seleccionada no tiene destinatarios' });
            }

            const campaign = await prisma.campaign.create({
                data: {
                    name,
                    templateName,
                    language,
                    filters,
                    status: 'draft',
                    totalRecipients: audience.length,
                    createdBy: req.user?.userId || null,
                },
            });

            await prisma.campaignRecipient.createMany({
                data: audience.map(u => ({
                    campaignId: campaign.id,
                    clientId: u.id,
                    phone: u.phone,
                    firstName: u.firstName || null,
                    status: 'pending',
                })),
            });

            return reply.send(campaign);
        } catch (e) {
            return reply.code(500).send({ error: e.message || 'Error creando campaña' });
        }
    });

    // Enviar campaña (en segundo plano, por lotes con pausa entre envíos)
    fastify.post('/:id/send', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const id = Number(req.params.id);
        const campaign = await prisma.campaign.findUnique({ where: { id } });
        if (!campaign) return reply.code(404).send({ error: 'Campaña no encontrada' });
        if (campaign.status === 'sending') {
            return reply.code(409).send({ error: 'La campaña ya se está enviando' });
        }
        if (campaign.status === 'completed') {
            return reply.code(409).send({ error: 'La campaña ya se envió' });
        }

        // Antes de empezar se mira la plantilla: nº de variables del cuerpo ({{1}} es
        // el nombre) y lo que haya que adjuntar siempre (imagen de cabecera). Si algo
        // no se puede rellenar, la campaña no empieza: antes fallaba con cada cliente.
        let templates;
        try {
            templates = await fetchTemplates();
        } catch (e) {
            return reply.code(502).send({ error: `No se pudieron leer las plantillas de WhatsApp: ${e.message}` });
        }
        const tpl = templates.find(t => t.name === campaign.templateName && t.language === campaign.language)
            || templates.find(t => t.name === campaign.templateName);
        if (!tpl) {
            return reply.code(400).send({ error: `No se encuentra la plantilla «${campaign.templateName}» en WhatsApp. Puede que se haya borrado.` });
        }
        if (tpl.status !== 'APPROVED') {
            return reply.code(400).send({ error: `La plantilla «${campaign.templateName}» no está aprobada por Meta (estado: ${tpl.status}).` });
        }
        const bodyVariables = countBodyVariables(tpl);
        let fijos;
        try {
            fijos = await componentesFijos(tpl);
        } catch (e) {
            return reply.code(400).send({ error: e.message });
        }

        await prisma.campaign.update({ where: { id }, data: { status: 'sending' } });
        reply.send({ ok: true, status: 'sending' });

        // ── Envío asíncrono (no bloquea la respuesta) ──
        const DELAY_MS = Number.parseInt(process.env.CAMPAIGN_SEND_DELAY_MS || '250', 10);
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        (async () => {
            let sent = 0;
            let failed = 0;
            const pending = await prisma.campaignRecipient.findMany({
                where: { campaignId: id, status: 'pending' },
            });

            for (const rec of pending) {
                try {
                    const normalized = normalizePhone(rec.phone || '');
                    if (!normalized) throw new Error('Teléfono inválido');

                    const components = bodyVariables >= 1
                        ? [...fijos, { type: 'body', parameters: [{ type: 'text', text: toTitleCase(rec.firstName) || 'cliente' }] }]
                        : fijos;

                    const response = await sendTemplateMessage(
                        normalized,
                        campaign.templateName,
                        campaign.language,
                        components,
                    );
                    const waMessageId = response?.messages?.[0]?.id || null;

                    // Registrar en Message + conversación (para trazabilidad y webhook)
                    let conversation = null;
                    try {
                        conversation = await findOrCreateConversation(prisma, {
                            clientId: rec.clientId || null,
                            phone: normalized,
                        });
                    } catch { /* noop */ }

                    await prisma.message.create({
                        data: {
                            externalId: waMessageId,
                            channel: 'whatsapp',
                            direction: 'outbound',
                            clientId: rec.clientId || null,
                            phone: normalized,
                            content: `[Campaña: ${campaign.name}]`,
                            templateName: campaign.templateName,
                            status: 'sent',
                            conversationId: conversation?.id || null,
                        },
                    });
                    if (conversation?.id) await touchConversation(prisma, conversation.id);

                    await prisma.campaignRecipient.update({
                        where: { id: rec.id },
                        data: { status: 'sent', externalId: waMessageId, sentAt: new Date() },
                    });
                    sent++;
                } catch (err) {
                    await prisma.campaignRecipient.update({
                        where: { id: rec.id },
                        data: { status: 'failed', error: (err.message || 'Error').slice(0, 255) },
                    });
                    failed++;
                }
                await sleep(DELAY_MS);
            }

            // Totales de toda la campaña (también de envíos anteriores si se
            // reintentaron los fallidos), no sólo de esta pasada
            const [totalEnviados, totalFallidos] = await Promise.all([
                prisma.campaignRecipient.count({ where: { campaignId: id, status: 'sent' } }),
                prisma.campaignRecipient.count({ where: { campaignId: id, status: 'failed' } }),
            ]);
            await prisma.campaign.update({
                where: { id },
                data: { status: 'completed', sentCount: totalEnviados, failedCount: totalFallidos },
            });
            console.log(`[Campaigns] Campaña #${id} completada: ${sent} enviados, ${failed} fallidos`);
        })().catch(err => {
            console.error(`[Campaigns] Error enviando campaña #${id}:`, err);
            prisma.campaign.update({ where: { id }, data: { status: 'completed' } }).catch(() => {});
        });
    });

    // Reintentar los destinatarios que fallaron: vuelven a pendientes y la campaña
    // a borrador, para enviarla otra vez sólo a ellos (los ya enviados no se repiten)
    fastify.post('/:id/retry-failed', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const id = Number(req.params.id);
        const campaign = await prisma.campaign.findUnique({ where: { id } });
        if (!campaign) return reply.code(404).send({ error: 'Campaña no encontrada' });
        if (campaign.status !== 'completed') {
            return reply.code(409).send({ error: 'Sólo se pueden reintentar los fallidos de una campaña ya terminada' });
        }
        const { count } = await prisma.campaignRecipient.updateMany({
            where: { campaignId: id, status: 'failed' },
            data: { status: 'pending', error: null },
        });
        if (!count) return reply.code(409).send({ error: 'La campaña no tiene destinatarios fallidos' });
        await prisma.campaign.update({ where: { id }, data: { status: 'draft', failedCount: 0 } });
        return reply.send({ ok: true, retried: count });
    });

    // Eliminar campaña (solo si es borrador)
    fastify.delete('/:id', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        const id = Number(req.params.id);
        const campaign = await prisma.campaign.findUnique({ where: { id } });
        if (!campaign) return reply.code(404).send({ error: 'Campaña no encontrada' });
        if (campaign.status === 'sending') {
            return reply.code(409).send({ error: 'No se puede eliminar una campaña en envío' });
        }
        await prisma.campaign.delete({ where: { id } });
        return reply.send({ ok: true });
    });
}

