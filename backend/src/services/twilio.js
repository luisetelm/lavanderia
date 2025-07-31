import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

export async function sendSMS(to, body) {
    return client.messages.create({
        body,
        from: process.env.TWILIO_PHONE,
        to,
    });
}

export async function sendWhatsApp(to, body) {
    return client.messages.create({
        body,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
        to: `whatsapp:${to}`,
    });
}
