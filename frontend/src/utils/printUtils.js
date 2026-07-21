// Importar la biblioteca para generar códigos QR
import QRCode from 'qrcode';
// Conexión a QZ Tray CON certificado + firma (evita el diálogo "anonymous request")
import { connectQZ as connectQZSecure } from '../qzInit.js';
import { fetchOrderPortalLink, fetchOrder, encolarImpresion } from '../api.js';
import { getPrintSettings } from './printSettings.js';
import { lineasActivas } from './lineas.js';

// configuración mínima de QZ Tray
async function connectQZ() {
    // Delegamos en qzInit.js, que configura el certificado público y la firma
    // (setCertificatePromise / setSignaturePromise) ANTES de conectar. Así QZ
    // Tray reconoce el certificado de confianza y no muestra el diálogo de
    // seguridad ni trata la petición como anónima.
    try {
        await connectQZSecure();
    } catch (e) {
        console.error('Error conectando a QZ Tray:', e);
        throw e;
    }
}

function buildRawHtml(htmlContent) {
    // QZ puede imprimir HTML mediante “qz.print” con tipo 'html'
    return [{
        type: 'html', format: 'plain', data: htmlContent,
    },];
}


async function sendToPrinter(printerName, data, options = {}) {
    await connectQZ();
    try {
        const config = qz.configs.create(printerName, options); // puedes pasar opciones como tamaño/dpi
        await qz.print(config, data);
    } catch (err) {
        console.error('Error imprimiendo con QZ Tray:', err);
        throw err;
    }
}

// --- ESC/POS helpers ---
const ESC = '\x1B';
const LF = '\x0A';
const ESC_INIT = '\x1B\x40';
const CUT_ESC_I = '\x1B\x69';        // Corte (ESC i) -> muy fiable en TM-U220
const CUT_GS_V_FULL = '\x1D\x56\x00'; // Alternativa GS V 0 (corte total)

// Selección de página de códigos (ESC t n). CP858 (n=19/0x13) incluye los
// acentos españoles (á, é, í, ó, ú, ñ, ü) y el símbolo del euro (€). Debe ir
// acompañado del `encoding: 'CP858'` en la config de QZ para que la cadena JS se
// codifique a los mismos bytes que espera la impresora.
const ESC_CODEPAGE_CP858 = ESC + 't' + '\x13';
// Juego de caracteres internacional España (ESC R n, n=7). Refuerza algunos
// símbolos (¿ ¡ ñ) en impresoras Epson.
const ESC_INTL_SPAIN = ESC + 'R' + '\x07';

// Alineación (ESC a n). La TM-U220 soporta ESC a (0=izq, 1=centro, 2=der).
const ALIGN_LEFT = ESC + 'a' + '\x00';
const ALIGN_CENTER = ESC + 'a' + '\x01';
// Énfasis/negrita (ESC E n). Soportado por la TM-U220.
const BOLD_ON = ESC + 'E' + '\x01';
const BOLD_OFF = ESC + 'E' + '\x00';

// IMPORTANTE (TM-U220): la cortadora está ~6 líneas POR ENCIMA del cabezal.
// Por eso hay que avanzar (feed) varias líneas DESPUÉS del contenido para que la
// última línea impresa pase la cortadora antes de cortar; si no, el corte cae
// "hacia atrás" y parte del contenido se queda dentro de la impresora.
// NOTA: ya NO incluimos ESC @ (init) aquí, porque reseteaba la página de códigos
// entre etiquetas y rompía los acentos a partir de la 2ª.
function buildCut({feed = 0, variant = 'auto', partial = false, feedAfter = 0} = {}) {
    const feedBlock = LF.repeat(Math.max(0, feed));

    if (variant === 'gs') {
        if (partial) {
            // Corte parcial estándar (GS V 1)
            return feedBlock + '\x1D\x56\x01';
        }
        if (feedAfter > 0) {
            // GS V 66 n → corta y avanza n unidades
            return feedBlock + '\x1D\x56\x42' + String.fromCharCode(feedAfter);
        }
        // Corte total GS V 0
        return feedBlock + '\x1D\x56\x00';
    }

    // Variante 'auto' → ESC i (corte total clásico, muy fiable en TM-U220)
    return feedBlock + CUT_ESC_I;
}

// Nº de líneas a avanzar antes del corte para compensar el offset del cortador
// de la TM-U220. Si el corte sigue quedándose corto, sube este valor; si deja
// demasiado papel en blanco al final, bájalo.
const WASHER_CUT_FEED = 6;

const SIZE_NORMAL = '\x1B\x21\x00'        // ESC ! 0  → Normal (más compatible que GS !)
const SIZE_DOUBLE = '\x1B\x21\x30'        // ESC ! 0x30 → Doble ancho (0x20) + doble alto (0x10)

// --- Código de barras CODE39 (ESC/POS GS k) para impresoras de impacto (TM-U220) ---
// CODE39 admite A-Z, 0-9 y los símbolos - . $ / + % y espacio, así que codifica
// directamente el nº de pedido (p. ej. "TPV/2025/0095").
const GS = '\x1D';
// Genera el comando ESC/POS de un código de barras CODE39 COPIANDO EXACTAMENTE
// el ejemplo oficial de QZ Tray (sin añadidos):
//   GS h n  → altura
//   GS f n  → fuente del número HRI
//   GS k 69 len data 0  → CODE39 (variante con byte de longitud + NUL final)
function buildBarcode39(data, { height = 80 } = {}) {
    const chr = (n) => String.fromCharCode(n);
    // CODE39 admite A-Z, 0-9 y - . $ / + % y espacio (mayúsculas).
    const safe = String(data).toUpperCase().replace(/[^0-9A-Z\-.\$\/\+%\s]/g, '');
    return GS + 'h' + chr(height) +            // barcode height
        GS + 'f' + chr(0) +                    // font for printed number
        GS + 'k' + chr(69) + chr(safe.length) + safe + chr(0); // code39
}

// Genera un elemento de imagen QZ (QR) imprimible en ESC/POS mediante `ESC *`
// (bit-image). La TM-U220 ignora los comandos GS (código de barras nativo y
// raster GS v), pero SÍ ejecuta ESC *, así que esta es la forma fiable de
// imprimir un código escaneable en esta impresora.
async function buildQrImageElement(text, { width = 160 } = {}) {
    const dataUrl = await QRCode.toDataURL(text, { margin: 2, width, errorCorrectionLevel: 'M' });
    const base64 = dataUrl.split(',')[1];
    return {
        type: 'raw',
        format: 'image',
        flavor: 'base64',
        data: base64,
        // dotDensity activa la ruta ESC * (bit-image), compatible con impresoras
        // de impacto de 9 agujas como la TM-U220.
        options: { language: 'ESCPOS', dotDensity: 'double' },
    };
}

// Igual que buildBarcode39 pero devuelve los bytes como cadena HEXADECIMAL,
// para enviarlos con `format: 'hex'`. Así los bytes binarios de la familia GS
// (0x1D...) llegan EXACTOS a la impresora, sin pasar por la codificación de
// caracteres (CP858), que puede alterarlos y romper el código de barras.
function buildBarcode39Hex(data, { height = 70, width = 2, hri = 2 } = {}) {
    const safe = String(data).toUpperCase().replace(/[^0-9A-Z.$/+%\s-]/g, '');
    const hx = (n) => (n & 0xff).toString(16).padStart(2, '0');
    let out = '';
    out += '1d68' + hx(height);   // GS h n  → altura
    out += '1d77' + hx(width);    // GS w n  → ancho de módulo
    out += '1d48' + hx(hri);      // GS H n  → posición HRI
    out += '1d6b04';              // GS k 4  → CODE39 (terminado en NUL)
    for (let i = 0; i < safe.length; i++) out += hx(safe.charCodeAt(i));
    out += '00';                  // NUL terminador
    return out;
}

export async function printWashLabels({
                                          orderNum, clientFirstName, clientLastName, totalItems, fechaLimite = ''
                                      }) {
    const clientName = `${clientFirstName} ${clientLastName}`.trim();
    const fecha = fechaLimite
        ? new Date(fechaLimite).toLocaleDateString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit' })
        : '';

    const printData = [];
    // Reset + selección de página de códigos para que los acentos/ñ salgan bien.
    printData.push({ type: 'raw', format: 'plain', data: ESC_INIT + ESC_CODEPAGE_CP858 + ESC_INTL_SPAIN });

    for (let i = 1; i <= totalItems; i++) {
        // Etiqueta limpia por prenda:
        //   - Nº de pedido en GRANDE y centrado
        //   - "Prenda i de N" centrado
        //   - Datos del cliente y fecha alineados a la izquierda
        // Reaplicamos la code page por etiqueta por si algo la reseteó.
        const label =
            ESC_CODEPAGE_CP858 + ESC_INTL_SPAIN +
            ALIGN_CENTER +
            SIZE_DOUBLE + `${orderNum}${LF}` + SIZE_NORMAL +
            `Prenda ${i} de ${totalItems}${LF}` +
            ALIGN_LEFT + LF +
            `Cliente: ${clientName}${LF}` +
            (fecha ? `Fecha limite: ${fecha}${LF}` : '');

        printData.push({ type: 'raw', format: 'plain', data: label });
        // Avance suficiente para que la última línea pase la cortadora + corte.
        printData.push({ type: 'raw', format: 'plain', data: buildCut({ feed: WASHER_CUT_FEED }) });
    }

    const impresora = getTicketWasherName();
    // `encoding: 'CP858'` convierte la cadena JS a los bytes de la code page
    // seleccionada con ESC t (acentos, ñ y €).
    await sendToPrinter(impresora, printData, { encoding: 'CP858' });
}

// Imprime una etiqueta de PRUEBA/diagnóstico en la impresora de etiquetas
// lavables (Epson TM-U220). Aísla el código de barras enviándolo EXACTAMENTE
// como el ejemplo oficial de QZ Tray: en su PROPIO trabajo de impresión, como
// un único string plano y SIN `encoding` (la codificación CP858 puede alterar
// los bytes binarios de GS y romper el código de barras).
export async function printWasherTest(printerName) {
    const impresora = printerName || getTicketWasherName();

    // Prueba de impresión limpia (sin código de barras): replica el formato real
    // de la etiqueta de lavado para verificar tamaño, acentos y corte.
    const printData = [
        { type: 'raw', format: 'plain', data: ESC_INIT + ESC_CODEPAGE_CP858 + ESC_INTL_SPAIN },
        { type: 'raw', format: 'plain', data: ALIGN_CENTER + SIZE_DOUBLE + `TEST/2026/0001${LF}` + SIZE_NORMAL + `Prenda 1 de 1${LF}` + ALIGN_LEFT + LF },
        { type: 'raw', format: 'plain', data: `Cliente: Áéíóú Ñ Güeñón${LF}` },
        { type: 'raw', format: 'plain', data: `Fecha limite: 30/06/2026${LF}` },
        { type: 'raw', format: 'plain', data: buildCut({ feed: WASHER_CUT_FEED }) },
    ];
    await sendToPrinter(impresora, printData, { encoding: 'CP858' });
}


export async function printSaleTicket(order, products = [], options = {}) {
    // Compatibilidad: antes el 3er argumento era el nombre de impresora (string).
    if (typeof options === 'string') options = {};
    const { token = null } = options;

    const fechaHoy = new Date().toLocaleDateString('es-ES', {
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const fechaLimiteFormatted = new Date(order.fechaLimite).toLocaleDateString('es-ES', {
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const client = order.client || {};
    const clientName = client.firstName ? `${client.firstName} ${client.lastName}`.trim() : 'Cliente rápido';

    // QR del ticket de cliente: magic link al portal (auto-acceso a sus pedidos).
    const origin = (typeof window !== 'undefined' && window.location?.origin)
        ? window.location.origin
        : 'https://app.tinteyburbuja.com';

    let qrTarget = `${origin}/portal`;
    try {
        if (token && order.id != null) {
            const { link } = await fetchOrderPortalLink(token, order.id);
            if (link) qrTarget = link;
        }
    } catch (e) {
        console.warn('No se pudo obtener el magic link del portal, usando /portal', e);
    }
    const qrCaption = 'Escanea para ver tus pedidos online';

    // Generar el código QR como data URL.
    // El magic link es un JWT largo → QR denso. Usamos corrección 'L' (menos
    // módulos) y un tamaño de render grande para que sea legible al imprimir.
    const qrCodeDataUrl = await QRCode.toDataURL(qrTarget, {
        width: 320, margin: 1, errorCorrectionLevel: 'L',
    });

    // Logo de la empresa en Base64
    // Este es un logo de ejemplo - deberías reemplazarlo con tu logo real codificado en base64
    const logoBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAABjCAYAAADth7gnAAAACXBIWXMAAArhAAAK4QHZ/8a2AAAgAElEQVR4nO2dz48jSXbfv+waAZJhoKrWhIA9dW7PH1BsTF+tYi9mj8bUAprpi61mA0TvSR6OZWB5a7ZhCBwDxrB904BQZ0O+1A7grfYeNUZnydcaVxZgeLGLnd6kYUmQRKiKu9jFCkKJPsSLYjArM/LlL2aSfB+AqGIyMjMyMzLeixfvvWjM53MIgiAIQpU0++MjAAMAB8bmUwCD6bDrVVGnTachCoAgCIJQJc3+uAPgpaXIk+mw666mNtuDKACCIAhCZTT74zaAN4yi96fDrl9ydbaKO1VXQBAEQdhqegWXE5iIAiAIgiBUSbvgcgITUQAEQRCEKtlllrtbai22EFEABEEQhCqZMMudllqLLUQUAEEQBKFKTpjlvDIrsY2IAiAIgiBUyQDALKHMBMCo/KpsF6IACIIgCJUxHXavoBz84qYCLgAcUTmhQCQPgCAIglA5zf54D8ARffYAXAE4kQRA5SEKgCAIgiBsITIFIAiCIAhbyDtVV4DSQDqhTxye8TeYDrtBSdUSBEEQhI1mpVMANMfTNj4HluIcZgB8qDAST/JEC4IgVAcN6DpQ8/jhBD+nAFyZ068PK1EAaKWnIwAflHyqCZQyMBLrgCAIwmpo9scOABfAIaP4BEBvOuxy4/+FkihNAaAG0YPSBrmpHotEtE1BEISSafbHLahp2bT9/CfTYVdi+yukcAWABP8AwONCD5ydCYCBKAKCIAjFYhH+p1CJe/S0bBtqMBi2EDyRvrk6ClMAaH6/B+BZIQcsngsos5NXdUUEQRA2gWZ/HGB5kZ4ZgE6ceb/ZH/cAfBbafF/8t6qhkDDAZn98BKXp1VX4A8rh8E2zP3ZJWREEQRAyQsI8vEJf2za3Tyb/T0KbZRqgInJZAEiQDgB8nPEQE1BIH/29itME6VwtLEIF2+A5nEQxg0ot6WXcXxAEYauJGP0/nw67A+a+PpajwL4ljturJ7MCQHM/LtKH8l3QfidFPHCyPuhPWicUdoMVBEEQFNT/nxubJtNh10mxf3gqQBwCKyBTIiASui74AndG5QsPzyNz04lRrx74loFn1JA7stCEIAgCGyf0PW1IX9jS28peFSErqX0AKKb/h+AJ/xmA5wCc6bDbK9vEMx12T6bDbhvAQygvVA4fAPDEL0AQBIFNWGCnVQCC0Hcnc02EzKSyAJDwf8ks/gIq/G7lI2ua229TVioXtx1VwhxAKQFtsQQoKJzToa+SdlkQhCJxqq6AkMICkEL4TwA8pBF/pcJ0Oux6NC/1nFFcKwFbbQlo9sdOsz/2APwcwBv6/LzZH3s0XSIIguDl3N8JfZcwwApgKQAphP8rAK26edeTo99DqCkJG1utBJCA9xHtQ3EIdW9ECRAEIQh9P0q5fyf0XRSACkhUAKjD53hnPpkOu7V1piOlxIGKQrBxADVtsI2MYPft2MX23htBEAiaEjT70g5NGyZCztrhQYZXSMWEVFjDAGkk7MM+hz6DyrDnFlu1cqBrGiE5VfFWhQhGhPXYkMxdgsDEyGECLC953qa/h1DTpt4q65WXCMvwBVREVWzfEJM6+NV02O2UUEUhgSQnQBfJwr+9TsKALBSdZn8M2JWAZ83+2Fu3lzIH7RRldeZHQRAskD9N1oRltWY67LoUz69zwRwAOG/2x6+wWKL9CrgR/D3c7nNnUMnkhAqIVQDowSYt32vV9urMdNjlKAFusz9urWpaIyLboaYdUXwP/CRME9yes/OhkjF5xvEEAcDNuu5voEZ1uv37xv+e3lbXab81I6i6AhnRgwFzRP+YPqA+1kbp4eFCPJEKgLGin40nG7Cecw9K4MYJ0rtQ96G3ovq0oDrdormL25acQ6jO3KPvHvhrOayl0idkwnw3zJHsTVuhTv4USogFUG1JFIMUrKsQnA67ASmLJ0gOtw4jKwFWTJwTYJIz2ItNeHDUQbVhjw74mBr4KghWdJ5bkCVgwig62wDFTyieQ6hR3zMoJfay2R/7zf64x3UOE9YTsgK3oKLAOJxC+RG5pVVKYHHLAkDCzmb6v5gOu6saEZfOdNi9Iq9U28h7gHRz5FnrEjBMZmXSg8ryaKOzgnpkJpTAqIXF1Ib+v7eu01ZryAFUvvfPaF648twgQjkYvlUDLCyrpsXoAspy6G6RX1XtiZoCGFjKzxAR77lz7Ou566vrR62161ynw67X7I9fIH5Vw8Nmf3y06SPf6bB70uyPnyDaAqSjPWp5D1I4W4mvQzU8hsrOeSQK2OZCUxkbM0DcdJamAGj0b+tEby3ms3PsdwBcQo2gz3eOfbfQGq6OAewm8MFqqlEtZJZzADyByqD4nP53xGS3PZQ0SrsLySMhCLUhbAEYWMpOwnHxO8e+g9sZAh/vHPv+9aPWWi3tSFMBNhP4Aa0V4K2wWpVA5jw37X4WXwlz+94mTSEJqTlo9scdUSYFoXpuFACK07SN/gcR25yYskfgZQ+sFWQCP0X8fehhszJWeQUfjxPBkJSJUdh89HLitYT6wvBUUQtKeR2EyurpT1kwS1g7TAtAx1JuklJjD7JUpiYMEC/IPmj2x84KX/Rw/L5Hfznheq+Q3Mmy5mJDmcz2oEK8gvg9rNxyAqMOt03HdvQ5oK79hOk4FoDhA1CEBYfqe4RlJ0NgEf5WSz+JGtGO2hhKO27mHAjv64etSJSVrhOzr4PFYMWN6svIeY3zXg2o/BH9fxMmSQ68n0yH3bSDn6WpR3rf2ljkBAFU+05sW2SFG9DXqHuo3+Vb9yF0D73Qfo5Rl8yOtOSke5XWGTThnTsRv5JscBWAQdTG60ctb+fYv8ByrPAMazj615BDYPiaTMq2biSm2W32x5yOKkgr7FI40j1ETiWPXugOfaJCTnUkyqjZH0emmqZOW+Mwz+uFNunrTUz9zFhe+pDKTaCWwnY5dVpzXkAJGQdKaHFiweNCjPeweB5ps+c5zH29lMc1mQFAsz92EZ9ALIsgCui4DlRfe4SYe0QWyqMEAZr1PjjMfSMdaUPvli1R2cOY80cdsw11T+LqcwiVtXUClZiOddwyoed4RB+z3jOo6/agFLDcETGkLPboXOb91lEXJzal8R06SGyDg4r7di11aFMF2lANeaQjASg6QP92Rb951iuqByPEr37YQYkKwBZosnsp06PuAnjZ7I+vIhoyN3GRSaa0rM3+eIT4KJEwd6Hq3EaBoW+mj0VSR6fLrqBDNLNJpr1PReIhW3tIg0+j5KR1RNJy2OyPT5CceRWgVTmxsMjVCe67xXofUqxCC6h37k2zP64suRAJ4wHi2/8u1DP+AMCg2R8PMliLzPP16HxRsvuAPo9typG2ALQt53Ftlbh+1LpCvPPgCZYbxQc7x/79NQgVPEF8MqSDFU8DLLEBSxVz0xeHcVFuCF9sp5Qw4rPxGIuRMQuuKbrZH8cuHkMjkDf0v+0whS94NR12e83+OKsCUPd+YQ8Jyn8OhYsj/DVr7UjJGeSkFP4mL5v9cWrrZ16oX/bA7992ofJjtLIshJSyT4pVjnQY4K3YfgPX8lssO8d+nFNh6R7gO8d+a+fY7+0c+7brioVGbLa5tnamihVDHTX/VbBLlioTTuZCLpGdEgnkPCO+w9BURaZ6RGBThpyCz2Ujqj1mcvRcgyRBB7BnSF0lGxtJQ9arLMJf465yoJRB+Js8JmGe5nwusvVJL0mxuuEOjRbi5u0mOUzScQ/AyXg8FpSX4BwqA9kPd459n6Yi0uJZfmtnON4mUVVHHRY2QZknIz+FIszKz1Kkww2Y5WyKIPdcRSgAUe9WnQV5mVaGKMWnLIX9YINTLLs597+L1WYsdZHdsgkoJYA1WKVyeQYkI7Pd3IG9gXo5TuQjOsd+aR7SMXkJDpBtzt5Wz20dhQPYCj8FTZG+Hqxjpbi3TsbfNLMSp7HqvPxtmcpJ1LHLtBhsXD9EI9S0iwpFsRILCQnkNNM3cST2D2RpcHOeZ9c8RmYFYOfY39s59t2dY39ufFw92ibfgB6WlYBXJScIclJuj4XMkXGmzDzanlBPlgQvIytmWj5IMWI7ZZSxHYsjGIpS4sL3zWHsY1t8i0NdLQzBis9XlQIQd//zPleguIyrd1dkISlKnt0Nm+cj6KEYhfJQOwknKQC2TuIEyhRxCuC7UOFAjwF4hhLgXj9q7UGFfXzr+lGrk7vqduIaZtYOI/b6V7hCoBCPj0W6Yo7QBJTfwPPwJ2L+mTuC+ISOwYHrk8IRzrb3ljPl5fGqkkj4vnE6xLzKRxkWqCLmjIMCjpGGShQAi5Uq13OhKTfO6J/7rrez1yYZGv1z6nsBnnIU2+cY4X5F0QFUFEBsw4970ORcdwjg9fWjlu7UTnaO/QBq7r0DoyNYVejf9aOWv3Psv8LyHMkMEVrlzrHfBhBcP2oFlkPaflt3b/yqeQWlRPpQzyf1vJaZDIYc7Tgj9sQFjehl45j1XukwHqbFoIPiBKRtJLBKCwCAm857AN59K20aMAdphekE6noD+r6HfJaJUyjT7AmUdeecsc+m9UEdRpnJdNhtM8Mmy1aQOowyr6fD7hG9H0nP1BZh1kHy6F8v1jdCspX6CFAKQFynZfOw1jd2YG68ftQa7Rz7nyEhWQ7N1Y8AuNePWoV2BtePWp2dY9+jOgRQuQeCiKIugLukMJzE1MNDvBNYC/XsyNaBh6HYcRfFx1ZHwszSxx2pD4z/R0hWALhTRyzhbFmbgmMmLEoBGJHCxJ23naHGaYCZvMoSumXhYjrsto3vfkJK8k2lzSij318fFSoAKQYJA0ANppv98WvGPm1Evx+c0f8RJbLrITkt+26zP25HLQesCRgnXCqTwtvehWrcH+wc+xMslIFC5vauH7VcWDoZGv3rDusx1AJGM6hG5ely+5uV978uXNQhW1cCbUaZiamp0zoSiTtxFpSizoJRhdt+AMypqSIdANP6w3TWINzPxuuChT9QzUCijo68nLaU5l6VaSFpM8qEo+gyWS0SIvU0p7pfISVgwtinZVMAbOiLGmBZM9Gj/tiHtHPs97Cs2d6Fmjb4bOfYfw1KlRiXLIisBw4WD8BLM8VASoob8dMu1cusW1Q5IR/rYDVpM8pEtU9bCmlNCzzFknMsJ2Ibp9OrovOvTarWHMywuvCyAOVaAGqlhHF9qoz24yE5RLdMZ+02o4wX+p7Vt4djkXQjzp1kVd2zKQCxlb1+1DrZOfZPAXys59KhOqMDqI4rXBkAN8J3YDmnTpOInWMfuO3s0cJt8+aznWP/CY36OYzANFdOh93AMhJrM88n1IfEBDUpzNlR7wenU+WOSnzwlAnOtjAesw5FcDO3veYjf0AtxrOqawgYZTZpioDTbuu0kiinvoH5hWnZy/pOh/sjH8kKgHUKIKmh63n+x1h0VK8BdKJM+ST8PaQLY+A28Jc7x75z/ag1iCtAloMTpNAKd4799j63sLAOcDpv7rxhELMtqc2mUQASNfiMx1+FBUDP9fsAvA0Q/kIynP46zoOf024DflUUzf54r6S2x7lWL8Nxo+Sjk7RThMO++f0Cqu8L1yewKQDWB0JCvgOgs3Pst2z5/Q3hX6ZJ5hllATzBspnZgVJWikjWINSXoub7uMcJ9D80R6c/SXAVDI6QjuqEVh4BEMMujEVRtmyFRCE9Xuj7HhZtWbfzLO2WO+XGJmuaYeonOHPzYRKVDYqCcg3fHh+MlWVtCgDbgzJB+DtIOfLOwV2oTqeQ1cj2z89sN6+OTjTbTFEev9zjjMicV1a75kYChEc4TsIuZWYAtKFXSOwgeTlbYcuguX0v7ncSuqbgrbL/5fYRR+SRv4fyp2ueQaUcB4wRP/lW+FDLwwfhnbI6AbIgh78B6rOARlpsD3pbO7A6zcNVSakK7XTYveJ68mK540wqX7Xiegg1IGhXXA9hjSCF8cr8zoyUqZIqlsUGFn3TktLR7I9nUO+eq50prVMAZLrfS0iWswTtcwQl+IvI6SzUi21VfKrAR/I75Oh/KNlIEl6O+kSh84WkedcPo8IhV7GC25pHIYTZKmWc2kcLSnlsV1qZ1ZJl2iCKXVDYe7M/fjEddnvvID7c6ADKdPFz8vj36LOUPY8EfguLB7Mpc+2nsDeyqkdS24i3gnMUNZVQBD6S3yfH+L8KB0B3OuwOaH6zA/7qiUe4/Tzz3Pt2jn3XlY1WxkngH2EhW7JY3ZwCq6RZdR/hofhEaR83+2PvHVga0f752d7l/QfAIj7+GXATorfpBLA3no1++baY0kehKUgbN9xmlA8y1SQBml8ckFmWowTUSdESagTNW/dQzGDSKeAYYVbdRwxQTqbUwTtQ2kWcg0ILaiS8SfGmXHxYkn5smClRKIcJbgtcN8X+HAXA7IycpMLc5YZzLHY1At8KIBTP2ipWxnK3m2JF5hDVRyxB+WieQL1bRfrTHbwDeyfTpt/rqgDoBWX0aLwFpTnmni/5nV//6iuoDIVR2NZJENYbD7z2/gmW351IL9s8JCSi0ph1dRLKcldRS4NnfiHnLE4Ww8LOuaE4jDJRVsiyR6el+B2Q8PewHkute+ApuQ9D3zP3EdNh1232xx7UoPQIBd0njgLQQ3XejHHoVY8cLKciDrC4QXnqPPvtn/z4X1h+34o5EMGKn8YKZDowTYfdQYrzJFrgjBXEkkZ/q2q3Mj2WH4dRpop+qKxnO8B6CP80sDNHGv1DCyprZhAuo6fZ6KOdfveg5LRDnxZSWAneoVFGnJfh3f3zs+Dy/oNZmoMy0Fpk1gfehhL84XmRQ9r2BMo6kHXe5AT2/MtexuMKGwyZzdu4nRTIFOBpR+EcC5wDpfwmvaOiuObDq7oCmwgJvzQDttdQffTLcmpUGLeSEDX74xFuK+rh99vH7URjV2FlQk/nkZXwxrpA93MEhvzTYYCepXAH6mYX4YRwAeAPAHzD2DZCOkXgFdXJVp+XAP4VlBDPori4sC9aY/ttnVnb+cMCCZjlokytbRQ//x0wyrSYMdGiAKwPZaWarSMdZrkLqCRSAQA0++OqFIAgx74tJD/b8PE7WCT5ieM5FksPX3GXWL9Df20C7QjFrIo3AfCHAP4Caq3iN1DC/w9SHucH4GmLv49s9Z7sn585iFccJkXP9daIdU3YVCQBs1yUsuQUeHwN1xEw8dxcB8ACcFZ0no0kRT6ETZlq4Q482nXoe1PUwYnYlnitGa8xy+BtcodOeAI1rx7F3f3zsz3kd3xzAfwRloXMAYBvQ5l0uPyaWc5BNk1tBLtG6mY4plA+RVkvuEIyqpN2GPsF7JqAHW3SZpy7DAfAWzDXLq8jVYZ/htsuqy2vUKErG4dR5rRm6aM5zpCO+YUUu6RBVpSc5Vy3E/rOaUPBHeOLzQrQg30ZXw5XiF+9rC4Nebb/kx//DHYTjbuiugjpKMR6QZ0MR9mNesHKMtsm1Uc7ENko/R2jDo47PRbVqVU5BVWlA1q4X7T5H2nK8MavSglax6lHj1GmnfA9iqj3lPPuHoQsR5x76pmpgF3Ezxkc7p+fDS7vP8iTklA7RIQ7yQDLnvxJ/DNmOR/pG9YIv/7Vv7f8floHE9QG0q66AiE8JM+fhfNsczptIJsg9mF/7zjCq1QFgBwg0/jzRNUnjwCqcgRvI0tIJKcteemrkki7hGNyqHTqkQRnB8v33QMwslgdOO9TWP5keq7TYddj+viY0/VtzrluLABkarRplQPkswI8BvA/ALyg7zMoxwUg3QvyEZQjYBJ/Ct4N10z2z888yOg/E2T6rTsOsxxrFBsS+qxRW0YzJmsEUMAxsnBE8clvGHUw8fKcU//T7I9b5PBUt1BlDed53wgKUqQ4gywvY300jnlOeoabFoaXCIXSBVA5Xw6xnPU2sKyvwekjdmn1SzOtcRJezHbOFF6v2R87tDRwUhuaTYddL7wY0AjxoRWH++dn7uX9B3kyA/6IzqETJHSQ3mv6MZSHv2OpxxMA/w7pNMse1S2OiaxlbsWpugIM7tLynFoYtqHqfTUddk0rlAeloCa1nwF1nG3womQ8dk2XyS28S5wvziJ4JzkzaX5MHbOD+vsbcMI4d6nT9sEbZMzIbysPemnmVHHjRZNi4HBj4THWnch77j2odzLu+nehltRthS2/5Gn/GslZC0fN/vgKvFVxJ5b31EVyOzoA8POEMpoTILQaIGUbGiD+pRrtzi5/b7a7/xfI1mh2QesWZ9jX5L9CNYAB/XVouwfgv0EJ/zRhi6/3z89asGvAg1Q1FFYNN1dFVHbHGYxpKHq5OaGvBwAu2TXMbkEKMu6nWYkDYArcAo5R1+ykYbiKV5o+sagw5DrcQ4dZ7qDZH+t7WZSloofkPmMXCzkTZoRkBWAXwA+Z9XEtv52g2FTAA2ARBmhim4/fvfP26/+SUGYV6Js6gBL6A/rsAfjvSCf8J82f/fQ/w/4Cyui//uQZ4Ua9VIMcx4viNOsovIDRe12cbAE1DTKouhIrpIycIW4Jx1wHDlDsNAV3irgdtZGsWEUq127cDzR1aLNQp+GVtmjcUgDItGS7qEMKC+TMw5fNIdSUhc4r8DHSmQRnv/PrX/2b61/+4s8SynWyVW99WMVa7CUTFHkwekGKbOODnPvn6WjqogDoFN5x1KWehUEdd5FC4nTDFiILKjw3V5mwyZRBAfUAgOcMB/MR8ofjz2DUOcoCACSP8D/bPz87QUkLQ6yQ3m//5Md/BPsDfr1hL1wc6xiKY+Ll2Tlm9bse4vNjpKGINhTk2LcOgvUCgJPQydl+W2cGBR6rk/B7UOC5SofaQxHvWBa4wjS2fvReP4/7PUU9Ekf3pEx2cp6rZ76DkQoAmRyTLspt/uynf4j1VQKe7J+ftWGfw5lhC0b/G4ItmVUm6IVr5zzuBMW0ocxCvOKEMTMAn0yH3VZSBATVc+NW2izQVPyEMUr0CjjPqiljmoSDxyxnrR9NaWW1Fs6g0huzooOoLT3JeK5X4ansOAuAviibcN+9/uUvfrSmSoAW/km+Ap2aZZ+qA7W0FBSgHUdeFwmlDrIpAale7gSyCvGs72Y7436a11ACa2867KaZuxzkPG9qLKFeRXKEfMrNrc47ClIQXiSVi6Gqkfggw7mLkDnc83JG5x2kv+8TqPTGqd5tagdplYDnVMclYhUA4gj2G2QqAXXzNI6DK/xfFBBqs4nUdr0Ael5PkK0ji/WBoOO2ka7TOYUyeRc1+s56nFWN/k+hOsDvAtifDrtHWRxnaZ80o6kJ1DPPY4bl+r84WU9gWJPSCq4ZlCLVSbHPAOn64wuoe+im2KcwSGnhOpbPoNpYbkd05nmfcN9hCiV+iOR7r3PgtHI4BrsAvoXkNPqvATyMc7wN5wEInySgZCdvLMV2r3/5ix/tn591Lu8/8FHfhByz3/qH3/zrf/5//vfvI1n4X4TiwuvGBLfn+oLQNi/DcWdYFhhpjhFANWof9uQnQcy2U9pPn99Bhg6XQllPsMjs5WDZx8O8d7quARKulV7UFsVOHyF66mgGZS50i/YbodDELMtyF6kA6HunPz7UMqSFKhnTYbdDyX16UELTvGZdBw9q3XQfACh8uQjC75aDRftx8hyYBE6L6tqB3fdIt6VB2uyjWtmgttrB7XC/CyzfwwAAKKdF2QRRG+m99aGUl6h36wJKQXHpXWgXUZnQedtYtLXXUPc+7ejcg7r3DlQ/EVYuvaL6BnpuR+TA3cayFdOnc1mtj435fJ54ImpInKUXn5MS4KJeI8XTb/6///uffvN3f/vHSPb8vIAyy4jpX7BCpmP9gvtltxnqoNPGbt/PIqCpA3Poa+nXlhcSqomx9NNht1F+bXhQ+9EJjTRXUPfbq6A+HpLb1+l02G1H7HsEXrz7c04YqCngo+4FMxnQHtS9dBn12kpYCgAANPvjEXij+9Pf2v/Gv/1b595/QHKShLKZARjsn58BvExMM2SYkxGEVcAVcgaz6bC77uGdLCIsAAEiRptbEtGTCcqSabaXKGveVbh/JGF8Al5YHUsBEFYDWwEAADLLcZLszACMLu8/8KAEbxUZp15982/+evybv/rL/8g8vwh/odaksMRpXqWcOxYEFsYI/AjpkvM8kRF5fUhyAlyCOhOOs80ugGf752fu/vmZC55jRFG8+ubf/PW/3D8/w2/+6i//J3jCP5M3piCsmLRmeK+MSqwTjUbj/arrUBcKvhcdKGtU2sx80sfWiFQKAHATHsgNQbgL4CUpAie7s8sDKE/homN9LwB80vzZT3/PEPzcdMAXyOGNKQirgOZYByl2mW37SKvRaAwB/Hmj0XhadV2qpib3wrbYjVAB1iiAOAzPSQ88Z7+7AD678/Zr7KsQn94/3Xv37Wx3/9tYeC+mSeF7CqVJ+r8bvP1f/3j5998G0LmOXujFxiuozEi1dnASNh9yCIuKN3aQbcW7ovKGryWNRuNDAE8B9AF8UXF1KqVG98Kt8NxCBJkUAECFRRnOH2nm+B8DeEzKwCmUEuECCC7vPwAsMbm7s8u/v/P2629AKQwtAIN/zNY5zqAEv5thX0EogysU5yszQ04FgEaK7wH4dD6fvzW23wPwffr66Xw+f9toNP4EAObz+feozPcB3APwabhs6Nhv5/P5p8b3PoAP6X9ArbT4OZ3jqbEdAC7n83k/tP2mPG37kurxIYDPo+qe8p78SUKRr+hv3LUNI/bp0+/6t8/n8/nndL7Ia6vDvUD6kEhWulthtaRyAoyDvEcHKC707wLL850Oilv3+xQqw19Q0PEEoRCa/XH+l1Hx3bxJrEjYPQXwnfl8/qWx/SkALQj7JOTOoITMuySgvoYSNqbQ68/n809Dx76cz+ffML6/CyWUTDP1JW0fhra/nc/n7xr7muW/A+AHVAdACcLvRdU95T1Jej6f09+4a/s6Yp8HAP4cwD7VfR90zy3X9hQV34uUIaniYF1TUvsAREGpPlsobvW0A6jGpT9FCH+dUastwl+oKUX4xpSdwfJexKJwrjoAAAQmSURBVP9fhb7fA/AWSphF7afZtzimfQfKgrCPZaH2EZQwfRAq/xGUAN4H8OF8Pn+Xtr/VlomYuqfhXSilBlS3d+fzuc4rYJ4HiL62W/tDKU77tF0L4fB+S9cW2l7VveDyGsVmxBQKpBAFAFBZiShKYJUe/xx02kVHTP5CzQly7v9iBRks34MaWV5iYW7W5uP3yLSst0WVjTpeHF9GlLmcz+dv5/P5ZajsJRbz2/uIhlOfWMhMrs97yTCbL50jZn9d5issFKlw/eOurbJ7AXv65BnUYPA+pYQWH6uaktkHIA4jFWIbKlSE641fNHrOyZUGKKwJTsb9ZlDTWqtYu+I9KOF+icVI1bQAmFaBpxFlTS6hRrRfRfwGLBQLbR4HlJIBqNGsKYD3jXPECeaout+i0Wj8AADm8/lHcWUYJF2bhjP6Dl+b3qf0e2EhHP53AeWYfSJrqKwPhSsAGlIEPMrQdQSlDKSNGU2Lzp8tjVBYR9JOdWlnv9EqlNxGo7EPJVxuRrKNRuM9LCsA5oj2Vtn5fG4KxC+hhGQaB7QbZzkApsn9B/T3LRZz8Yl1N+tD1osbJ0RyZvwig4MckO3aNOFRe/ja9D0o7V4weKj/keyK60tpCoCG5ttHAEbGAglt3F7kIysXUJEEngh9YQuYYLGIy6rbu+lhrkfk9+bz+VeNRkOPTE0/gFtlsTwi1kIyzQj0cyjBFRZWX9JxPo8wicfWPXSce1j21B/S73kUgCyj63D9l66NRv1AuffCigj9zaB0BcDEVAaAm9hnB4sFMRwquoeFtSBqhTq9alztFykRBA6kHJu+M+bKiAF9qm7vWnA8DW37Akp4fIjbJu2ospovsfB8jyJq+xdmVILBp1BC70MsnOm4dQcAkOf9u1iMoD/KOPoHkq9NEyWgw8RdW2n3QtgOVqoAhCHPUB/KbC8IWwspx+2Kq5GEFu5auJkx+1pQvg+lDNjKmuiRsu18ejohiS8BvN9oNO5FCG5WfSiM8VP9P+OcSfWJuzaNqQDoa4w67821pTh3rnshbD6VKgCCINSe71MmOdNj/XtYCI5wKCAYZU3ihKSZ1OYLLEaruj7AIqQORrn3ATylKQlgEY7HrQ/m8zl7JGyk1o0K++MoAPq+PcVCAYgyxd9cm7Gt9HshbDaiAAiCYEMLNZ1J7mZk3Gg0LgHcI6cyU2h9pfeLKWsSZcIGlFC6BPA98jEI1we4bd7WxzKFro6dj617zDw5F51NLxyjb9Ynlvl8/jkpEXrfOLO+eW36/7rdC2HNKCQToCAIm4XhKa7R89mXWkjoMoYguREs9H9k2YT9bs4bSkEcrg9sx8Ly/Hti3VPem5trC9VLC8/Ia4va39j2Pm0zoxI411bpvRDWG1EABEEQBGELKSwToCAIgiAI64MoAIIgCIKwhfx/rZBhKMJCzEEAAAAASUVORK5CYII=';

    // Las líneas anuladas en un ajuste no se imprimen: el ticket debe reflejar
    // lo que el cliente se lleva y paga, no lo que se cobró por error.
    const linesHtml = lineasActivas(order.lines)
        .map((l) => {
            // El nombre viene en l.product.name (detalle del pedido). Como respaldo,
            // se usa l.productName o la lista `products`, y por último el id.
            let name = l.product?.name || l.productName;
            if (!name) {
                const prod = products.find((p) => p.id === l.productId);
                name = prod ? prod.name : `#${l.productId}`;
            }

            // Calcular el IVA para cada producto (suponiendo un 21%)
            const iva = 21;
            const importeSinIva = (l.unitPrice * l.quantity) / (1 + (iva / 100));
            const importeIva = (l.unitPrice * l.quantity) - importeSinIva;

            // Extraer notas y fotos de recepción de annotations
            const annotations = Array.isArray(l.annotations) ? l.annotations : [];
            const receiptNotes = annotations.filter(a => a.origin === 'receipt' && a.type === 'note');
            const receiptPhotos = annotations.filter(a => a.origin === 'receipt' && a.type === 'photo');

            let detailHtml = '';
            if (receiptNotes.length > 0) {
                detailHtml += receiptNotes.map(a => `<div style="font-size:9px;color:#b45309;margin-left:12px;">⚠ ${a.text}</div>`).join('');
            }
            if (receiptPhotos.length > 0) {
                detailHtml += `<div style="font-size:9px;color:#666;margin-left:12px;">📷 ${receiptPhotos.length} foto${receiptPhotos.length > 1 ? 's' : ''} adjunta${receiptPhotos.length > 1 ? 's' : ''}</div>`;
            }

            return `<div class="producto-linea">
                <span class="cantidad">${l.quantity}x</span>
                <span class="nombre">${name}</span>
                <span class="precio">${(l.unitPrice * l.quantity).toFixed(2)}€</span>
            </div>${detailHtml}`;
        })
        .join('');

    // Calcular el IVA total (21% por defecto)
    const iva = 21;
    const importeSinIva = order.total / (1 + (iva / 100));
    const importeIva = order.total - importeSinIva;

    const fullHtml = `
    <html>
      <head>
        <title>Ticket ${order.orderNum}</title>
        <style>
        /* Estilos básicos */
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
        
        body {
            font-family: 'Open Sans', sans-serif;
            padding: 0;
            margin: 0;
            width: 80mm;
            color: black;
        }
        
        .ticket-container {
           padding: 0 5mm 0 5mm;
           margin: 0 0 10mm 0;            
        }
        
        /* Cabecera */
        .header {
            text-align: center;
            margin-bottom: 10px;
        }
        
        .logo-container {
            margin-bottom: 6px;
        }
        
        .logo {
            width: 60mm;
            height: auto;
        }
        
        .company-name {
            font-weight: 700;
            font-size: 16px;
            margin: 4px 0;
        }
        
        .pedido-numero {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 6px;
        }
        
        /* Info cliente */
        .client-info {
            margin-bottom: 8px;
            font-size: 12px;
        }
        
        /* Productos */
        .productos {
            margin: 8px 0;
        }
        
        .producto-linea {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            font-size: 12px;
        }
        
        .cantidad {
            width: 30px;
        }
        
        .nombre {
            flex-grow: 1;
            padding: 0 5px;
        }
        
        .precio {
            text-align: right;
            width: 60px;
        }
        
        /* Total y otra info */
        .total {
            font-weight: 700;
            font-size: 14px;
            text-align: right;
            margin: 5px 0;
        }
        
        .desglose-fiscal {
            font-size: 10px;
            text-align: right;
            margin: 5px 0 10px 0;
        }
        
        .ticket-no-pagado {
            border: 2px solid #f5c6cb;
            padding: 6px;
            margin: 8px 0;
            text-align: center;
            font-weight: 600;
            color: #721c24;
            background-color: #f8d7da;
            border-radius: 4px;
            text-transform: uppercase;
        }
        
        .payment-info {
            font-weight: 600;
            margin: 5px 0;
        }
        
        hr {
            border: none;
            border-bottom: 1px dashed #ccc;
            margin: 8px 0;
        }
        
        /* Información adicional */
        .info-adicional {
            font-size: 11px;
            margin-top: 8px;
        }
        
        .observaciones {
            font-size: 11px;
            margin-top: 4px;
            font-style: italic;
        }
        
        /* QR y agradecimiento */
        .footer {
            margin-top: 12px;
            text-align: center;
        }
        
        .qr-container {
            margin-bottom: 8px;
        }
        
        .qr-code {
            max-width: 48mm;
            width: 48mm;
            height: auto;
            image-rendering: pixelated;
        }
        
        .qr-info {
            font-size: 10px;
            margin-top: 2px;
        }
        
        .gracias {
            margin-top: 8px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 15px;
        }
        
        .info-legal {
            font-size: 9px;
            margin-top: 15px;
            text-align: center;
            color: #666;
            padding-bottom: 15px;
        }
        
        .cut {
            break-after: page;
            page-break-after: always;
            margin-top: 30px;
        }
        </style>
      </head>
      <body>
        <div class="ticket-container">
          <!-- Cabecera con logo -->
          <div class="header">
            <div class="logo-container">
              <img src="${logoBase64}" alt="Tinte y Burbuja" class="logo" />
            </div>
            <div class="pedido-numero">Pedido: ${order.orderNum}</div>
            <div style="font-size:10px;">Fecha: ${fechaHoy}</div>
          </div>
          
          <!-- Información del cliente -->
          <div class="client-info">
            <div><strong>Cliente:</strong> ${clientName}</div>
            ${client.phone ? `<div><strong>Teléfono:</strong> ${client.phone}</div>` : ''}
            ${order.paid ? `<div class="payment-info">Pago: ${order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}</div>` : `<div class="ticket-no-pagado">Pendiente de pago</div>`}
          </div>
          
          <hr/>
          
          <!-- Detalle de productos -->
          <div class="productos">
            ${linesHtml}
          </div>
          
          <hr/>
          
          <!-- Total e información fiscal -->
          <div class="total">
            Total: ${order.total.toFixed(2)}€
          </div>
          
          <div class="desglose-fiscal">
            <div>Base imponible: ${importeSinIva.toFixed(2)}€</div>
            <div>IVA (${iva}%): ${importeIva.toFixed(2)}€</div>
          </div>
          
          <!-- Información adicional -->
          <div class="info-adicional">
            <div><strong>Fecha estimada de entrega:</strong> ${fechaLimiteFormatted}</div>
            <div class="observaciones">
              ${order.observaciones ? `<strong>Observaciones:</strong> ${order.observaciones}` : ''}
            </div>
          </div>
          
          <!-- Pie con QR y agradecimiento -->
          <div class="footer">
            <div class="qr-container">
              <img src="${qrCodeDataUrl}" alt="QR Code" class="qr-code" />
              <div class="qr-info">${qrCaption}</div>
            </div>
            <div class="gracias">
              ¡Gracias por su confianza!
            </div>
            
            <!-- Información legal obligatoria -->
            <div class="info-legal">
              Gestiones y Apartamentos Úbeda S.L. | CIF: B22837561<br>
              Carretera de Sabiote, 45 - 23400 Úbeda<br>
              Conserve este ticket para posibles reclamaciones<br>
              Dispone de hojas de reclamaciones a su disposición
            </div>
          </div>
        </div>
        <div class="cut"></div>
      </body>
    </html>
  `;

    try {
        await sendToPrinter(getTicketPrinterName(), buildRawHtml(fullHtml));
    } catch (e) {
        console.warn('QZ Tray falló, recayendo a window.print()', e);
        const w = window.open('', 'print_ticket_fallback');
        w.document.write(fullHtml);
        w.document.close();
        w.focus();
        setTimeout(() => {
            w.print();
            w.close();
        }, 300);
    }
}


function getTicketPrinterName() {
    // Impresora de papel normal: tickets de cliente y etiquetas de recogida (no lavables).
    // Prioridad: 'printerTicket' (nueva) → 'posPrinterName' (legacy) → defecto por entorno.
    const saved = localStorage.getItem('printerTicket') || localStorage.getItem('posPrinterName');
    if (saved) return saved;

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return isLocalhost ? 'Brother HL-L2445DW Printer' : 'CLIENTE';
}

function getTicketWasherName() {
    // Impresora de etiquetas lavables (las que van con la ropa).
    // Prioridad: 'printerWasher' (nueva) → defecto por entorno.
    const saved = localStorage.getItem('printerWasher');
    if (saved) return saved;

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return isLocalhost ? 'Brother HL-L2445DW Printer' : 'LAVADORA';
}

const fmtMoney = (n) => (Number(n || 0)).toFixed(2) + ' €';
const fmtDate = (d) => {
    const dd = d instanceof Date ? d : new Date(d);
    return `${dd.toLocaleDateString()} ${dd.toLocaleTimeString()}`;
};

export async function printCashMovementTicket(movement, opts = {}) {
    const printerName = opts.printerName || getTicketPrinterName();
    const typeLabel = movement.type === 'withdrawal' ? 'Retirada' : movement.type === 'deposit' ? 'Ingreso' : movement.type === 'refund_cash_out' ? 'Devolución' : movement.type === 'sale_cash_in' ? 'Venta (efectivo)' : movement.type;

    const amountSigned = ['withdrawal', 'refund_cash_out'].includes(movement.type) ? -Math.abs(Number(movement.amount)) : Math.abs(Number(movement.amount));

    const html = `
    <html>
      <head>
        <meta charset="utf-8"/>
        <style>
                   @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
        
        body {
            font-family: 'Open Sans', sans-serif;
            padding: 0;
            margin: 0;
            width: 80mm;
            color: black;
            font-size: 0.8rem;
        }
        
        .ticket-container {
           padding: 0 5mm 0 5mm;
           margin: 0 0 10mm 0;            
        }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .hr { border-top: 1px dashed #000; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; }
        </style>
      </head>
      <body>
      <div class="ticket-container">
        <div class="center bold">Movimiento de Caja</div>
        <div class="center">${fmtDate(movement.movement_at || new Date())}</div>
        <div class="hr"></div>
        <div><span class="bold">Tipo:</span> ${typeLabel}</div>
        ${movement.person ? `<div><span class="bold">Persona:</span> ${movement.person}</div>` : ''}
        ${movement.note ? `<div><span class="bold">Concepto:</span> ${movement.note}</div>` : ''}
        ${movement.order_id ? `<div><span class="bold">Pedido:</span> #${movement.order_id}</div>` : ''}
        <div class="row"><span class="bold">Importe:</span> <span class="bold">${fmtMoney(amountSigned)}</span></div>
        <div class="hr"></div>
        </div>
      </body>
    </html>
  `;

    await sendToPrinter(printerName, buildRawHtml(html));
}

export async function printCashClosureTicket({closure, openingAmount, movements, summary, tpv}, opts = {}) {
    const printerName = opts.printerName || getTicketPrinterName();

    const signed = (t, a) => (['withdrawal', 'refund_cash_out'].includes(t) ? -Math.abs(a) : Math.abs(a));
    const totals = (movements || []).reduce((acc, m) => {
        acc.byType[m.type] = (acc.byType[m.type] || 0) + signed(m.type, Number(m.amount));
        acc.total += signed(m.type, Number(m.amount));
        return acc;
    }, {total: 0, byType: {}});

    const saleTotal = totals.byType['sale_cash_in'] || 0;

    const typeLabel = {
        sale_cash_in: 'Ventas (efectivo)',
        withdrawal: 'Retiros',
        deposit: 'Ingresos',
        refund_cash_out: 'Devoluciones',
        opening: 'Aperturas',
        correction: 'Correcciones',
    };

    const linesHtml = Object.entries(totals.byType)
        .map(([t, v]) => `<div class="row"><span>${typeLabel[t] || t}</span><span>${fmtMoney(v)}</span></div>`)
        .join('');

    const movementsHtml = (movements || [])
        .map(m => {
            const signAmt = signed(m.type, Number(m.amount));
            return `<div class="row"><span>${typeLabel[m.type] || m.type}${m.note ? ` - ${m.note}` : ''}</span><span>${fmtMoney(signAmt)}</span></div>`;
        }).join('');

    // Sección Tarjeta / TPV (solo si hay cobros con tarjeta en el periodo)
    const tpvPayments = tpv?.payments || [];
    const tpvTotal = Number(tpv?.total || 0);
    const tpvMarked = Number(tpv?.marked || 0);
    const tpvPending = Number((tpvTotal - tpvMarked).toFixed(2));
    const fmtTime = (d) => {
        try { return new Date(d).toLocaleTimeString('es-ES', {hour: '2-digit', minute: '2-digit'}); }
        catch { return ''; }
    };
    const tpvRowsHtml = tpvPayments
        .map(p => `<div class="row"><span>${p.reconciled ? '[x]' : '[ ]'} ${fmtTime(p.createdAt)}${p.order ? ` #${p.order.orderNum}` : ''}</span><span>${fmtMoney(p.amount)}</span></div>`)
        .join('');
    const tpvHtml = tpvPayments.length ? `
        <div class="hr"></div>
        <div class="bold">Tarjeta / TPV</div>
        <div class="row"><span>Cobros registrados</span><span>${fmtMoney(tpvTotal)}</span></div>
        <div class="row"><span>Conciliado</span><span>${fmtMoney(tpvMarked)}</span></div>
        <div class="row"><span class="bold">Pendiente</span><span class="bold">${fmtMoney(tpvPending)}</span></div>
        <div class="mt">${tpvRowsHtml}</div>
    ` : '';

    const html = `
    <html>
      <head>
        <meta charset="utf-8"/>
        <style>
        
           @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
        
        body {
            font-family: 'Open Sans', sans-serif;
            padding: 0;
            margin: 0;
            width: 80mm;
            color: black;
            font-size: 0.8rem;
        }
        
        .ticket-container {
           padding: 0 5mm 0 5mm;
           margin: 0 0 10mm 0;            
        }
        
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .hr { border-top: 1px dashed #000; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; }
          .mt { margin-top: 6px; }
        </style>
      </head>
      <body>
      <div class="ticket-container">
        <div class="center bold">Cierre de Caja</div>
        <div class="center">${fmtDate(closure.closed_at || new Date())}</div>
        <div class="hr"></div>

        <div class="row"><span>Apertura</span><span>${fmtMoney(closure.openingamount)}</span></div>
        <div class="row"><span>Movimientos</span><span>${fmtMoney(closure.expectedamount - openingAmount)}</span></div>
        <div class="row"><span class="bold">Esperado</span><span class="bold">${fmtMoney(closure.expectedamount)}</span></div>
        <div class="row"><span>Contado</span><span>${fmtMoney(closure.countedamount)}</span></div>
        <div class="row"><span class="bold">Descuadre</span><span class="bold">${fmtMoney(closure.diff)}</span></div>

        <div class="hr"></div>
        <div class="bold">Resumen por tipo</div>
        ${linesHtml || '<div>Sin movimientos</div>'}

        <div class="hr"></div>
        <div class="bold">Ventas efectivo</div>
        <div class="row"><span>Total</span><span>${fmtMoney(saleTotal)}</span></div>

        <div class="hr"></div>
        <div class="bold">Detalle movimientos</div>
        ${movementsHtml || '<div>Sin movimientos</div>'}

        ${tpvHtml}

        ${closure.notes ? `<div class="hr"></div><div><span class="bold">Notas:</span> ${closure.notes}</div>` : ''}

        <div class="hr"></div>
        </div>
      </body>
    </html>
  `;

    await sendToPrinter(printerName, buildRawHtml(html));
}

// Etiqueta interna mínima para cuando el pedido ya está preparado.
// Solo lo imprescindible para localizarlo en la estantería: número de pedido
// en grande, cliente, fecha de entrega y un QR pequeño que abre el pedido.
export async function printInternalLabel(order, options = {}) {
    if (typeof options === 'string') options = {};

    const origin = (typeof window !== 'undefined' && window.location?.origin)
        ? window.location.origin
        : 'https://app.tinteyburbuja.com';

    const client = order.client || {};
    const clientName = client.firstName
        ? `${client.firstName} ${client.lastName || ''}`.trim()
        : 'Cliente rápido';

    const fechaEntrega = order.fechaLimite
        ? new Date(order.fechaLimite).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '';

    // Separar el número de pedido: prefijo (TPV/2025) pequeño y nº secuencial (0095) grande.
    const numParts = String(order.orderNum || '').split('/');
    const bigNum = numParts.length > 1 ? numParts.pop() : (order.orderNum || '');
    const prefix = numParts.join('/');

    // QR que abre el pedido por su número (uso interno).
    const qrTarget = `${origin}/buscar-pedido?num=${encodeURIComponent(order.orderNum)}`;
    const qrCodeDataUrl = await QRCode.toDataURL(qrTarget, {
        width: 160, margin: 0, errorCorrectionLevel: 'M',
    });

    const html = `
    <html>
      <head>
        <meta charset="utf-8"/>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            margin: 0;
            padding: 0;
            width: 80mm;
            color: #111;
            -webkit-font-smoothing: antialiased;
          }
          .wrap { padding: 5mm 6mm 9mm; text-align: center; }

          .prefix {
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 3px;
            text-transform: uppercase;
            color: #6b7280;
            margin: 0 0 1px;
          }
          .num {
            font-size: 64px;
            font-weight: 800;
            line-height: 1;
            letter-spacing: 1px;
            margin: 0;
            white-space: nowrap;
          }

          .rule {
            border: none;
            border-top: 1.5px solid #111;
            width: 38mm;
            margin: 8px auto 10px;
          }

          .cliente {
            font-size: 17px;
            font-weight: 700;
            margin: 0 0 2px;
          }
          .fecha {
            font-size: 12px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            color: #6b7280;
            margin: 0 0 10px;
          }

          .qr { margin-top: 6px; }
          .qr img { width: 30mm; height: 30mm; }

          .cut { page-break-after: always; }
        </style>
      </head>
      <body>
        <div class="wrap">
          ${prefix ? `<div class="prefix">${prefix}</div>` : ''}
          <div class="num">${bigNum}</div>
          <hr class="rule" />
          <div class="cliente">${clientName}</div>
          ${fechaEntrega ? `<div class="fecha">Entrega · ${fechaEntrega}</div>` : ''}
          <div class="qr"><img src="${qrCodeDataUrl}" alt="QR pedido" /></div>
        </div>
        <div class="cut"></div>
      </body>
    </html>
  `;

    try {
        await sendToPrinter(getTicketPrinterName(), buildRawHtml(html));
    } catch (e) {
        console.warn('QZ Tray falló al imprimir etiqueta interna, recayendo a window.print()', e);
        const w = window.open('', 'print_internal_label_fallback');
        w.document.write(html);
        w.document.close();
        w.focus();
        setTimeout(() => { w.print(); w.close(); }, 300);
    }
}

// Helper centralizado: imprime la etiqueta de "finalizado" (recogida) de un
// pedido que acaba de pasar a listo. Respeta el ajuste onReady. Carga el pedido
// completo por su id y devuelve ese pedido (o null si no se imprimió), para que
// quien lo llame pueda notificar al usuario.
// ¿Puede imprimir este dispositivo?
//
// No basta con el ajuste: si la tablet pierde el localStorage (datos del
// navegador borrados, dispositivo nuevo, modo incógnito) volvería al valor por
// defecto y creería que tiene impresora. Entonces intentaría imprimir contra un
// QZ Tray que no existe y la etiqueta se perdería sin llegar a la cola.
//
// Por eso se comprueba de verdad si hay QZ Tray escuchando. El resultado se
// recuerda un minuto para no penalizar cada impresión.
let impresoraDetectada = null;
let impresoraComprobadaEn = 0;
const CADUCIDAD_DETECCION_MS = 60_000;

export async function puedeImprimirAqui() {
    // Desactivado a mano: no se comprueba nada, va a la cola.
    if (getPrintSettings().tieneImpresora === false) return false;

    const ahora = Date.now();
    if (impresoraDetectada !== null && (ahora - impresoraComprobadaEn) < CADUCIDAD_DETECCION_MS) {
        return impresoraDetectada;
    }
    try {
        await connectQZSecure(1, 400);   // un intento rápido, no los 8 habituales
        impresoraDetectada = true;
    } catch {
        impresoraDetectada = false;
    }
    impresoraComprobadaEn = ahora;
    return impresoraDetectada;
}

export async function printFinishedLabelForOrder(token, orderId) {
    if (!orderId || !getPrintSettings().onReady) return null;

    // Dispositivo sin impresora (la tablet del taller): no imprime, deja el
    // encargo para el puesto que sí la tiene. Ver sql/010 y PrintQueueWatcher.
    if (!await puedeImprimirAqui()) {
        try {
            const order = await fetchOrder(token, orderId);
            await encolarImpresion(token, { type: 'finished_label', orderId });
            return order;
        } catch (e) {
            console.warn('No se pudo encolar la etiqueta de finalizado:', e);
            return null;
        }
    }

    try {
        const order = await fetchOrder(token, orderId);
        await printInternalLabel(order, { token });
        return order;
    } catch (e) {
        console.warn('No se pudo imprimir la etiqueta de finalizado:', e);
        return null;
    }
}

// Etiqueta "Finalizado" POR PRENDA: se imprime cuando una prenda concreta
// completa todos sus pasos de tracking, sin esperar a que el resto del pedido
// termine. Se imprime en la impresora de tickets (papel normal), igual que la
// etiqueta de recogida.
export async function printGarmentLabel({ orderNum, clientName, productName, quantity = 1, fechaLimite = '' }) {
    const fechaEntrega = fechaLimite
        ? new Date(fechaLimite).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '';

    // Separar prefijo (TPV/2025) y nº secuencial (0095) para destacar el número.
    const numParts = String(orderNum || '').split('/');
    const bigNum = numParts.length > 1 ? numParts.pop() : (orderNum || '');
    const prefix = numParts.join('/');
    const qty = quantity > 1 ? `${quantity}× ` : '';

    const html = `
    <html>
      <head>
        <meta charset="utf-8"/>
        <style>
          * { box-sizing: border-box; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; width: 80mm; color: #111; -webkit-font-smoothing: antialiased; }
          .wrap { padding: 5mm 6mm 9mm; text-align: center; }
          .done { font-size: 14px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #15803d; margin: 0 0 4px; }
          .prefix { font-size: 12px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; color: #6b7280; margin: 0; }
          .num { font-size: 56px; font-weight: 800; line-height: 1; letter-spacing: 1px; margin: 0; white-space: nowrap; }
          .rule { border: none; border-top: 1.5px solid #111; width: 38mm; margin: 8px auto 10px; }
          .prenda { font-size: 18px; font-weight: 800; margin: 0 0 2px; }
          .cliente { font-size: 15px; font-weight: 700; margin: 0 0 2px; }
          .fecha { font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase; color: #6b7280; margin: 0; }
          .cut { page-break-after: always; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="done">✓ Finalizado</div>
          ${prefix ? `<div class="prefix">${prefix}</div>` : ''}
          <div class="num">${bigNum}</div>
          <hr class="rule" />
          <div class="prenda">${qty}${productName || 'Prenda'}</div>
          ${clientName ? `<div class="cliente">${clientName}</div>` : ''}
          ${fechaEntrega ? `<div class="fecha">Entrega · ${fechaEntrega}</div>` : ''}
        </div>
        <div class="cut"></div>
      </body>
    </html>
  `;

    try {
        await sendToPrinter(getTicketPrinterName(), buildRawHtml(html));
    } catch (e) {
        console.warn('QZ Tray falló al imprimir etiqueta de prenda, recayendo a window.print()', e);
        const w = window.open('', 'print_garment_label_fallback');
        w.document.write(html);
        w.document.close();
        w.focus();
        setTimeout(() => { w.print(); w.close(); }, 300);
    }
}

// Helper gated por el ajuste onGarmentReady. Imprime la etiqueta de una prenda
// finalizada. Devuelve true si se imprimió, false si está desactivado o falló.
export async function printGarmentFinishedLabel(garment, token = null) {
    if (!getPrintSettings().onGarmentReady) return false;

    // Sin impresora en este dispositivo: a la cola (ver printFinishedLabelForOrder).
    if (!await puedeImprimirAqui()) {
        if (!token) {
            console.warn('No se puede encolar la etiqueta de prenda: falta el token');
            return false;
        }
        try {
            await encolarImpresion(token, { type: 'garment_label', payload: garment });
            return true;
        } catch (e) {
            console.warn('No se pudo encolar la etiqueta de prenda finalizada:', e);
            return false;
        }
    }

    try {
        await printGarmentLabel(garment);
        return true;
    } catch (e) {
        console.warn('No se pudo imprimir la etiqueta de prenda finalizada:', e);
        return false;
    }
}


