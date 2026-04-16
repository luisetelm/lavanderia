// backend/src/routes/users.js
import {hash} from 'bcrypt';

import nodemailer from 'nodemailer';
import { emailTemplate } from '../utils/emailTemplate.js';

const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: false, requireTLS: true, auth: {
        user: process.env.SMTP_USER, pass: process.env.SMTP_PASS
    }
});

const sendWelcomeEmail = async (email, firstName, lastName, password) => {
    const mailOptions = {
        from: {name: process.env.FROM_NAME, address: process.env.FROM_EMAIL},
        to: email,
        subject: 'Bienvenido - Credenciales de acceso',
        html: emailTemplate({
            title: `¡Bienvenido ${firstName}!`,
            body: `
                <p>Hola <strong>${firstName} ${lastName}</strong>,</p>
                <p>Tu cuenta ha sido creada exitosamente.</p>
                <p><strong>Tus credenciales de acceso son:</strong></p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                    <tr>
                        <td style="padding: 10px 14px; background: #f1f5f9; border-radius: 6px 6px 0 0; border-bottom: 1px solid #e2e8f0;">
                            <strong>Email:</strong>
                        </td>
                        <td style="padding: 10px 14px; background: #f1f5f9; border-radius: 6px 6px 0 0; border-bottom: 1px solid #e2e8f0;">
                            ${email}
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 14px; background: #f1f5f9; border-radius: 0 0 6px 6px;">
                            <strong>Contraseña:</strong>
                        </td>
                        <td style="padding: 10px 14px; background: #f1f5f9; border-radius: 0 0 6px 6px;">
                            ${password}
                        </td>
                    </tr>
                </table>
                <p style="font-size: 13px; color: #94a3b8;">
                    Por favor, guarda esta información en un lugar seguro.
                </p>
            `,
        }),
    };

    try {
        await emailTransporter.sendMail(mailOptions);
        console.log(`Email enviado a ${email}`);
    } catch (error) {
        console.error('Error enviando email:', error);
    }
};

import { isValidSpanishPhone, normalizePhone } from '../utils/validatePhone.js';

export default async function (fastify, opts) {
    const prisma = fastify.prisma;

    // Listar usuarios
    fastify.get('/', async (req, reply) => {
        const {q, page = 0, size = 50, role} = req.query;
        const pageNum = parseInt(page) || 0;
        const pageSize = parseInt(size) || 50;
        const skip = pageNum * pageSize;

        // Construir el filtro de búsqueda si existe un término
        const where = {};

        // Añadir filtro de rol si se proporciona
        if (role) {
            where.role = role;
        }

        if (q) {
            const words = q.trim().split(/\s+/);
            if (words.length > 1) {
                // Multi-word: each word must match firstName OR lastName
                where.AND = words.map(w => ({
                    OR: [
                        { firstName: { contains: w, mode: 'insensitive' } },
                        { lastName: { contains: w, mode: 'insensitive' } },
                    ],
                }));
            } else {
                where.OR = [
                    { firstName: { contains: q, mode: 'insensitive' } },
                    { lastName: { contains: q, mode: 'insensitive' } },
                    { email: { contains: q, mode: 'insensitive' } },
                    { phone: { contains: q, mode: 'insensitive' } },
                    { denominacionsocial: { contains: q, mode: 'insensitive' } },
                ];
            }
        }

        // Obtener el total de registros para la paginación
        const total = await prisma.user.count({where});

        // Obtener los usuarios con paginación
        const users = await prisma.user.findMany({
            where, select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                phone: true,
                isActive: true,
                isbigclient: true,
                autoMonthlyInvoice: true,
                createdAt: true,
                denominacionsocial: true,
                nif: true,
                tipopersona: true,
                direccion: true,
                localidad: true,
                provincia: true,
                codigopostal: true,
                pais: true,
                discount: true,
                notifyChannel: true,
            }, orderBy: {createdAt: 'desc'}, skip, take: pageSize,
        });

        // Calcular metadatos de paginación
        const totalPages = Math.ceil(total / pageSize);

        // Construir respuesta con metadatos
        return {
            data: users, meta: {
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
        const {id} = req.params;
        const user = await prisma.user.findUnique({
            where: {id: Number(id)}, select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                phone: true,
                isActive: true,
                isbigclient: true,
                autoMonthlyInvoice: true,
                notifyChannel: true,
                denominacionsocial: true,
                nif: true,
                tipopersona: true,
                direccion: true,
                localidad: true,
                provincia: true,
                codigopostal: true,
                pais: true,
                discount: true,
            },
        });
        if (!user) return reply.status(404).send({error: 'Usuario no encontrado'});

        // Incluir pedidos del usuario (como cliente)
        const orders = await prisma.order.findMany({
            where: {clientId: Number(id)},
            select: {
                id: true,
                orderNum: true,
                status: true,
                total: true,
                paid: true,
                paymentMethod: true,
                createdAt: true,
                fechaLimite: true,
                updatedAt: true,
                lines: {
                    select: {
                        id: true,
                        quantity: true,
                        unitPrice: true,
                        totalPrice: true,
                        discount: true,
                        product: {select: {id: true, name: true}},
                    }
                }
            },
            orderBy: {createdAt: 'desc'}
        });

        // Facturas del cliente
        const invoices = await prisma.invoices.findMany({
            where: {clientId: Number(id)},
            select: {
                id: true,
                number: true,
                issuedAt: true,
                totalGross: true,
                paid: true,
                type: true,
                paymentStatus: true,
            },
            orderBy: {issuedAt: 'desc'},
            take: 50,
        });

        // Notificaciones enviadas al teléfono del usuario
        let notifications = [];
        if (user.phone) {
            notifications = await prisma.notification.findMany({
                where: {recipient: user.phone},
                select: {
                    id: true,
                    type: true,
                    content: true,
                    status: true,
                    sentAt: true,
                    orderid: true,
                    statusMessage: true,
                },
                orderBy: {sentAt: 'desc'},
                take: 50,
            });
        }

        return { ...user, orders, invoices, notifications };
    });

    // Helper: comprueba si el cliente tiene los datos mínimos para facturación
    const isEmpty = (v) => !v || (typeof v === 'string' && v.trim() === '');
    const canInvoice = (d) =>
        !isEmpty(d.email || d.emailVal) &&
        (!isEmpty(d.denominacionsocial) || !isEmpty(d.firstName) || !isEmpty(d.lastName)) &&
        !isEmpty(d.direccion) &&
        !isEmpty(d.codigopostal) &&
        !isEmpty(d.localidad);

    // Crear usuario
    fastify.post('/', async (req, reply) => {
        const {
            firstName,
            lastName,
            email,
            password,
            role,
            phone,
            isActive,
            isbigclient,
            autoMonthlyInvoice,
            denominacionsocial,
            nif,
            tipopersona,
            direccion,
            localidad,
            provincia,
            codigopostal,
            pais,
            discount,
        } = req.body;

        if (!firstName || !lastName) {
            return reply.status(400).send({error: 'firstName y lastName son obligatorios'});
        }

        // Normalizar teléfono
        const effectiveRole = role || 'customer';
        const normalizedPhone = phone ? normalizePhone(phone) : '';

        // Teléfono obligatorio para clientes
        if (effectiveRole === 'customer' && !normalizedPhone) {
            return reply.status(400).send({error: 'El teléfono es obligatorio para clientes'});
        }
        if (normalizedPhone && !isValidSpanishPhone(normalizedPhone)) {
            return reply.status(400).send({error: 'Teléfono inválido. Formato español, p.ej. 600123456 ó +34600123456'});
        }

        if (email) {
            const exists = await prisma.user.findUnique({where: {email}});
            if (exists) return reply.status(400).send({error: 'Email ya registrado'});
        }

        // Validar datos fiscales si se activa auto-facturación
        if (autoMonthlyInvoice && !canInvoice({ email, firstName, lastName, denominacionsocial, direccion, codigopostal, localidad })) {
            return reply.status(400).send({error: 'Para activar la facturación automática se requiere: email, dirección, C.P. y localidad'});
        }

        // Validación de discount 0-100 si llega
        let discountValue = 0;
        if (discount !== undefined) {
            const d = parseFloat(discount);
            if (isNaN(d) || d < 0 || d > 100) {
                return reply.status(400).send({error: 'discount debe ser un número entre 0 y 100'});
            }
            discountValue = d;
        }

        // Comprobar si ya existe un usuario con ese teléfono
        if (normalizedPhone) {
            const existing = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
            if (existing) {
                return reply.status(400).send({ error: `Ya existe un usuario con el teléfono ${normalizedPhone}` });
            }
        }

        const hashed = password ? await hash(password, 10) : null;
        const user = await prisma.user.create({
            data: {
                firstName,
                lastName,
                email: email?.trim() !== '' ? email : null,
                password: hashed,
                role: effectiveRole,
                phone: normalizedPhone || null,
                isActive: isActive !== undefined ? isActive : true,
                isbigclient: isbigclient || false,
                autoMonthlyInvoice: autoMonthlyInvoice || false,
                denominacionsocial: denominacionsocial || null,
                nif: nif || null,
                tipopersona: tipopersona || null,
                direccion: direccion || null,
                localidad: localidad || null,
                provincia: provincia || null,
                codigopostal: codigopostal || null,
                pais: pais || null,
                discount: discountValue,
            }, select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                phone: true,
                isActive: true,
                isbigclient: true,
                autoMonthlyInvoice: true,
                denominacionsocial: true,
                nif: true,
                tipopersona: true,
                direccion: true,
                localidad: true,
                provincia: true,
                codigopostal: true,
                pais: true,
                discount: true,
            },
        });

        if (email && password) {
            await sendWelcomeEmail(email, firstName, lastName, password);
        }

        return reply.status(201).send(user);
    });

    // Editar usuario
    fastify.put('/:id', async (req, reply) => {
        const {id} = req.params;
        const {
            firstName,
            lastName,
            email,
            password,
            role,
            phone,
            isActive,
            isbigclient,
            autoMonthlyInvoice,
            denominacionsocial,
            nif,
            tipopersona,
            direccion,
            localidad,
            provincia,
            codigopostal,
            pais,
            discount,
            notifyChannel,
        } = req.body;

        // Normalizar teléfono
        const normalizedPhone = phone ? normalizePhone(phone) : '';
        const effectiveRole = role || 'customer';

        // Teléfono obligatorio para clientes
        if (effectiveRole === 'customer' && !normalizedPhone) {
            return reply.status(400).send({error: 'El teléfono es obligatorio para clientes'});
        }
        if (normalizedPhone && !isValidSpanishPhone(normalizedPhone)) {
            return reply.status(400).send({error: 'Teléfono inválido. Formato español, p.ej. 600123456 ó +34600123456'});
        }

        // Validar datos fiscales si se activa auto-facturación
        if (autoMonthlyInvoice && !canInvoice({ email, firstName, lastName, denominacionsocial, direccion, codigopostal, localidad })) {
            return reply.status(400).send({error: 'Para activar la facturación automática se requiere: email, dirección, C.P. y localidad'});
        }

        // Comprobar duplicado de teléfono (excluyendo el usuario actual)
        if (normalizedPhone) {
            const existing = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
            if (existing && existing.id !== Number(id)) {
                return reply.status(400).send({ error: `Ya existe un usuario con el teléfono ${normalizedPhone}` });
            }
        }

        const data = {
            firstName,
            lastName,
            email: email?.trim() !== '' ? email : null,
            role: effectiveRole,
            phone: normalizedPhone || null,
            isActive,
            isbigclient,
            autoMonthlyInvoice: autoMonthlyInvoice || false,
            denominacionsocial,
            nif,
            tipopersona,
            direccion,
            localidad,
            provincia,
            codigopostal,
            pais,
        };
        // Validación y asignación de discount (0-100) si viene
        if (discount !== undefined) {
            const d = parseFloat(discount);
            if (isNaN(d) || d < 0 || d > 100) {
                return reply.status(400).send({error: 'discount debe ser un número entre 0 y 100'});
            }
            data.discount = d;
        }
        // Asignación de notifyChannel si viene
        if (notifyChannel !== undefined) {
            data.notifyChannel = ['sms', 'whatsapp', 'none'].includes(notifyChannel) ? notifyChannel : null;
        }
        if (password) {
            data.password = await hash(password, 10);
        }
        try {

            console.log(data);

            const user = await prisma.user.update({
                where: {id: Number(id)}, data, select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                    phone: true,
                    isActive: true,
                    isbigclient: true,
                    autoMonthlyInvoice: true,
                    denominacionsocial: true,
                    nif: true,
                    tipopersona: true,
                    direccion: true,
                    localidad: true,
                    provincia: true,
                    codigopostal: true,
                    pais: true,
                    discount: true,
                    notifyChannel: true,
                },
            });
            return user;
        } catch (e) {
            console.log(e);
            return reply.status(404).send({error: 'Usuario no encontrado'});
        }
    });

    // Activar/desactivar
    fastify.patch('/:id/activate', async (req, reply) => {
        const {id} = req.params;
        const {isActive} = req.body;
        if (typeof isActive !== 'boolean') return reply.status(400).send({error: 'isActive booleano requerido'});
        try {
            const user = await prisma.user.update({
                where: {id: Number(id)}, data: {isActive}, select: {
                    id: true, firstName: true, lastName: true, email: true, isActive: true,
                },
            });
            return user;
        } catch {
            return reply.status(404).send({error: 'Usuario no encontrado'});
        }
    });
}
