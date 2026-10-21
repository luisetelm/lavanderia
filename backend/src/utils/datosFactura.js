// Datos del cliente que hacen falta para emitir una factura normal.
//
// Se comprueban al emitir (crearFactura y la conversión de simplificada a
// normal), no al dar de alta: en el mostrador se crea al cliente con nombre y
// teléfono y los datos fiscales se piden cuando quiere factura. Por eso el
// error lleva `code`, `clientId` y `missing` (claves de campo): el frontend
// abre un formulario con lo que falta, lo guarda y reintenta la factura.

export const CODIGO_DATOS_FACTURA = 'DATOS_FACTURA';

const ETIQUETAS = {
    nombre: 'nombre o denominación social',
    email: 'email',
    direccion: 'dirección',
    codigopostal: 'código postal',
    localidad: 'localidad',
};

export const esVacio = (v) => v === null || v === undefined
    || (typeof v === 'string' && (v.trim() === '' || ['null', 'undefined'].includes(v.trim().toLowerCase())));

// Devuelve las claves de los campos que faltan (vacío = se puede facturar).
export function faltanDatosFactura(client) {
    const faltan = [];
    if (esVacio(client.denominacionsocial) && esVacio(client.firstName) && esVacio(client.lastName)) {
        faltan.push('nombre');
    }
    if (esVacio(client.email)) faltan.push('email');
    if (esVacio(client.direccion)) faltan.push('direccion');
    if (esVacio(client.codigopostal)) faltan.push('codigopostal');
    if (esVacio(client.localidad)) faltan.push('localidad');
    return faltan;
}

export function errorDatosFactura(clientId, faltan) {
    const err = new Error(`Faltan datos del cliente para la factura: ${faltan.map((k) => ETIQUETAS[k] || k).join(', ')}.`);
    err.statusCode = 400;
    err.code = CODIGO_DATOS_FACTURA;
    err.clientId = clientId;
    err.missing = faltan;
    return err;
}

// Lanza el error si al cliente le falta algo.
export function exigirDatosFactura(clientId, client) {
    const faltan = faltanDatosFactura(client);
    if (faltan.length) throw errorDatosFactura(clientId, faltan);
}

// Cuerpo de la respuesta HTTP para un error de la emisión: añade el detalle
// cuando es por datos del cliente.
export function cuerpoError(e, porDefecto) {
    const body = {error: e.message || porDefecto};
    if (e.code === CODIGO_DATOS_FACTURA) {
        body.code = e.code;
        body.clientId = e.clientId;
        body.missing = e.missing;
    }
    return body;
}
