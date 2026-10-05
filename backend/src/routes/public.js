// Rutas públicas, sin token: las consume la web pública (tinteyburbuja.com).
// El prefijo /api/public/ está en la lista de rutas sin autenticación de
// server.js. Aquí no sale nada que no deba ver cualquiera: sólo el precio al
// público de los productos marcados para la web. La tarifa de gran cliente y
// los precios pactados no se exponen nunca (ver docs/precios-web.md).

import { findOrCreateConversation, touchConversation, buildPhoneCandidates } from '../services/conversation.js';
import { normalizePhone, isValidPhone, TELEFONO_AYUDA } from '../utils/validatePhone.js';
import { sendTemplateMessage, PLANTILLA_PRECIO_WEB, componentesPrecioWeb } from '../services/whatsapp.js';

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

const euros = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unidad = (p) => (/\bkg\b/i.test(p.name) ? 'kg' : 'prenda');
const textoPrecio = (p) => `${euros.format(p.basePrice)} € por ${unidad(p)}`;
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

    // Alguien quiere saber un precio y deja su teléfono.
    //
    // Con productId (un producto publicado con precio): se le manda al momento la
    // plantilla precio_web por WhatsApp con el nombre y el precio. Sólo se puede
    // escribir por plantilla a quien no ha escrito antes; si contesta, se abre
    // la ventana de 24 horas y el equipo sigue la conversación desde el chat.
    //
    // Sin productId (otra prenda, o un producto de hostelería, sin precio
    // público): entra en el chat como mensaje del canal 'web' y el equipo
    // contesta por WhatsApp, con plantilla, como a cualquier número nuevo.
    //
    // En los dos casos queda en el chat de la app, vinculado al cliente si el
    // teléfono es de uno conocido.
    fastify.post('/price-request', async (req, reply) => {
        const body = req.body || {};
        // Campo trampa para bots: un humano no lo ve ni lo rellena.
        if (body.website) return reply.code(204).send();
        if (superaLimite(req.ip)) return reply.code(429).send({ error: 'Demasiadas peticiones seguidas. Prueba en unos minutos o escríbenos por WhatsApp.' });

        const phone = normalizePhone(limpiar(body.phone, 30));
        if (!isValidPhone(phone)) return reply.code(400).send({ error: TELEFONO_AYUDA });
        const name = limpiar(body.name, 80);
        const item = limpiar(body.item, 300);
        const productId = Number.parseInt(body.productId, 10);

        let producto = null;
        if (Number.isInteger(productId)) {
            producto = await prisma.product.findFirst({
                where: { id: productId, webSection: { in: ['lavado', 'tintoreria'] }, archivedAt: null },
                select: { id: true, name: true, webName: true, basePrice: true },
            });
            if (!producto) return reply.code(400).send({ error: 'Ese producto no está en la tarifa de la web.' });
        } else if (!item) {
            return reply.code(400).send({ error: 'Dinos de qué prenda o servicio quieres saber el precio.' });
        }

        const client = await prisma.user.findFirst({
            where: { phone: { in: buildPhoneCandidates(phone) } },
            select: { id: true },
        });
        const conversation = await findOrCreateConversation(prisma, { clientId: client?.id || null, phone });
        const base = { clientId: client?.id || null, phone, conversationId: conversation.id };

        const descripcion = producto ? (producto.webName || nombreFrase(producto.name)) : item;
        await prisma.message.create({
            data: { ...base, channel: 'web', direction: 'inbound', status: 'received',
                content: `Pide precio desde la web: ${descripcion}${name ? ` · Nombre: ${name}` : ''}` },
        });

        let sent = false;
        if (producto) {
            const precio = textoPrecio(producto);
            try {
                const wa = await sendTemplateMessage(phone, PLANTILLA_PRECIO_WEB.name, PLANTILLA_PRECIO_WEB.language, componentesPrecioWeb(descripcion, precio));
                await prisma.message.create({
                    data: { ...base, channel: 'whatsapp', direction: 'outbound', status: 'sent',
                        externalId: wa?.messages?.[0]?.id || null,
                        templateName: PLANTILLA_PRECIO_WEB.name,
                        content: `[Template: ${PLANTILLA_PRECIO_WEB.name}] ${descripcion}: ${precio}` },
                });
                sent = true;
            } catch (e) {
                // Plantilla sin aprobar, WhatsApp sin configurar o número sin WhatsApp:
                // queda la petición en el chat y el equipo contesta a mano.
                req.log.warn({ err: e.message, phone }, 'No se pudo enviar la plantilla precio_web; queda para contestar a mano');
            }
        }

        // Sin leer siempre: aunque la plantilla haya salido, el equipo debe ver el interés.
        await touchConversation(prisma, conversation.id, { incrementUnread: true });
        req.log.info({ conversationId: conversation.id, cliente: client?.id || null, productId: producto?.id || null, sent }, 'Petición de precio desde la web');
        return reply.code(201).send({ ok: true, sent });
    });
}
