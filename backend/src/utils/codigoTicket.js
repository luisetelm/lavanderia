// Código corto del QR del ticket de cliente (sql/034).
//
// El QR del ticket llevaba el enlace al portal con un JWT dentro (~250
// caracteres): un QR denso que el lector del mostrador, que funciona como un
// teclado, tardaba en "escribir". Ahora lleva HTTPS://APP.TINTEYBURBUJA.COM/T/<código>:
// todo en mayúsculas para que el QR use su modo alfanumérico (el más compacto).
//
// El código identifica el PEDIDO del ticket. Es aleatorio y no el número de
// pedido porque también abre el portal del cliente: con números correlativos
// cualquiera podría probar y ver pedidos ajenos. 8 caracteres de un alfabeto de
// 32 (sin 0/O ni 1/I, que se confunden al teclearlos) son unos 10^12 códigos.

import { randomInt } from 'crypto';

const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LONGITUD = 8;
export const DIAS_VALIDEZ_PORTAL = 30; // como el enlace con JWT que sustituye

const generar = () => Array.from({ length: LONGITUD }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');

/** Código tal y como lo puede escribir o leer alguien: sin espacios ni guiones, en mayúsculas. */
export const normalizarCodigo = (codigo) => String(codigo || '').toUpperCase().replace(/[\s-]/g, '');

/** ¿Tiene forma de código de ticket? (para no consultar la BD con cualquier cosa) */
export const esCodigoTicket = (codigo) => new RegExp(`^[${ALFABETO}]{${LONGITUD}}$`).test(codigo);

/**
 * Código del ticket de un pedido. Cada pedido tiene uno y se reutiliza al
 * reimprimir el ticket; cada impresión renueva los días de acceso al portal.
 */
export async function codigoDelPedido(prisma, orderId) {
    const expiresAt = new Date(Date.now() + DIAS_VALIDEZ_PORTAL * 24 * 60 * 60 * 1000);
    const existente = await prisma.ticketCode.findUnique({ where: { orderId } });
    if (existente) {
        await prisma.ticketCode.update({ where: { orderId }, data: { expiresAt } });
        return existente.code;
    }
    for (let intento = 0; intento < 5; intento++) {
        try {
            const { code } = await prisma.ticketCode.create({ data: { code: generar(), orderId, expiresAt } });
            return code;
        } catch (e) {
            // P2002: código repetido (rarísimo) o el mismo pedido creado a la vez por otra petición
            if (e.code !== 'P2002') throw e;
            const yaCreado = await prisma.ticketCode.findUnique({ where: { orderId } });
            if (yaCreado) return yaCreado.code;
        }
    }
    throw new Error('No se pudo generar el código del ticket');
}
