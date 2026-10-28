// Presupuesto de un pedido: líneas valoradas, fecha límite y suplemento de
// urgencia, sin guardar nada.
//
// Es el mismo cálculo que hace POST /api/orders al crear el pedido; el alta lo
// usa tal cual y POST /api/orders/quote lo devuelve sin crear nada (lo usa el
// conector MCP para enseñar el importe antes de confirmar).
//
// Lanza errores con `statusCode` (400) y un mensaje en castellano, para que la
// ruta los devuelva al cliente sin más.

import {calcularLinea, preciosPactadosVigentes} from './precioLinea.js';
import {getDayInfo, nextWorkingDay, ymd, addDays} from './workCalendar.js';
import {
    calcularFechaSugerida, cargaDeLineas, leerSuplementoUrgencia, productoSuplementoUrgencia,
    esFueraDeCatalogo, cargaPorPrecio,
    importeSuplementoUrgencia, diasLaborablesAdelantados, porcentajeUrgencia,
} from './cargaTrabajo.js';

const error400 = (message) => Object.assign(new Error(message), {statusCode: 400});

/**
 * @param {object} prisma
 * @param {object} opts
 * @param {object|null} opts.client   Usuario cliente (puede ser null: precios públicos)
 * @param {Array} opts.lines          [{productId, variantId?, quantity}]
 * @param {string|null} opts.fechaLimiteRaw  'YYYY-MM-DD' o null (se propone una)
 * @param {boolean} opts.sinSuplemento  true exime del suplemento de urgencia
 * @returns {Promise<{lineCreates: Array, lineas: Array, total: number, fechaLimite: Date, fechaLimiteElegida: boolean, suplementoUrgencia: object|null}>}
 */
export async function calcularPresupuesto(prisma, {client, lines, fechaLimiteRaw, sinSuplemento}) {
    if (!lines || !Array.isArray(lines) || lines.length === 0) {
        throw error400('Debe haber al menos una línea en el pedido');
    }

    // Precio de cada línea con la regla única de utils/precioLinea.js:
    // precio pactado del cliente > tarifa de gran cliente > precio normal,
    // y el descuento del cliente sólo sobre lo que no está pactado.
    // Los pactados se cargan una sola vez para todo el pedido.
    const pactados = await preciosPactadosVigentes(prisma, client?.id);

    let total = 0;
    const lineCreates = [];
    const lineas = [];
    for (const l of lines) {
        // Sin redondear el total de línea, como se ha guardado siempre.
        const calculada = await calcularLinea(
            prisma,
            {productId: l.productId, variantId: l.variantId, quantity: l.quantity},
            client,
            {pactados, redondear: false},
        );
        let {unitPrice, discount: discountPct, totalPrice, origenPrecio} = calculada;
        const {quantity, productName, sku} = calculada;

        // Prenda fuera de catálogo: nombre y precio los pone quien pica el pedido
        // sobre un producto genérico (sql/035); su carga sale del precio.
        const fueraCatalogo = esFueraDeCatalogo(sku);
        const customName = fueraCatalogo ? String(l.nombreLibre || '').trim().slice(0, 120) : null;
        if (fueraCatalogo && !customName) throw error400('Falta el nombre de la prenda fuera de catálogo.');

        // Precio ajustado: cualquiera que pique pedidos puede cambiar el precio de
        // una prenda (un traje muy sucio), siempre con motivo. Es el precio final
        // de la línea: el descuento del cliente no se aplica encima.
        let priceOriginal = null;
        let priceNote = null;
        const hayPrecioManual = l.precioManual !== undefined && l.precioManual !== null && l.precioManual !== '';
        if (fueraCatalogo && !hayPrecioManual) throw error400(`Falta el precio de «${customName}».`);
        if (hayPrecioManual) {
            const precio = Number(l.precioManual);
            if (!Number.isFinite(precio) || precio < 0 || precio > 10000) {
                throw error400(`El precio de «${customName || productName}» no es válido.`);
            }
            priceNote = String(l.motivoPrecio || '').trim().slice(0, 200) || null;
            if (!fueraCatalogo && !priceNote) {
                throw error400(`Indica el motivo del cambio de precio de «${productName}».`);
            }
            if (!fueraCatalogo) priceOriginal = unitPrice;
            unitPrice = Math.round(precio * 100) / 100;
            discountPct = 0;
            totalPrice = unitPrice * quantity;
            origenPrecio = 'manual';
        }

        total += totalPrice;
        lineCreates.push({
            productId: l.productId,
            variantId: l.variantId || null,
            quantity,
            unitPrice,
            discount: discountPct,
            totalPrice,
            color: l.color || null,
            customName,
            priceOriginal,
            priceNote,
            workloadWeight: fueraCatalogo ? cargaPorPrecio(unitPrice, sku) : null,
        });
        lineas.push({
            productId: Number(l.productId),
            variantId: l.variantId || null,
            productName: customName || productName,
            quantity,
            unitPrice,
            discount: discountPct,
            totalPrice,
            origenPrecio,
            ...(priceOriginal != null ? {precioTarifa: priceOriginal} : {}),
            ...(priceNote ? {motivoPrecio: priceNote} : {}),
        });
    }

    // Fecha límite: si viene, se parsea; si no, se propone (una semana vista
    // saltando a un día abierto según horario y festivos).
    const defaultFechaLimite = async () => {
        const target = await nextWorkingDay(prisma, addDays(ymd(new Date()), 7));
        return new Date(`${target}T00:00:00.000Z`);
    };
    const fechaLimite = fechaLimiteRaw ? new Date(fechaLimiteRaw) : await defaultFechaLimite();
    if (Number.isNaN(fechaLimite.getTime())) {
        throw error400('Fecha límite no válida.');
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (fechaLimite < today) {
        throw error400('La fecha límite no puede ser anterior a hoy.');
    }
    // Rechazar días en que la lavandería está cerrada (festivos / horario semanal)
    if (fechaLimiteRaw) {
        const dayInfo = await getDayInfo(prisma, fechaLimiteRaw);
        if (dayInfo && !dayInfo.isWorking) {
            const motivo = dayInfo.label ? ` (${dayInfo.label})` : '';
            throw error400(`La lavandería está cerrada ese día${motivo}. Elige otra fecha de entrega.`);
        }
    }

    // Entrega adelantada: si la fecha elegida es anterior a la sugerida por
    // el calendario, se añade el suplemento de urgencia como una línea más
    // (% sobre las líneas que computan en la carga). Quien pica el pedido
    // puede eximirlo desde el TPV (sinSuplemento). Los grandes clientes (hoteles,
    // restaurantes) tienen días fijos de recogida y entrega y precios
    // pactados: no eligen fecha por disponibilidad, así que nunca lo pagan.
    let suplementoUrgencia = null;
    const fechaElegida = fechaLimiteRaw ? String(fechaLimiteRaw).slice(0, 10) : null;
    const eximido = client?.isbigclient === true || sinSuplemento === true;
    if (fechaElegida && !eximido) {
        // La sugerida cuenta lo que pesa este pedido: si no cabe en un día, se
        // sugiere otro, y entregarlo antes lleva suplemento (igual que en el TPV).
        const carga = await cargaDeLineas(prisma, lineCreates); // con la carga propia de las prendas fuera de catálogo
        const [{sugerida, calendar}, tramos, producto] = await Promise.all([
            calcularFechaSugerida(prisma, {carga}),
            leerSuplementoUrgencia(prisma),
            productoSuplementoUrgencia(prisma),
        ]);
        // Por tramos: % por cada día laborable adelantado, con tope.
        const dias = diasLaborablesAdelantados(calendar, fechaElegida, sugerida);
        const pct = porcentajeUrgencia(dias, tramos);
        if (pct > 0) {
            if (!producto) {
                console.error('[urgencia] Falta el producto SUPL-URGENCIA: ejecutar sql/027_suplemento_urgencia.sql');
            } else {
                const importe = await importeSuplementoUrgencia(prisma, lineCreates, pct);
                if (importe > 0) {
                    suplementoUrgencia = {fechaSugerida: sugerida, dias, pct, importe};
                    total += importe;
                    lineCreates.push({
                        productId: producto.id,
                        variantId: null,
                        quantity: 1,
                        unitPrice: importe,
                        discount: 0,
                        totalPrice: importe,
                        color: null,
                    });
                    lineas.push({
                        productId: producto.id,
                        variantId: null,
                        productName: producto.name,
                        quantity: 1,
                        unitPrice: importe,
                        discount: 0,
                        totalPrice: importe,
                        origenPrecio: 'urgencia',
                    });
                }
            }
        }
    }

    return {lineCreates, lineas, total, fechaLimite, fechaLimiteElegida: !!fechaLimiteRaw, suplementoUrgencia};
}
