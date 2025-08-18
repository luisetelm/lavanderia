// backend/src/routes/users.js
import { hash } from 'bcrypt';

const isValidSpanishPhone = (phone) => /^[6789]\d{8}$/.test(phone);

export default async function (fastify, opts) {
    const prisma = fastify.prisma;


    // Listar usuarios
    fastify.get('/', async (req, reply) => {
        const { q, page = 0, size = 50 } = req.query;
        const pageNum = parseInt(page) || 0;
        const pageSize = parseInt(size) || 50;
        const skip = pageNum * pageSize;

        // Construir el filtro de búsqueda si existe un término
        const where = {};
        if (q) {
            where.OR = [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } }
            ];
        }

        // Obtener el total de registros para la paginación
        const total = await prisma.user.count({ where });

        // Obtener los usuarios con paginación
        const users = await prisma.user.findMany({
            where,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                phone: true,
                isActive: true,
                createdAt: true,
                denominacionsocial: true,
                nif: true,
                tipopersona: true,
                direccion: true,
                localidad: true,
                provincia: true,
                codigopostal: true,
                pais: true,
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize,
        });

        // Calcular metadatos de paginación
        const totalPages = Math.ceil(total / pageSize);

        // Construir respuesta con metadatos
        return {
            data: users,
            meta: {
                total,
                page: pageNum,
                size: pageSize,
                totalPages,
                hasNextPage: pageNum < totalPages - 1,
                hasPrevPage: pageNum > 0
            }
        };
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
                denominacionsocial: true,
                nif: true,
                tipopersona: true,
                direccion: true,
                localidad: true,
                provincia: true,
                codigopostal: true,
                pais: true,
            },
        });
        if (!user) return reply.status(404).send({ error: 'Usuario no encontrado' });
        return user;
    });

    // Crear usuario
    fastify.post('/', async (req, reply) => {
        const { firstName, lastName, email, password, role, phone, isActive,
            denominacionsocial, nif, tipopersona, direccion, localidad, provincia, codigopostal, pais } = req.body;

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
                denominacionsocial: denominacionsocial || null,
                nif: nif || null,
                tipopersona: tipopersona || null,
                direccion: direccion || null,
                localidad: localidad || null,
                provincia: provincia || null,
                codigopostal: codigopostal || null,
                pais: pais || null,
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                phone: true,
                isActive: true,
                denominacionsocial: true,
                nif: true,
                tipopersona: true,
                direccion: true,
                localidad: true,
                provincia: true,
                codigopostal: true,
                pais: true,
            },
        });
        return reply.status(201).send(user);
    });

    // Editar usuario
    fastify.put('/:id', async (req, reply) => {
        const { id } = req.params;
        const { firstName, lastName, email, password, role, phone, isActive,
            denominacionsocial, nif, tipopersona, direccion, localidad, provincia, codigopostal, pais } = req.body;
        const data = {
            firstName,
            lastName,
            email: email?.trim() !== '' ? email : null,
            role,
            phone,
            isActive,
            denominacionsocial,
            nif,
            tipopersona,
            direccion,
            localidad,
            provincia,
            codigopostal,
            pais,
        };
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
                    denominacionsocial: true,
                    nif: true,
                    tipopersona: true,
                    direccion: true,
                    localidad: true,
                    provincia: true,
                    codigopostal: true,
                    pais: true,
                },
            });
            return user;
        } catch (e) {
            console.log(e);
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
