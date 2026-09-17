// Carga de trabajo diaria: cada producto pesa `workloadWeight` "camisas
// equivalentes" (camisa = 1, traje ≈ 2,5, servilleta = 0,12...). La suma de
// las líneas con fecha de entrega en un día es la carga de ese día, y a partir
// de `daily_load_max` (AppSettings) el calendario del TPV lo da por lleno.
// Ver sql/025 para la calibración inicial con el histórico.
//
// Entregas adelantadas: la fecha sugerida es el primer día abierto, a 2+ días
// vista, que no esté lleno. Si el pedido se entrega antes de esa fecha, se
// cobra un suplemento de urgencia por tramos: un % por cada día laborable que
// se adelanta (`urgency_pct_per_day`, AppSettings) hasta un tope
// (`urgency_pct_max`), sobre las líneas que computan en la carga, como una
// línea más del pedido con el producto de SKU `SUPL-URGENCIA` (sql/027).

import { getWorkCalendar, ymd, addDays } from './workCalendar.js';

export const CARGA_MAX_POR_DEFECTO = 45;
export const URGENCIA_PCT_POR_DIA_DEFECTO = 10; // % por día laborable adelantado
export const URGENCIA_PCT_MAX_DEFECTO = 40;     // tope
export const SKU_SUPLEMENTO_URGENCIA = 'SUPL-URGENCIA';
const CLAVE_CARGA_MAX = 'daily_load_max';
const CLAVE_URGENCIA_POR_DIA = 'urgency_pct_per_day';
const CLAVE_URGENCIA_MAX = 'urgency_pct_max';

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

/**
 * Tramos del suplemento por adelantar la entrega.
 * @returns {Promise<{pctPorDia: number, pctMax: number}>} (pctPorDia = 0 desactiva el recargo)
 */
export async function leerSuplementoUrgencia(prisma) {
    const [pctPorDia, pctMax] = await Promise.all([
        leerAjuste(prisma, CLAVE_URGENCIA_POR_DIA, URGENCIA_PCT_POR_DIA_DEFECTO),
        leerAjuste(prisma, CLAVE_URGENCIA_MAX, URGENCIA_PCT_MAX_DEFECTO),
    ]);
    return { pctPorDia, pctMax };
}

export async function guardarSuplementoUrgencia(prisma, { pctPorDia, pctMax } = {}) {
    const acotar = (v) => Math.min(500, Math.max(0, v));
    const d = parseFloat(pctPorDia);
    const m = parseFloat(pctMax);
    if (Number.isFinite(d)) await guardarAjuste(prisma, CLAVE_URGENCIA_POR_DIA, acotar(d));
    if (Number.isFinite(m)) await guardarAjuste(prisma, CLAVE_URGENCIA_MAX, acotar(m));
    return leerSuplementoUrgencia(prisma);
}

/** % de suplemento que corresponde a adelantar `dias` días laborables. */
export function porcentajeUrgencia(dias, { pctPorDia, pctMax }) {
    if (!(dias > 0) || !(pctPorDia > 0)) return 0;
    const pct = pctPorDia * dias;
    return pctMax > 0 ? Math.min(pct, pctMax) : pct;
}

/** Días laborables que se adelanta una entrega: abiertos en (elegida, sugerida]. */
export function diasLaborablesAdelantados(calendar, elegida, sugerida) {
    if (!elegida || !sugerida || elegida >= sugerida) return 0;
    let n = 0;
    for (let k = addDays(elegida, 1); k <= sugerida; k = addDays(k, 1)) {
        // Un día que no está en el calendario se cuenta si es de lunes a viernes.
        const c = calendar[k];
        const laborable = c ? !!c.isWorking : [1, 2, 3, 4, 5].includes(new Date(`${k}T12:00:00Z`).getUTCDay());
        if (laborable) n++;
    }
    return n;
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
 * Reservas de carga para grandes clientes con días fijos de entrega (sql/028).
 * Su pedido no existe hasta que se recoge (el lunes para entregar el
 * miércoles), pero el calendario ya debe contar esa carga para no llenar el
 * miércoles de particulares. `expectedLoad` es la carga SEMANAL habitual del
 * cliente; se reparte a partes iguales entre sus `deliveryDays` (si pasa de
 * dos entregas a una, la semana no cambia), y la reserva de cada día se
 * consume con sus pedidos reales de ese día:
 *   reservada = máx(0, expectedLoad / nº días de entrega − carga real del cliente ese día)
 * @returns {Promise<Object<string, {reservada: number, clientes: Array<{id:number, nombre:string, reservada:number}>}>>}
 */
export async function reservasPorDia(prisma, calendar, byDay) {
    let clientes = [];
    try {
        clientes = await prisma.user.findMany({
            where: { isbigclient: true, isActive: true, expectedLoad: { gt: 0 } },
            select: { id: true, firstName: true, lastName: true, denominacionsocial: true, deliveryDays: true, expectedLoad: true },
        });
    } catch (e) {
        // Sin las columnas de sql/028 no hay reservas; el calendario sigue funcionando.
        console.error('No se pudieron leer los días de entrega de los grandes clientes:', e.message);
        return {};
    }
    clientes = clientes.filter(c => Array.isArray(c.deliveryDays) && c.deliveryDays.length > 0);
    const reservas = {};
    if (!clientes.length) return reservas;

    for (const k of Object.keys(calendar)) {
        if (!calendar[k]?.isWorking) continue;
        const dow = new Date(`${k}T12:00:00Z`).getUTCDay();
        const delDia = clientes.filter(c => c.deliveryDays.includes(dow));
        if (!delDia.length) continue;
        const realPorCliente = {};
        for (const o of byDay[k] || []) {
            if (o.client?.id) realPorCliente[o.client.id] = (realPorCliente[o.client.id] || 0) + cargaPonderada(o.lines);
        }
        const detalle = delDia
            .map(c => ({
                id: c.id,
                nombre: c.denominacionsocial || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
                reservada: Math.max(0, Number(c.expectedLoad) / c.deliveryDays.length - (realPorCliente[c.id] || 0)),
            }))
            .filter(c => c.reservada > 0);
        if (detalle.length) {
            reservas[k] = { reservada: detalle.reduce((s, c) => s + c.reservada, 0), clientes: detalle };
        }
    }
    return reservas;
}

/**
 * Carga de un día: los pedidos reales más lo que aún queda reservado para
 * los grandes clientes con entrega ese día.
 * @returns {{real: number, reservada: number, total: number, clientes: Array}}
 */
export function cargaDelDia(byDay, reservas, k) {
    const real = (byDay[k] || []).reduce((s, o) => s + cargaPonderada(o.lines), 0);
    const r = reservas?.[k];
    const reservada = r?.reservada || 0;
    return { real, reservada, total: real + reservada, clientes: r?.clientes || [] };
}

/** Tope de carga de un día: el propio de la excepción (víspera de festivo) o el general. */
export function topeDelDia(calendar, k, loadMax) {
    const propio = calendar?.[k]?.loadMax;
    return propio != null && propio > 0 ? propio : loadMax;
}

/**
 * Fecha sugerida a partir de un calendario y una función de carga por día:
 * primer día abierto, con MARGEN_MINIMO_DIAS días laborables de margen (un
 * festivo o un fin de semana por medio no cuentan como tiempo de taller),
 * cuya carga no llegue a su tope. Si todos están llenos, el primer día abierto.
 */
export function sugerirFecha({ calendar, dayLoad, todayStr, loadMax }) {
    const hasta = addDays(todayStr, HORIZONTE_DIAS);
    let laborables = 0;
    let firstOpen = null;
    for (let k = addDays(todayStr, 1); k <= hasta; k = addDays(k, 1)) {
        if (!calendar[k]?.isWorking) continue;
        laborables++;
        if (laborables < MARGEN_MINIMO_DIAS) continue;
        firstOpen ||= k;
        if (dayLoad(k) < topeDelDia(calendar, k, loadMax)) return k;
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
            client: { select: { id: true, firstName: true, lastName: true, isbigclient: true } },
        },
    });
    const byDay = {};
    orders.forEach(o => {
        const k = o.fechaLimite.toISOString().slice(0, 10);
        (byDay[k] ||= []).push(o);
    });
    return byDay;
}

/**
 * Fecha sugerida hoy, calculada desde cero (para validar un pedido al crearlo).
 * Devuelve también el calendario (desde hoy) para contar los días que se adelanta.
 * @returns {Promise<{sugerida: string|null, calendar: Object}>}
 */
export async function calcularFechaSugerida(prisma) {
    const todayStr = ymd(new Date());
    const from = addDays(todayStr, MARGEN_MINIMO_DIAS);
    const to = addDays(todayStr, HORIZONTE_DIAS);
    const [calendar, byDay, loadMax] = await Promise.all([
        getWorkCalendar(prisma, todayStr, to),
        pedidosPorDia(prisma, from, to),
        leerCargaMaxima(prisma),
    ]);
    const reservas = await reservasPorDia(prisma, calendar, byDay);
    const dayLoad = (k) => cargaDelDia(byDay, reservas, k).total;
    return { sugerida: sugerirFecha({ calendar, dayLoad, todayStr, loadMax }), calendar };
}

/** Producto con el que se factura el suplemento de urgencia, o null si no está creado (sql/027). */
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
