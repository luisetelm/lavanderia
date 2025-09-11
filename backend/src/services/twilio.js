import twilio from 'twilio';
import dotenv from 'dotenv';
import LabsMobileClient from 'labsmobile-sms/src/LabsMobileClient.js';
import LabsMobileModelTextMessage from 'labsmobile-sms/src/LabsMobileModelTextMessage.js';
import ParametersException from 'labsmobile-sms/src/Exception/ParametersException.js';
import RestException from 'labsmobile-sms/src/Exception/RestException.js';

dotenv.config();


const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

const formatToE164 = (phoneNumber) => {
    const cleaned = phoneNumber.replace(/\D/g, '');

    if (cleaned.startsWith('34') && cleaned.length === 11) {
        return '+' + cleaned;
    }

    if (/^[6789]\d{8}$/.test(cleaned)) {
        return '+34' + cleaned;
    }

    return phoneNumber;
};

export async function sendSMScustomer(to, body, senderName = 'LAVANDERIA') {
    try {
        console.log('Enviando SMS a:', to);
        const phone = [formatToE164(to)];

        const username = "hola@tinteyburbuja.es";
        const token = "zk1Y8mArOKQUtJp0lXIkGbLzvYsOJIL0";
        const message = body;
        const clientLabsMobile = new LabsMobileClient(username, token);
        const bodySms = new LabsMobileModelTextMessage(phone, message);
        bodySms.long = 1;
        bodySms.tpoa = senderName;
        return await clientLabsMobile.sendSms(bodySms);
    } catch (error) {
        if (error instanceof ParametersException) {
            console.log(error.message);
        } else if (error instanceof RestException) {
            console.log(`Error: ${error.status} - ${error.message}`);
        }
        throw error;
    }
}

export async function sendSMSOLD(to, body, senderName = 'LAVANDERIA') {
    const formattedNumber = formatToE164(to);
    console.log('Enviando SMS a:', formattedNumber);
    const messageConfig = {
        body, to: formattedNumber, // Usar el nombre personalizado si está disponible, si no, usar el número de Twilio
        from: senderName || process.env.TWILIO_PHONE, // Opcionalmente, puedes incluir el nombre en el cuerpo del mensaje
        // body: `${senderName}: ${body}`
    };

    try {
        return await client.messages.create(messageConfig);
    } catch (error) {
        // Si falla con el nombre personalizado, intentar con el número por defecto
        if (senderName && error.code === 21612) { // Código de error de Sender ID no permitido
            console.warn('Sender ID no permitido, usando número por defecto');
            return await client.messages.create({
                ...messageConfig, from: process.env.TWILIO_PHONE
            });
        }
        throw error;
    }
}

export async function sendWhatsApp(to, body) {
    const formattedNumber = formatToE164(to);
    return client.messages.create({
        body, from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`, to: `whatsapp:${formattedNumber}`,
    });
}
