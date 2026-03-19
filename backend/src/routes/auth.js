import { hash, compare } from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { emailTemplate, emailButton } from '../utils/emailTemplate.js';

const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    requireTLS: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

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
        return reply.send({ token, user: { id: user.id, name: user.firstName, role: user.role } });
    });

    // Solicitar restablecimiento de contraseña
    fastify.post('/forgot-password', async (req, reply) => {
        const { email } = req.body;

        if (!email) {
            return reply.status(400).send({ error: 'Email obligatorio' });
        }

        // Mensaje genérico (no revelar si el email existe)
        const genericMsg = 'Si existe una cuenta con ese email, recibirás un correo con instrucciones para restablecer tu contraseña.';

        try {
            const user = await prisma.user.findUnique({ where: { email } });

            if (!user) {
                console.log(`[Auth] forgot-password: email "${email}" no encontrado`);
                return reply.send({ ok: true, message: genericMsg });
            }

            // Incluir el hash actual en el token para invalidarlo si ya se cambió la contraseña
            const resetToken = jwt.sign(
                { userId: user.id, purpose: 'password-reset', hash: user.password.slice(-10) },
                process.env.JWT_SECRET,
                { expiresIn: '30m' }
            );

            const baseUrl = process.env.APP_URL || 'https://app.tinteyburbuja.com';
            const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

            await emailTransporter.sendMail({
                from: { name: process.env.FROM_NAME, address: process.env.FROM_EMAIL },
                to: email,
                subject: 'Restablecer contraseña - Tinte y Burbuja',
                html: emailTemplate({
                    title: 'Restablecer contraseña',
                    body: `
                        <p>Hola <strong>${user.firstName}</strong>,</p>
                        <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta.</p>
                        <p>Haz clic en el siguiente botón para crear una nueva contraseña:</p>
                        ${emailButton({ text: 'Restablecer contraseña', url: resetLink })}
                        <p style="font-size: 13px; color: #94a3b8;">
                            Este enlace expirará en <strong>30 minutos</strong>.<br>
                            Si no solicitaste este cambio, puedes ignorar este correo.
                        </p>
                    `,
                }),
            });

            console.log(`[Auth] Email de restablecimiento enviado a ${email}`);
        } catch (err) {
            console.error('[Auth] Error en forgot-password:', err);
        }

        return reply.send({ ok: true, message: genericMsg });
    });

    // Restablecer contraseña con token
    fastify.post('/reset-password', async (req, reply) => {
        const { token, password } = req.body;

        if (!token || !password) {
            return reply.status(400).send({ error: 'Token y contraseña son obligatorios' });
        }

        if (password.length < 6) {
            return reply.status(400).send({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET);

            if (payload.purpose !== 'password-reset') {
                return reply.status(400).send({ error: 'Token inválido' });
            }

            const user = await prisma.user.findUnique({ where: { id: payload.userId } });

            if (!user) {
                return reply.status(400).send({ error: 'Usuario no encontrado' });
            }

            // Verificar que la contraseña no haya sido cambiada desde que se generó el token
            if (payload.hash && user.password.slice(-10) !== payload.hash) {
                return reply.status(400).send({ error: 'Este enlace ya fue utilizado. Solicita uno nuevo.' });
            }

            const hashed = await hash(password, 10);
            await prisma.user.update({
                where: { id: user.id },
                data: { password: hashed },
            });

            console.log(`[Auth] Contraseña restablecida para usuario id=${user.id} (${user.email})`);
            return reply.send({ ok: true, message: 'Contraseña actualizada correctamente' });
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return reply.status(400).send({ error: 'El enlace ha expirado. Solicita uno nuevo.' });
            }
            if (err.name === 'JsonWebTokenError') {
                return reply.status(400).send({ error: 'Enlace inválido' });
            }
            console.error('[Auth] Error en reset-password:', err);
            return reply.status(500).send({ error: 'Error al restablecer la contraseña' });
        }
    });
}
