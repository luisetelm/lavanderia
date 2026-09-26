// Teléfonos de cliente. Réplica de backend/src/utils/validatePhone.js para
// avisar antes de enviar; la regla que vale es la del backend.
//
// Cómo se guardan: español, 9 dígitos sin prefijo (612345678); extranjero, en
// E.164 con el más y el código de país (+33612345678). Un número tecleado a
// mano sólo se admite como extranjero si empieza por + (o por 00).

const PAIS_ESPANA = '34';

export const TELEFONO_AYUDA = 'Móvil o fijo español de 9 cifras (612345678). Para un número extranjero, empieza por + y el código del país (+33 6 12 34 56 78).';

const soloDigitos = (s) => String(s || '').replace(/\D/g, '');

/** Quita espacios, guiones y prefijo 34; deja +código en los extranjeros. */
export function normalizarTelefono(valor) {
    if (!valor) return '';
    const raw = String(valor).trim();
    let digits = soloDigitos(raw);
    if (!digits) return '';

    const internacional = raw.startsWith('+') || digits.startsWith('00');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (internacional) {
        if (digits.startsWith(PAIS_ESPANA)) return digits.slice(2);
        return `+${digits}`;
    }

    if (digits.length === 11 && digits.startsWith(PAIS_ESPANA)) return digits.slice(2);
    return digits;
}

/** Número de WhatsApp (dígitos con código de país delante) -> formato guardado. */
export function desdeNumeroWhatsApp(from) {
    const digits = soloDigitos(from);
    return digits ? normalizarTelefono(`+${digits}`) : '';
}

export const esTelefonoEspanol = (t) => /^[6789]\d{8}$/.test(t);
export const esTelefonoExtranjero = (t) => /^\+[1-9]\d{7,14}$/.test(t) && !t.startsWith(`+${PAIS_ESPANA}`);

/** Teléfono válido de cliente (ya normalizado o no: se normaliza aquí). */
export function esTelefonoValido(valor) {
    const t = normalizarTelefono(valor);
    return esTelefonoEspanol(t) || esTelefonoExtranjero(t);
}
