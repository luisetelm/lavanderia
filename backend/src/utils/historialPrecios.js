// Historial de cambios de precio de los productos (sql/025).
//
// Se registra desde todos los sitios que escriben precios: alta y edición de un
// producto (routes/products.js), cambio de precios en bloque y importación CSV
// (routes/products_import.js).
//
// El registro va después de guardar el precio y nunca lo impide: si la tabla
// aún no existe (backend desplegado antes que sql/025) o la escritura falla, se
// avisa en el log y el precio queda guardado igualmente.

import { ymd } from './workCalendar.js';

const aNumero = (v) => (v == null ? null : Number(String(v)));

/**
 * @param cambios [{productId, campo: 'basePrice'|'bigClientPrice', antes, despues}]
 *                antes = null para el alta. Los que no cambian se descartan.
 * @returns nº de cambios registrados
 */
export async function registrarCambiosPrecio(prisma, cambios, { origen, nota = null, userId = null, log = console } = {}) {
    const filas = cambios
        .map((c) => ({ productId: c.productId, field: c.campo, oldPrice: aNumero(c.antes), newPrice: aNumero(c.despues) }))
        .filter((c) => c.newPrice !== null && c.oldPrice !== c.newPrice)
        .map((c) => ({ ...c, source: origen, note: nota, changedBy: userId || null }));
    if (!filas.length) return 0;
    try {
        const r = await prisma.productPriceHistory.createMany({ data: filas });
        return r.count;
    } catch (e) {
        log.warn({ err: e, code: e?.code }, 'No se ha podido registrar el cambio de precio en el historial (¿falta sql/025?)');
        return 0;
    }
}

/**
 * Cambios de precio de un producto, los más recientes primero. desde/hasta
 * (Date, hasta exclusivo) acotan por fecha. Devuelve null si la tabla no existe.
 */
export async function historialPrecios(prisma, productId, { desde, hasta } = {}) {
    const changedAt = {};
    if (desde) changedAt.gte = desde;
    if (hasta) changedAt.lt = hasta;
    let filas;
    try {
        filas = await prisma.productPriceHistory.findMany({
            where: { productId, ...(desde || hasta ? { changedAt } : {}) },
            orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
            include: { user: { select: { firstName: true, lastName: true } } },
        });
    } catch (e) {
        if (e?.code === 'P2021') return null;
        throw e;
    }
    return filas.map((f) => ({
        id: f.id,
        fecha: f.changedAt,
        dia: ymd(new Date(f.changedAt)),
        campo: f.field,
        antes: f.oldPrice,
        despues: f.newPrice,
        origen: f.source,
        nota: f.note,
        usuario: f.user ? `${f.user.firstName || ''} ${f.user.lastName || ''}`.replace(/\s+/g, ' ').trim() || null : null,
    }));
}
