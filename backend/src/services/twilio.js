import dotenv from 'dotenv';
import LabsMobileClient from 'labsmobile-sms/src/LabsMobileClient.js';
import LabsMobileModelTextMessage from 'labsmobile-sms/src/LabsMobileModelTextMessage.js';
import ParametersException from 'labsmobile-sms/src/Exception/ParametersException.js';
import RestException from 'labsmobile-sms/src/Exception/RestException.js';

dotenv.config();



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
    const formattedPhone = formatToE164(to);
    console.log('[SMS] Enviando SMS a:', formattedPhone, '(original:', to, ')');

    const username = process.env.LABSMOBILE_USER || "hola@tinteyburbuja.es";
    const token = process.env.LABSMOBILE_TOKEN || "zk1Y8mArOKQUtJp0lXIkGbLzvYsOJIL0";

    try {
        const clientLabsMobile = new LabsMobileClient(username, token);
        const phone = [formattedPhone];
        const bodySms = new LabsMobileModelTextMessage(phone, body);
        bodySms.long = 1;
        bodySms.tpoa = senderName;

        const result = await clientLabsMobile.sendSms(bodySms);

        // El SDK de LabsMobile NO lanza error en algunos fallos, solo retorna undefined
        if (!result) {
            console.error('[SMS] LabsMobile devolvió resultado vacío — revisar LabsMobile.log para más detalles');
            throw new Error('LabsMobile devolvió un resultado vacío. Posible error de autenticación o parámetros.');
        }

        console.log('[SMS] Resultado LabsMobile:', JSON.stringify(result));
        return result;
    } catch (error) {
        if (error instanceof ParametersException) {
            console.error('[SMS] Error de parámetros LabsMobile:', error.message);
        } else if (error instanceof RestException) {
            console.error(`[SMS] Error REST LabsMobile: ${error.status} - ${error.message}`);
        } else {
            console.error('[SMS] Error inesperado enviando SMS:', error.message || error);
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
