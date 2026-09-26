/**
 * Teléfonos de cliente.
 *
 * Cómo se guardan:
 *  - Español: los 9 dígitos sin prefijo (612345678). Es lo que hay en toda la
 *    base de datos y lo que esperan WhatsApp, SMS, el portal y las búsquedas.
 *  - Extranjero: en E.164, con el signo más y el código de país (+33612345678).
 *    El más es lo que distingue un número internacional de un español mal
 *    tecleado, así que un número tecleado a mano sólo se admite como
 *    extranjero si empieza por + (o por 00).
 *
 * Antes sólo se admitían números españoles y un turista no podía dejar ropa.
 */

const PAIS_ESPANA = '34';

export const TELEFONO_AYUDA = 'Móvil o fijo español de 9 cifras (612345678). Para un número extranjero, empieza por + y el código del país (+33 6 12 34 56 78).';

function soloDigitos(s) {
    return String(s || '').replace(/\D/g, '');
}

/**
 * Normaliza un teléfono tal y como se guarda.
 * Acepta: 612345678, +34612345678, 34612345678, 0034612345678,
 *         +34 612 345 678, (34) 612-345-678, +33 6 12 34 56 78, 0033612345678...
 * Devuelve los 9 dígitos si es español, +código+número si es extranjero, o los
 * dígitos tal cual si no encaja en nada (la validación lo rechazará).
 */
export function normalizePhone(phone) {
    if (!phone) return '';
    const raw = String(phone).trim();
    let digits = soloDigitos(raw);
    if (!digits) return '';

    // Prefijo internacional explícito: '+' o '00'
    const internacional = raw.startsWith('+') || digits.startsWith('00');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (internacional) {
        if (digits.startsWith(PAIS_ESPANA)) return digits.slice(2);
        return `+${digits}`;
    }

    // Sin prefijo: 34 + 9 dígitos también es España (34612345678)
    if (digits.length === 11 && digits.startsWith(PAIS_ESPANA)) return digits.slice(2);
    if (digits.length === 9) return digits;
    return digits;
}

/**
 * Número tal y como lo da WhatsApp (dígitos con el código de país delante,
 * sin más: 34612345678, 33612345678) -> formato guardado.
 */
export function fromWhatsAppNumber(from) {
    const digits = soloDigitos(from);
    return digits ? normalizePhone(`+${digits}`) : '';
}

/** Número español ya normalizado: 9 dígitos que empiezan por 6, 7, 8 o 9. */
export function isValidSpanishPhone(phone) {
    return /^[6789]\d{8}$/.test(phone);
}

/** Número extranjero ya normalizado: + y de 8 a 15 dígitos (E.164), sin ser +34. */
export function isInternationalPhone(phone) {
    return /^\+[1-9]\d{7,14}$/.test(phone) && !phone.startsWith(`+${PAIS_ESPANA}`);
}

/** Teléfono válido de cliente, ya normalizado: español o extranjero. */
export function isValidPhone(phone) {
    return isValidSpanishPhone(phone) || isInternationalPhone(phone);
}
