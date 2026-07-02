// backend/src/routes/campaigns.js
// Campañas de marketing por WhatsApp (solo admin).

import {
    sendTemplateMessage,
    fetchTemplates,
    formatWhatsAppPhone,
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

// Construye el filtro Prisma de audiencia a partir de los filtros del cliente
function buildAudienceWhere(filters = {}) {
    const where = {
        role: 'customer',
        phone: { not: null },
        // Consentimiento: usar el canal actual. Excluye solo a quien optó por 'none'.
        notifyChannel: { not: 'none' },
    };

    // Restringir a quienes tienen WhatsApp como canal (o sin preferencia explícita)
    if (filters.onlyWhatsApp) {
        where.notifyChannel = { in: ['whatsapp', null] };
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

        // Determinar nº de variables de la plantilla para pasar el nombre en {{1}}
        let bodyVariables = 0;
        try {
            const templates = await fetchTemplates();
            const tpl = templates.find(t => t.name === campaign.templateName);
            bodyVariables = countBodyVariables(tpl);
        } catch (e) {
            console.warn('[Campaigns] No se pudieron leer las plantillas:', e.message);
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
                        ? [{ type: 'body', parameters: [{ type: 'text', text: toTitleCase(rec.firstName) || 'cliente' }] }]
                        : [];

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

            await prisma.campaign.update({
                where: { id },
                data: { status: 'completed', sentCount: sent, failedCount: failed },
            });
            console.log(`[Campaigns] Campaña #${id} completada: ${sent} enviados, ${failed} fallidos`);
        })().catch(err => {
            console.error(`[Campaigns] Error enviando campaña #${id}:`, err);
            prisma.campaign.update({ where: { id }, data: { status: 'completed' } }).catch(() => {});
        });
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

