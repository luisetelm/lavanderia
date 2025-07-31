import { hash, compare } from 'bcrypt';
import jwt from 'jsonwebtoken';

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    fastify.post('/register', async (req, reply) => {
        const { firstName, lastName, email, password, role, phone } = req.body;
        const existing = await prisma.user.findUnique({ where: { phone } });
        if (existing) return reply.status(400).send({ error: 'Phone already used' });
        const hashed = await hash(password, 10);
        const user = await prisma.user.create({
            data: { firstName, lastName, email, password: hashed, role: role || 'cashier', phone },
        });
        return reply.send({ id: user.id, email: user.email });
    });

    fastify.post('/login', async (req, reply) => {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return reply.status(401).send({ error: 'Invalid credentials' });
        const valid = await compare(password, user.password);
        if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });
        const token = jwt.sign({ userId: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
        return reply.send({ token, user: { id: user.id, name: user.name, role: user.role } });
    });
}
