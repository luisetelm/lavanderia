// Comprueba y monta las plantillas de WhatsApp que se crean o editan desde la app
// (página Plantillas de WhatsApp). Meta rechaza muchas cosas con mensajes en inglés;
// aquí se adelantan las más habituales con un motivo en castellano.

const NOMBRE_VALIDO = /^[a-z0-9_]{1,512}$/;
const VARIABLE = /\{\{\s*(\d+)\s*\}\}/g;

// Valores de ejemplo que Meta exige cuando el texto lleva variables.
// {{1}} es siempre el nombre del cliente (campañas y avisos de pedido).
const EJEMPLOS = ['Ana', 'P-1234', 'ejemplo', 'ejemplo', 'ejemplo'];

export const CATEGORIAS = ['MARKETING', 'UTILITY'];

// Plantillas que la app manda sola por su nombre: no se pueden borrar desde la página
// (se puede editar su texto, manteniendo sus variables).
export const PLANTILLAS_EN_USO = {
    pedido_listo: 'Aviso de pedido listo ({{1}} nombre, {{2}} número de pedido)',
    pedido_recogido: 'Aviso tras recoger el pedido, con la reseña de Google ({{1}} nombre)',
    precio_web: 'Respuesta automática a las peticiones de precio de la web',
};

/** Números de las variables {{n}} del texto, sin repetir y en orden. */
export function variablesDe(texto) {
    const nums = [...String(texto || '').matchAll(VARIABLE)].map(m => Number(m[1]));
    return [...new Set(nums)].sort((a, b) => a - b);
}

/** Devuelve el motivo por el que el texto no vale, o null si vale. */
export function errorDelTexto(texto) {
    const t = String(texto || '').trim();
    if (!t) return 'El texto no puede estar vacío.';
    if (t.length > 1024) return `El texto tiene ${t.length} caracteres; el máximo de WhatsApp es 1024.`;

    const vars = variablesDe(t);
    if (vars.some((n, i) => n !== i + 1)) {
        return 'Las variables tienen que ir seguidas empezando por {{1}}: {{1}}, {{2}}…';
    }
    if (/^\{\{\s*\d+\s*\}\}/.test(t) || /\{\{\s*\d+\s*\}\}[.!?…\s]*$/.test(t)) {
        return 'El texto no puede empezar ni terminar con una variable: Meta lo rechaza.';
    }
    if (/\n\s*\n\s*\n/.test(t)) return 'No dejes más de una línea en blanco seguida.';
    return null;
}

/** Componente BODY listo para Meta, con los ejemplos si hay variables. */
export function cuerpo(texto) {
    const t = String(texto).trim();
    const vars = variablesDe(t);
    const body = { type: 'BODY', text: t };
    if (vars.length) body.example = { body_text: [vars.map(n => EJEMPLOS[n - 1] || 'ejemplo')] };
    return body;
}

/** Valida una plantilla nueva y devuelve { error } o { componentes }. */
export function prepararNueva({ name, category, text }) {
    if (!NOMBRE_VALIDO.test(name || '')) {
        return { error: 'El nombre sólo puede llevar minúsculas sin acentos, números y guiones bajos (ej. horario_navidad).' };
    }
    if (!CATEGORIAS.includes(category)) return { error: 'La categoría tiene que ser Marketing o Utilidad.' };
    const err = errorDelTexto(text);
    if (err) return { error: err };
    return { componentes: [cuerpo(text)] };
}

/**
 * Sustituye el texto de una plantilla existente conservando el resto de sus partes.
 * Las que llevan imagen, vídeo o documento en la cabecera no se pueden editar desde
 * la app: Meta pide subir el archivo otra vez.
 */
export function prepararEdicion(plantilla, text) {
    const comps = plantilla?.components || [];
    const cabecera = comps.find(c => c.type === 'HEADER');
    if (cabecera && cabecera.format && cabecera.format !== 'TEXT') {
        return { error: 'Esta plantilla lleva una imagen o un archivo en la cabecera y no se puede editar desde la app.' };
    }
    const err = errorDelTexto(text);
    if (err) return { error: err };
    return { componentes: comps.map(c => (c.type === 'BODY' ? cuerpo(text) : c)) };
}
