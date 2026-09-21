// Interruptor de los envíos de correo.
//
// Existe porque `crearFactura()` manda la factura por email —al cliente y con
// copia a hola@tinteyburbuja.com— como parte de emitirla. Cualquier prueba que
// la llame, aunque corra contra una base de usar y tirar, acaba mandando correo
// de verdad a direcciones de verdad. Ya pasó una vez.
//
// Se desactiva con NODE_ENV=test o con EMAIL_DISABLED=1 en el entorno. En
// producción no hay que tocar nada: sin esas variables, se envía como siempre.
export function envioDesactivado(contexto = '') {
    const apagado = process.env.NODE_ENV === 'test'
        || ['1', 'true', 'yes'].includes(String(process.env.EMAIL_DISABLED || '').toLowerCase());

    if (apagado) {
        console.log(`[email] Envío desactivado por el entorno${contexto ? `: ${contexto}` : ''}`);
    }
    return apagado;
}
