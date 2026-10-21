// Facturar sin tener que ir antes a la ficha del cliente.
//
// Al emitir una factura normal el backend exige nombre, email y dirección
// completa (backend/src/utils/datosFactura.js). Si faltan, responde con
// `code: 'DATOS_FACTURA'`, el `clientId` y las claves que faltan (`missing`).
// conDatosFactura() captura ese error, abre <DatosFacturaHost/> para completar
// los datos en el momento y, al guardar, repite la emisión.
//
// Uso:
//   const res = await conDatosFactura(token, () => createInvoice(token, {...}));
//
// Si se cierra el formulario sin guardar, lanza un error con `cancelado: true`
// y un mensaje que el que llama puede mostrar como cualquier otro fallo.

export const CODIGO_DATOS_FACTURA = 'DATOS_FACTURA';

let abrirFormulario = null;

export function registrarDatosFactura(fn) {
    abrirFormulario = fn;
}

export async function conDatosFactura(token, accion) {
    for (;;) {
        try {
            return await accion();
        } catch (e) {
            if (e?.code !== CODIGO_DATOS_FACTURA || !e.clientId || !abrirFormulario) throw e;
            const guardado = await abrirFormulario({token, clientId: e.clientId, missing: e.missing || []});
            if (!guardado) {
                throw {...e, cancelado: true, error: 'Factura no emitida: faltan datos del cliente.'};
            }
            // Datos guardados: se vuelve a intentar la factura.
        }
    }
}
