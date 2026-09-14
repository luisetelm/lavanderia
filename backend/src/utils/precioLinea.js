// Precio de una línea de pedido.
//
// Única regla de precios del backend. La usan la creación de pedidos
// (POST /api/orders) y los ajustes de pedidos ya cobrados
// (POST /api/orders/:id/adjustments), para que ambos cobren exactamente igual.
// El carrito del TPV la replica sólo para enseñar el importe antes de validar
// (frontend DraftOrderContext.getPriceForItem); el importe que vale es éste.
//
// Precio unitario, por orden de prioridad:
//   1. Precio pactado vigente del cliente para ese producto (sql/022).
//   2. Tarifa de gran cliente, si el cliente está marcado y el producto la tiene.
//   3. Precio normal del producto.
// Después se suma el modificador de la variante, si la hay.
//
// El descuento en porcentaje del cliente NO se aplica sobre un precio pactado:
// el pactado ya es el precio acordado y aplicarlo descontaría dos veces.

import {ymd} from './workCalendar.js';

/** Hoy, 'YYYY-MM-DD' en hora local del servidor (mismo criterio que el calendario laboral) */
export function hoy() {
    return ymd(new Date());
}

/** 'YYYY-MM-DD' -> Date para comparar o guardar en columnas DATE */
export function fechaDb(s) {
    return new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`);
}

/** Date leída de una columna DATE -> 'YYYY-MM-DD' (null si no hay) */
export function fechaTexto(d) {
    return d ? new Date(d).toISOString().slice(0, 10) : null;
}

// Float, Decimal de Prisma o null -> número
const aNumero = (v) => (v == null ? 0 : Number(String(v)));

/**
 * Precios pactados vigentes de un cliente en una fecha.
 * @returns {Promise<Map<number, object>>} productId -> fila de client_product_price
 */
export async function preciosPactadosVigentes(prisma, clientId, fecha = hoy()) {
    const pactados = new Map();
    if (!clientId) return pactados;

    const d = fechaDb(fecha);
    let filas;
    try {
        filas = await prisma.clientProductPrice.findMany({
            where: {
                clientId: Number(clientId),
                validFrom: {lte: d},
                OR: [{validTo: null}, {validTo: {gte: d}}],
            },
            orderBy: [{validFrom: 'desc'}, {id: 'desc'}],
        });
    } catch (e) {
        // P2021: la tabla no existe porque se desplegó el código antes que
        // sql/022. Mejor cobrar con la tarifa de siempre que bloquear el TPV.
        if (e?.code === 'P2021') {
            console.error('[precios pactados] Falta la tabla client_product_price: ejecutar sql/022_precios_pactados.sql');
            return pactados;
        }
        throw e;
    }

    // La API impide solapes; si aun así hubiera dos, gana el que empezó después.
    for (const f of filas) {
        if (!pactados.has(f.productId)) pactados.set(f.productId, f);
    }
    return pactados;
}

/**
 * Precio unitario de un producto para un cliente, sin variante ni descuento.
 * @returns {{unitPrice: number, origen: 'pactado'|'gran_cliente'|'base', pactadoId?: number}}
 */
export function precioUnitario(product, client, pactados) {
    const pactado = pactados?.get(product.id);
    if (pactado) {
        return {unitPrice: aNumero(pactado.price), origen: 'pactado', pactadoId: pactado.id};
    }
    const granCliente = aNumero(product.bigClientPrice);
    if (client?.isbigclient && granCliente > 0) {
        return {unitPrice: granCliente, origen: 'gran_cliente'};
    }
    return {unitPrice: aNumero(product.basePrice), origen: 'base'};
}

/** Descuento en porcentaje del cliente, acotado a 0-100 */
export function descuentoCliente(client) {
    const d = client?.discount ? Number(client.discount) : 0;
    return (!isNaN(d) && d > 0) ? Math.min(100, Math.max(0, d)) : 0;
}

/**
 * Calcula una línea de pedido.
 * @param opciones.pactados  precios pactados ya cargados (para no repetir la consulta por línea)
 * @param opciones.redondear redondear totalPrice a céntimos (los ajustes sí; la creación de pedidos
 *                           guarda el importe sin redondear, como ha hecho siempre)
 */
export async function calcularLinea(prisma, {productId, variantId, quantity}, client, {pactados = null, redondear = true} = {}) {
    const product = await prisma.product.findUnique({where: {id: Number(productId)}});
    if (!product) {
        const e = new Error(`Producto inválido: ${productId}`);
        e.statusCode = 400;
        throw e;
    }

    if (!pactados) pactados = await preciosPactadosVigentes(prisma, client?.id);
    const precio = precioUnitario(product, client, pactados);
    let unitPrice = precio.unitPrice;

    if (variantId) {
        const variant = await prisma.productVariant.findUnique({where: {id: Number(variantId)}});
        if (variant) unitPrice += variant.priceModifier;
    }

    const qty = Number(quantity) || 1;
    if (qty <= 0) {
        const e = new Error('La cantidad debe ser mayor que cero.');
        e.statusCode = 400;
        throw e;
    }

    const discountPct = precio.origen === 'pactado' ? 0 : descuentoCliente(client);
    const subtotal = unitPrice * qty;
    const total = discountPct > 0 ? subtotal * (1 - discountPct / 100) : subtotal;

    return {
        productId: Number(productId),
        variantId: variantId ? Number(variantId) : null,
        quantity: qty,
        unitPrice,
        discount: discountPct,
        totalPrice: redondear ? +total.toFixed(2) : total,
        productName: product.name,
        origenPrecio: precio.origen,
    };
}
