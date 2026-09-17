// Carga de trabajo diaria: cada producto pesa `workloadWeight` "camisas
// equivalentes" (camisa = 1, traje ≈ 2,5, servilleta = 0,12...). La suma de
// las líneas con fecha de entrega en un día es la carga de ese día, y a partir
// de `daily_load_max` (AppSettings) el calendario del TPV lo da por lleno.
// Ver sql/025 para la calibración inicial con el histórico.
//
// Entregas adelantadas: la fecha sugerida es el primer día abierto, a 2+ días
// vista, que no esté lleno. Si el pedido se entrega antes de esa fecha, se
// cobra un suplemento de urgencia (`urgency_surcharge_pct`, AppSettings) sobre
// las líneas que computan en la carga, como una línea más del pedido con el
// producto de SKU `SUPL-URGENCIA` (sql/026).

import { getWorkCalendar, ymd, addDays } from './workCalendar.js';

export const CARGA_MAX_POR_DEFECTO = 45;
export const SUPLEMENTO_URGENCIA_POR_DEFECTO = 25; // %
export const SKU_SUPLEMENTO_URGENCIA = 'SUPL-URGENCIA';
const CLAVE_CARGA_MAX = 'daily_load_max';
const CLAVE_SUPLEMENTO = 'urgency_surcharge_pct';

// Margen mínimo y horizonte de búsqueda de la fecha sugerida, en días.
export const MARGEN_MINIMO_DIAS = 2;
const HORIZONTE_DIAS = 42;

async function leerAjuste(prisma, clave, porDefecto, { minimo = 0 } = {}) {
    let fila = null;
    try {
        fila = await prisma.appSettings.findUnique({ where: { key: clave } });
    } catch (e) {
        // Sin tabla AppSettings (sql/025 aún no aplicado) el TPV sigue funcionando con los valores por defecto.
        console.error(`No se pudo leer ${clave}, se usa el valor por defecto:`, e.message);
    }
    const n = parseFloat(fila?.value);
    return Number.isFinite(n) && n >= minimo ? n : porDefecto;
}

async function guardarAjuste(prisma, clave, valor) {
    await prisma.appSettings.upsert({
        where: { key: clave },
        update: { value: String(valor) },
        create: { key: clave, value: String(valor) },
    });
    return valor;
}

export async function leerCargaMaxima(prisma) {
    return leerAjuste(prisma, CLAVE_CARGA_MAX, CARGA_MAX_POR_DEFECTO, { minimo: 1 });
}

export async function guardarCargaMaxima(prisma, valor) {
    return guardarAjuste(prisma, CLAVE_CARGA_MAX, Math.max(1, parseFloat(valor) || CARGA_MAX_POR_DEFECTO));
}

/** Porcentaje del suplemento por adelantar la entrega (0 = desactivado). */
export async function leerSuplementoUrgencia(prisma) {
    return leerAjuste(prisma, CLAVE_SUPLEMENTO, SUPLEMENTO_URGENCIA_POR_DEFECTO);
}

export async function guardarSuplementoUrgencia(prisma, valor) {
    const n = parseFloat(valor);
    return guardarAjuste(prisma, CLAVE_SUPLEMENTO, Number.isFinite(n) ? Math.min(500, Math.max(0, n)) : SUPLEMENTO_URGENCIA_POR_DEFECTO);
}

// Carga ponderada de un pedido: ignora productos que no computan.
export function cargaPonderada(lines) {
    return (lines || []).reduce((s, l) => {
        const p = l.product || {};
        if (p.countsForLoad === false) return s;
        const w = (p.workloadWeight != null) ? Number(p.workloadWeight) : 1;
        return s + (l.quantity || 0) * w;
    }, 0);
}

/**
 * Fecha sugerida a partir de un calendario y una función de carga por día:
 * primer día abierto, a MARGEN_MINIMO_DIAS+ vista, con carga < loadMax.
 * Si todos están llenos, el primer día abierto.
 */
export function sugerirFecha({ calendar, dayLoad, todayStr, loadMax }) {
    const desde = addDays(todayStr, MARGEN_MINIMO_DIAS);
    const hasta = addDays(todayStr, HORIZONTE_DIAS);
    let firstOpen = null;
    for (let k = desde; k <= hasta; k = addDays(k, 1)) {
        if (!calendar[k]?.isWorking) continue;
        firstOpen ||= k;
        if (dayLoad(k) < loadMax) return k;
    }
    return firstOpen;
}

/** Pedidos vivos con fecha de entrega en [from, to], agrupados por día 'YYYY-MM-DD'. */
export async function pedidosPorDia(prisma, from, to) {
    const orders = await prisma.order.findMany({
        where: {
            fechaLimite: {
                gte: new Date(`${from}T00:00:00.000Z`),
                lte: new Date(`${to}T00:00:00.000Z`),
            },
            status: { notIn: ['cancelled'] },
        },
        include: {
            lines: { include: { product: true } },
            client: { select: { id: true, firstName: true, lastName: true } },
        },
    });
    const byDay = {};
    orders.forEach(o => {
        const k = o.fechaLimite.toISOString().slice(0, 10);
        (byDay[k] ||= []).push(o);
    });
    return byDay;
}

/** Fecha sugerida hoy, calculada desde cero (para validar un pedido al crearlo). */
export async function calcularFechaSugerida(prisma) {
    const todayStr = ymd(new Date());
    const from = addDays(todayStr, MARGEN_MINIMO_DIAS);
    const to = addDays(todayStr, HORIZONTE_DIAS);
    const [calendar, byDay, loadMax] = await Promise.all([
        getWorkCalendar(prisma, from, to),
        pedidosPorDia(prisma, from, to),
        leerCargaMaxima(prisma),
    ]);
    const dayLoad = (k) => (byDay[k] || []).reduce((s, o) => s + cargaPonderada(o.lines), 0);
    return sugerirFecha({ calendar, dayLoad, todayStr, loadMax });
}

/** Producto con el que se factura el suplemento de urgencia, o null si no está creado (sql/026). */
export async function productoSuplementoUrgencia(prisma) {
    try {
        return await prisma.product.findUnique({ where: { sku: SKU_SUPLEMENTO_URGENCIA } });
    } catch (e) {
        console.error('No se pudo buscar el producto del suplemento de urgencia:', e.message);
        return null;
    }
}

/**
 * Importe del suplemento de urgencia para un conjunto de líneas ya calculadas
 * ({productId, totalPrice}). Sólo cuentan las líneas de productos que computan
 * en la carga: lo que va a un servicio externo no se puede acelerar.
 */
export async function importeSuplementoUrgencia(prisma, lineas, pct) {
    if (!(pct > 0) || !lineas.length) return 0;
    const ids = [...new Set(lineas.map(l => Number(l.productId)))];
    const productos = await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, countsForLoad: true },
    });
    const computa = new Set(productos.filter(p => p.countsForLoad !== false).map(p => p.id));
    const base = lineas.reduce((s, l) => s + (computa.has(Number(l.productId)) ? Number(l.totalPrice) || 0 : 0), 0);
    return +(base * pct / 100).toFixed(2);
}

/**
 * Cómo han sido los días laborables del último año con los pesos actuales:
 * percentiles de la carga por fecha de entrega. Sirve para calibrar el tope
 * diario ("un día al 90 % del histórico es un día lleno").
 */
export async function estadisticaCargaHistorica(prisma, meses = 12) {
    const filas = await prisma.$queryRaw`
        WITH dias AS (
            SELECT (o."fechaLimite" AT TIME ZONE 'Europe/Madrid')::date AS dia,
                   SUM(l.quantity * CASE WHEN p.counts_for_load THEN p.workload_weight ELSE 0 END) AS carga
            FROM "OrderLine" l
            JOIN "Order" o ON o.id = l."orderId"
            JOIN "Product" p ON p.id = l."productId"
            WHERE o."fechaLimite" >= now() - (${meses} || ' months')::interval
              AND o."fechaLimite" < now()
              AND o.status <> 'cancelled' AND l."voidedAt" IS NULL
            GROUP BY 1
        ), laborables AS (
            SELECT d.* FROM dias d
            WHERE EXTRACT(dow FROM d.dia) BETWEEN 1 AND 5
              AND NOT EXISTS (SELECT 1 FROM work_schedule_exceptions e WHERE e.date = d.dia AND NOT e.is_working)
        )
        SELECT COUNT(*)::int AS dias,
               percentile_cont(0.5)  WITHIN GROUP (ORDER BY carga) AS p50,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY carga) AS p75,
               percentile_cont(0.9)  WITHIN GROUP (ORDER BY carga) AS p90,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY carga) AS p95,
               MAX(carga) AS max
        FROM laborables`;
    const f = filas[0] || {};
    const num = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);
    return { meses, dias: f.dias || 0, p50: num(f.p50), p75: num(f.p75), p90: num(f.p90), p95: num(f.p95), max: num(f.max) };
}
