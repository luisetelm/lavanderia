// backend/src/routes/notifications.js

import {PrismaClient} from '@prisma/client';
import {sendSMScustomer} from '../services/twilio.js';

const prisma = new PrismaClient();

export default async function (fastify, opts) {
    fastify.post('/:id/retry', async (request, reply) => {
        const {id, phone} = request.body;
        try {
            const notification = await prisma.notification.findUnique({
                where: {id: Number(id)}
            });

            if (!phone) {
                return reply.code(400).send({error: 'Número de teléfono no proporcionado'});
            }

            if (!notification) {
                return reply.code(404).send({error: 'Notificación no encontrada'});
            }

            const smsResponse = await sendSMScustomer(phone, notification.content);

            await prisma.notification.update({
                where: {id: Number(id)}, data: {
                    sentAt: new Date(),
                    recipient: phone,
                    status: parseInt(smsResponse.code) === 0 ? 'sent' : 'failed',
                    statusCode: parseInt(smsResponse.code),
                    subid: smsResponse.subid,
                    statusMessage: smsResponse.message
                }
            });

            reply.send({success: true, smsResponse});
        } catch (error) {
            reply.code(500).send({error: error.message});
        }
    });
}