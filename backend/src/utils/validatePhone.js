export function isValidSpanishPhone(phone) {
    // 9 dígitos, empieza por 6,7,8 o 9
    return /^[6789]\d{8}$/.test(phone);
}
