import twilio from 'twilio';
import dotenv from 'dotenv';
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

export async function sendSMS(to, body, senderName = 'LAVANDERIA') {
    const formattedNumber = formatToE164(to);
    console.log('Enviando SMS a:', formattedNumber);
    const messageConfig = {
        body,
        to: formattedNumber,
        // Usar el nombre personalizado si está disponible, si no, usar el número de Twilio
        from: senderName || process.env.TWILIO_PHONE,
        // Opcionalmente, puedes incluir el nombre en el cuerpo del mensaje
        // body: `${senderName}: ${body}`
    };

    try {
        return await client.messages.create(messageConfig);
    } catch (error) {
        // Si falla con el nombre personalizado, intentar con el número por defecto
        if (senderName && error.code === 21612) { // Código de error de Sender ID no permitido
            console.warn('Sender ID no permitido, usando número por defecto');
            return await client.messages.create({
                ...messageConfig,
                from: process.env.TWILIO_PHONE
            });
        }
        throw error;
    }
}

export async function sendWhatsApp(to, body) {
    const formattedNumber = formatToE164(to);
    return client.messages.create({
        body,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
        to: `whatsapp:${formattedNumber}`,
    });
}
