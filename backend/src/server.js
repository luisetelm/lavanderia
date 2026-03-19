import Fastify from 'fastify';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import {PrismaClient} from '@prisma/client';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';
import taskRoutes from './routes/tasks.js';
import authRoutes from './routes/auth.js';
import productsImportRoutes from './routes/products_import.js';
import cashRoutes from './routes/cash.js';
import notificationsRoutes from './routes/notifications.js';
import userRoutes from './routes/users.js';
import invoicesRoutes from './routes/invoices.js';
import stripeRoutes, { stripeWebhookRoutes } from './routes/stripe.js';
import portalRoutes from './routes/portal.js';
import whatsappRoutes, { whatsappWebhookRoutes } from './routes/whatsapp.js';
import messagesRoutes from './routes/messages.js';
import googleRoutes from './routes/google.js';
import fastifyStatic from '@fastify/static';
import path from 'path';
import cron from 'node-cron';
import { generateMonthlyInvoices } from './services/monthlyInvoicing.js';


dotenv.config();
const prisma = new PrismaClient();
const app = Fastify({logger: true});

BigInt.prototype.toJSON = function () {
    return this.toString();
};


// Decorator para acceso a Prisma desde handlers
app.decorate('prisma', prisma);

app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (request.raw.method === 'OPTIONS') {
        reply.code(204).send();
    }
});


// JWT middleware
app.addHook('preHandler', async (request, reply) => {
    const publicPrefixes = ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password', '/invoices_pdfs/', '/api/stripe/webhook', '/api/portal/', '/api/whatsapp/webhook', '/api/google/callback'];
    if (publicPrefixes.some(p => request.url.startsWith(p))) return;
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return reply.status(401).send({error: 'Missing token'});
    }
    const token = auth.slice(7);
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        request.user = payload;
    } catch (e) {
        return reply.status(401).send({error: 'Invalid token'});
    }
});

// Rutas
app.register(authRoutes, {prefix: '/api/auth'});
app.register(productRoutes, {prefix: '/api/products'});
app.register(orderRoutes, {prefix: '/api/orders'});
app.register(taskRoutes, {prefix: '/api/tasks'});
app.register(userRoutes, {prefix: '/api/users'});
app.register(productsImportRoutes, {prefix: '/api/products'}); // quedaría POST /api/products/import
app.register(cashRoutes, {prefix: '/api/cash'}); // quedaría POST /api/products/import
app.register(notificationsRoutes, {prefix: '/api/notifications'});
app.register(invoicesRoutes, {prefix: '/api/invoices'});
app.register(stripeRoutes, {prefix: '/api/stripe'});
app.register(stripeWebhookRoutes, {prefix: '/api/stripe'});
app.register(portalRoutes, {prefix: '/api/portal'});
app.register(whatsappRoutes, {prefix: '/api/whatsapp'});
app.register(whatsappWebhookRoutes, {prefix: '/api/whatsapp'});
app.register(messagesRoutes, {prefix: '/api/messages'});
app.register(googleRoutes, {prefix: '/api/google'});

// Servir la carpeta de PDFs de facturas de forma pública
app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'invoices_pdfs'),
    prefix: '/invoices_pdfs/',
});

// Healthcheck
app.get('/', async () => ({status: 'ok'}));

// Endpoint manual para generar facturas mensuales (solo admin)
app.post('/api/invoices/generate-monthly', async (req, reply) => {
    if (req.user?.role !== 'admin') {
        return reply.status(403).send({ error: 'Solo administradores pueden ejecutar esta acción' });
    }
    try {
        const result = await generateMonthlyInvoices(prisma);
        return reply.send(result);
    } catch (err) {
        console.error('Error en facturación mensual manual:', err);
        return reply.status(500).send({ error: err.message || 'Error generando facturas mensuales' });
    }
});

// Cron: facturación automática mensual - día 5 de cada mes a las 8:00 AM
cron.schedule('0 8 5 * *', async () => {
    console.log('[Cron] Ejecutando facturación mensual automática...');
    try {
        const result = await generateMonthlyInvoices(prisma);
        console.log('[Cron] Facturación mensual completada:', result);
    } catch (err) {
        console.error('[Cron] Error en facturación mensual:', err);
    }
});

const port = parseInt(process.env.PORT || '4000', 10);
app.listen({port}, (err, address) => {
    if (err) {
        app.log.error(err);
        process.exit(1);
    }
    app.log.info(`Servidor escuchando en ${address}`);
});
