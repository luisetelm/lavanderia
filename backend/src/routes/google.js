import { getAuthUrl, exchangeCode, fetchReviews, replyToReview } from '../services/google.js';

export default async function (fastify) {
    const prisma = fastify.prisma;

    // Iniciar OAuth2 flow (solo admin)
    fastify.get('/auth', async (req, reply) => {
        if (req.user?.role !== 'admin') {
            return reply.code(403).send({ error: 'Solo admin' });
        }
        const url = getAuthUrl();
        return reply.redirect(url);
    });

    // OAuth2 callback
    fastify.get('/callback', async (req, reply) => {
        const { code, error } = req.query;

        if (error) {
            return reply.code(400).send({ error: `Google OAuth error: ${error}` });
        }

        if (!code) {
            return reply.code(400).send({ error: 'Código no proporcionado' });
        }

        try {
            const tokens = await exchangeCode(code);

            if (!tokens.access_token) {
                return reply.code(400).send({ error: 'No se pudo obtener access token', details: tokens });
            }

            // Guardar tokens
            await prisma.appSettings.upsert({
                where: { key: 'google_access_token' },
                update: { value: tokens.access_token },
                create: { key: 'google_access_token', value: tokens.access_token },
            });

            if (tokens.refresh_token) {
                await prisma.appSettings.upsert({
                    where: { key: 'google_refresh_token' },
                    update: { value: tokens.refresh_token },
                    create: { key: 'google_refresh_token', value: tokens.refresh_token },
                });
            }

            const baseUrl = process.env.APP_URL || 'https://app.tinteyburbuja.com';
            return reply.redirect(`${baseUrl}/resenas?google_connected=1`);
        } catch (e) {
            console.error('[Google] Error en callback:', e);
            return reply.code(500).send({ error: e.message });
        }
    });

    // Estado de conexión
    fastify.get('/status', async (req, reply) => {
        const token = await prisma.appSettings.findUnique({ where: { key: 'google_access_token' } });
        return reply.send({ connected: !!token?.value });
    });

    // Listar reseñas
    fastify.get('/reviews', async (req, reply) => {
        try {
            const reviews = await fetchReviews(prisma);
            return reply.send(reviews);
        } catch (e) {
            console.error('[Google] Error obteniendo reseñas:', e);
            return reply.code(500).send({ error: e.message });
        }
    });

    // Responder a una reseña
    fastify.post('/reviews/:reviewId/reply', async (req, reply) => {
        if (req.user?.role !== 'admin') {
            return reply.code(403).send({ error: 'Solo admin' });
        }

        const { reviewId } = req.params;
        const { comment } = req.body;

        if (!comment?.trim()) {
            return reply.code(400).send({ error: 'El comentario es obligatorio' });
        }

        try {
            const result = await replyToReview(prisma, reviewId, comment.trim());
            return reply.send({ ok: true, reply: result });
        } catch (e) {
            console.error('[Google] Error respondiendo reseña:', e);
            return reply.code(500).send({ error: e.message });
        }
    });
}
