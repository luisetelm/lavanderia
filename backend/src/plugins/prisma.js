// javascript
// file: 'backend/src/plugins/prisma.js'
import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';

let prisma;
export default fp(async function prismaPlugin(fastify) {
    if (!prisma) prisma = new PrismaClient();
    fastify.decorate('prisma', prisma);

    fastify.addHook('onClose', async () => {
        await prisma.$disconnect();
    });
}, { name: 'prisma' });


// file: 'backend/src/server.js'
import Fastify from 'fastify';
import prismaPlugin from './plugins/prisma.js';
import cashRoutes from './routes/cash.js';

const app = Fastify({ logger: true });

// \[opcional] preHandler global que pueble request.user si usas JWT
// app.addHook('preHandler', async (request) => {
//   request.user = { id: 1 }; // ejemplo
// });

await app.register(prismaPlugin);                 // <- primero Prisma
await app.register(cashRoutes, { prefix: '/api/cash' }); // <- luego rutas

await app.listen({ port: 4000, host: '0.0.0.0' });