/**
 * Normaliza un teléfono al formato de 9 dígitos español (sin prefijo).
 * Acepta: 612345678, +34612345678, 34612345678, 0034612345678,
 *         +34 612 345 678, (34) 612-345-678, etc.
 * Devuelve los 9 dígitos o el valor limpio si no encaja en ningún patrón.
 */
export function normalizePhone(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/[\s\-().+]/g, '');  // quitar espacios, guiones, paréntesis, puntos, +
    const digits = cleaned.replace(/\D/g, '');          // solo dígitos

    // 0034XXXXXXXXX (13 dígitos)
    if (digits.startsWith('0034') && digits.length === 13) {
        return digits.slice(4);
    }
    // 34XXXXXXXXX (11 dígitos)
    if (digits.startsWith('34') && digits.length === 11) {
        return digits.slice(2);
    }
    // Ya son 9 dígitos
    if (digits.length === 9) {
        return digits;
    }
    // Devolver los dígitos tal cual si no encaja
    return digits;
}

/**
 * Comprueba si un teléfono (ya normalizado) es un número español válido.
 * 9 dígitos, empieza por 6, 7, 8 o 9.
 */
export function isValidSpanishPhone(phone) {
    return /^[6789]\d{8}$/.test(phone);
}
