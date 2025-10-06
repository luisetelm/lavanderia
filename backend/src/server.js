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
import invoicesRoutes from './routes/invoices.js'; // <--- Añade esta línea
import fastifyStatic from '@fastify/static';
import path from 'path';


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
    const publicPrefixes = ['/api/auth/login', '/api/auth/register', '/invoices_pdfs/'];
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

// Servir la carpeta de PDFs de facturas de forma pública
app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'invoices_pdfs'),
    prefix: '/invoices_pdfs/',
});

// Healthcheck
app.get('/', async () => ({status: 'ok'}));

const port = parseInt(process.env.PORT || '4000', 10);
app.listen({port}, (err, address) => {
    if (err) {
        app.log.error(err);
        process.exit(1);
    }
    app.log.info(`Servidor escuchando en ${address}`);
});
