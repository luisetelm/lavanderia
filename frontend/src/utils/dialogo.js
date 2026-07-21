// Diálogos y avisos unificados.
//
// Sustituye a los alert()/confirm() nativos, que bloquean el navegador, no se
// pueden estilar y presentan "Aceptar" y "Cancelar" con el mismo peso visual
// —justo lo que hace que se confirmen acciones sin querer.
//
// Uso:
//   if (await confirmar('¿Descartar el pedido en curso?')) { ... }
//   avisar('Factura generada', 'success');
//
// El diálogo lo pinta <DialogHost/>, montado una sola vez en App. Aquí sólo se
// guarda la referencia a su función de apertura, para poder invocarlo desde
// cualquier módulo sin pasar props por media aplicación.

import UIkit from 'uikit';

let abrirDialogo = null;

export function registrarDialogo(fn) {
    abrirDialogo = fn;
}

// Pregunta al usuario y devuelve true/false. Nunca lanza: si por lo que sea el
// host no está montado, cae al confirm() nativo antes que perder la acción.
export function confirmar(mensaje, opciones = {}) {
    if (!abrirDialogo) {
        return Promise.resolve(window.confirm(mensaje));
    }
    return abrirDialogo({
        mensaje,
        titulo: opciones.titulo || '',
        textoConfirmar: opciones.textoConfirmar || 'Confirmar',
        textoCancelar: opciones.textoCancelar || 'Cancelar',
        // 'peligroso' pinta la acción en rojo: borrados, cancelaciones, etc.
        peligroso: Boolean(opciones.peligroso),
    });
}

// Aviso flotante: informa sin interrumpir. tipo: 'success' | 'danger' | 'warning' | 'primary'
export function avisar(mensaje, tipo = 'primary', timeout = 3500) {
    UIkit.notification({message: mensaje, status: tipo, pos: 'top-right', timeout});
}
