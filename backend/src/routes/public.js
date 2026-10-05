// Rutas públicas, sin token: las consume la web pública (tinteyburbuja.com).
// El prefijo /api/public/ está en la lista de rutas sin autenticación de
// server.js. Aquí no sale nada que no deba ver cualquiera: sólo el precio al
// público de los productos marcados para la web. La tarifa de gran cliente y
// los precios pactados no se exponen nunca (ver docs/precios-web.md).

import { findOrCreateConversation, touchConversation, buildPhoneCandidates } from '../services/conversation.js';
import { normalizePhone, isValidPhone, TELEFONO_AYUDA } from '../utils/validatePhone.js';

const SECCIONES = ['lavado', 'tintoreria', 'hosteleria'];

// Peticiones de precio: máximo 3 por IP cada 10 minutos. En memoria, como el
// resto de límites de la app; un reinicio lo pone a cero y no pasa nada.
const PETICIONES_MAX = 3;
const PETICIONES_VENTANA_MS = 10 * 60 * 1000;
const peticionesPorIp = new Map();
function superaLimite(ip) {
    const ahora = Date.now();
    const lista = (peticionesPorIp.get(ip) || []).filter((t) => ahora - t < PETICIONES_VENTANA_MS);
    if (lista.length >= PETICIONES_MAX) return true;
    lista.push(ahora);
    peticionesPorIp.set(ip, lista);
    return false;
}

const limpiar = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const CACHE_SEGUNDOS = 15 * 60; // 15 minutos: un cambio de precio tarda eso en verse en la web

// "EDREDON 1.35/1.50CM" -> "Edredon 1.35/1.50cm". Es el nombre de reserva
// cuando el producto no tiene nombre para la web.
function nombreFrase(name) {
    const t = String(name || '').trim().toLowerCase();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

export default async function publicRoutes(fastify) {
    const prisma = fastify.prisma;

    // Precios publicados, agrupados por sección de la web. El precio es con IVA
    // incluido y es el mismo que se cobra en el mostrador (basePrice).
    fastify.get('/prices', async (req, reply) => {
        const productos = await prisma.product.findMany({
            where: { webSection: { in: SECCIONES }, archivedAt: null },
            select: { id: true, name: true, webName: true, webSection: true, webOrder: true, basePrice: true, description: true, type: true, updatedAt: true },
            orderBy: [{ webOrder: 'asc' }, { name: 'asc' }],
        });

        const secciones = Object.fromEntries(SECCIONES.map((s) => [s, []]));
        let actualizado = null;
        for (const p of productos) {
            secciones[p.webSection].push({
                id: p.id,
                name: p.webName || nombreFrase(p.name),
                // Sólo las secciones de particulares llevan precio: a hostelería se
                // le hace presupuesto y se le factura a fin de mes.
                price: p.webSection === 'hosteleria' ? null : Math.round(p.basePrice * 100) / 100,
                unit: /\bkg\b/i.test(p.name) ? 'kg' : 'prenda',
            });
            if (!actualizado || p.updatedAt > actualizado) actualizado = p.updatedAt;
        }

        reply.header('Cache-Control', `public, max-age=${CACHE_SEGUNDOS}`);
        return { currency: 'EUR', vatIncluded: true, updatedAt: actualizado, sections: secciones };
    });

    // Alguien quiere saber un precio y deja su teléfono. Entra en el chat de la
    // app como una conversación con un mensaje del canal 'web', para que quien
    // atienda le escriba por WhatsApp y empiece la conversación desde ahí.
    // Si el teléfono es de un cliente conocido, la conversación queda vinculada.
    fastify.post('/price-request', async (req, reply) => {
        const body = req.body || {};
        // Campo trampa para bots: un humano no lo ve ni lo rellena.
        if (body.website) return reply.code(204).send();
        if (superaLimite(req.ip)) return reply.code(429).send({ error: 'Demasiadas peticiones seguidas. Prueba en unos minutos o escríbenos por WhatsApp.' });

        const phone = normalizePhone(limpiar(body.phone, 30));
        if (!isValidPhone(phone)) return reply.code(400).send({ error: TELEFONO_AYUDA });
        const name = limpiar(body.name, 80);
        const item = limpiar(body.item, 300);
        if (!item) return reply.code(400).send({ error: 'Dinos de qué prenda o servicio quieres saber el precio.' });

        const client = await prisma.user.findFirst({
            where: { phone: { in: buildPhoneCandidates(phone) } },
            select: { id: true },
        });
        const conversation = await findOrCreateConversation(prisma, { clientId: client?.id || null, phone });
        await prisma.message.create({
            data: {
                channel: 'web',
                direction: 'inbound',
                clientId: client?.id || null,
                phone,
                content: `Pide precio desde la web: ${item}${name ? ` · Nombre: ${name}` : ''}`,
                status: 'received',
                conversationId: conversation.id,
            },
        });
        await touchConversation(prisma, conversation.id, { incrementUnread: true });
        req.log.info({ conversationId: conversation.id, cliente: client?.id || null }, 'Petición de precio desde la web');
        return reply.code(201).send({ ok: true });
    });
}
