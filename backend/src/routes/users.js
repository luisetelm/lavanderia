// backend/src/routes/users.js
import { hash } from 'bcrypt';

const isValidSpanishPhone = (phone) => /^[6789]\d{8}$/.test(phone);

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    // Listar usuarios
    fastify.get('/', async (req, reply) => {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                phone: true,
                isActive: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        return users;
    });

    // Obtener uno
    fastify.get('/:id', async (req, reply) => {
        const { id } = req.params;
        const user = await prisma.user.findUnique({
            where: { id: Number(id) },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                phone: true,
                isActive: true,
            },
        });
        if (!user) return reply.status(404).send({ error: 'Usuario no encontrado' });
        return user;
    });

    // Crear usuario
    fastify.post('/', async (req, reply) => {
        const { firstName, lastName, email, password, role, phone, isActive } = req.body;

        if (!firstName || !lastName || !email || !password) {
            return reply.status(400).send({ error: 'firstName, lastName, email y password son obligatorios' });
        }
        if (phone && !isValidSpanishPhone(phone)) {
            return reply.status(400).send({ error: 'Teléfono inválido. Formato español, p.ej. 600123456' });
        }

        const exists = await prisma.user.findUnique({ where: { email } });
        if (exists) return reply.status(400).send({ error: 'Email ya registrado' });

        const hashed = await hash(password, 10);
        const user = await prisma.user.create({
            data: {
                firstName,
                lastName,
                email,
                password: hashed,
                role: role || 'customer',
                phone: phone || null,
                isActive: isActive !== undefined ? isActive : true,
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                phone: true,
                isActive: true,
            },
        });
        return reply.status(201).send(user);
    });

    // Editar usuario
    fastify.put('/:id', async (req, reply) => {
        const { id } = req.params;
        const { firstName, lastName, email, password, role, phone, isActive } = req.body;
        const data = {};
        if (firstName !== undefined) data.firstName = firstName;
        if (lastName !== undefined) data.lastName = lastName;
        if (email !== undefined) data.email = email;
        if (role !== undefined) data.role = role;
        if (phone !== undefined) {
            if (phone && !isValidSpanishPhone(phone)) {
                return reply.status(400).send({ error: 'Teléfono inválido. Formato español, p.ej. 600123456' });
            }
            data.phone = phone;
        }
        if (isActive !== undefined) data.isActive = isActive;
        if (password) {
            data.password = await hash(password, 10);
        }

        try {
            const user = await prisma.user.update({
                where: { id: Number(id) },
                data,
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                    phone: true,
                    isActive: true,
                },
            });
            return user;
        } catch (e) {
            return reply.status(404).send({ error: 'Usuario no encontrado' });
        }
    });

    // Activar/desactivar
    fastify.patch('/:id/activate', async (req, reply) => {
        const { id } = req.params;
        const { isActive } = req.body;
        if (typeof isActive !== 'boolean') return reply.status(400).send({ error: 'isActive booleano requerido' });
        try {
            const user = await prisma.user.update({
                where: { id: Number(id) },
                data: { isActive },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    isActive: true,
                },
            });
            return user;
        } catch {
            return reply.status(404).send({ error: 'Usuario no encontrado' });
        }
    });
}
