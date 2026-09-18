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

// Hora a la que se da por cerrada la recogida del día de un gran cliente: las
// recogidas y entregas se hacen antes de las 11. El pedido tiene que estar dado
// de alta para entonces; si se registra más tarde, hasta que entre el día se ve
// sin esa carga.
const HORA_LIBERACION_RESERVA = 11;

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

const diaSemana = (k) => new Date(`${k}T12:00:00Z`).getUTCDay();

// Un día que no está en el calendario se cuenta como laborable si es de lunes a viernes.
function esLaborable(calendar, k) {
    const c = calendar[k];
    return c ? !!c.isWorking : [1, 2, 3, 4, 5].includes(diaSemana(k));
}

/** Días laborables que se adelanta una entrega: abiertos en (elegida, sugerida]. */
export function diasLaborablesAdelantados(calendar, elegida, sugerida) {
    if (!elegida || !sugerida || elegida >= sugerida) return 0;
    let n = 0;
    for (let k = addDays(elegida, 1); k <= sugerida; k = addDays(k, 1)) {
        if (esLaborable(calendar, k)) n++;
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
 *
 * La reserva se libera sola: lo que se recoge un día se entrega en la siguiente
 * entrega del cliente que quede a MARGEN_MINIMO_DIAS laborables o más (el
 * tiempo estándar de taller), así que cuando ya ha pasado la última recogida
 * que alimenta una entrega (`ultimaRecogidaDe`), lo que no haya entrado ya no
 * va a entrar y ese día sólo cuenta la carga real. Nadie tiene que marcar nada.
 * @returns {Promise<Object<string, {reservada: number, clientes: Array<{id:number, nombre:string, reservada:number}>, liberadas: Array<{id:number, nombre:string}>}>>}
 */
export async function reservasPorDia(prisma, calendar, byDay, ahora = new Date()) {
    let clientes = [];
    try {
        clientes = await prisma.user.findMany({
            where: { isbigclient: true, isActive: true, expectedLoad: { gt: 0 } },
            select: { id: true, firstName: true, lastName: true, denominacionsocial: true, pickupDays: true, deliveryDays: true, expectedLoad: true },
        });
    } catch (e) {
        // Sin las columnas de sql/028 no hay reservas; el calendario sigue funcionando.
        console.error('No se pudieron leer los días de entrega de los grandes clientes:', e.message);
        return {};
    }
    clientes = clientes.filter(c => Array.isArray(c.deliveryDays) && c.deliveryDays.length > 0);
    const reservas = {};
    if (!clientes.length) return reservas;

    const hoy = ymd(ahora);
    const recogidaCerrada = (dia) => dia < hoy || (dia === hoy && ahora.getHours() >= HORA_LIBERACION_RESERVA);

    for (const k of Object.keys(calendar)) {
        if (!calendar[k]?.isWorking) continue;
        const dow = new Date(`${k}T12:00:00Z`).getUTCDay();
        const delDia = clientes.filter(c => c.deliveryDays.includes(dow));
        if (!delDia.length) continue;
        const realPorCliente = {};
        for (const o of byDay[k] || []) {
            if (o.client?.id) realPorCliente[o.client.id] = (realPorCliente[o.client.id] || 0) + cargaPonderada(o.lines);
        }
        const detalle = [];
        const liberadas = [];
        for (const c of delDia) {
            const nombre = c.denominacionsocial || `${c.firstName || ''} ${c.lastName || ''}`.trim();
            const real = realPorCliente[c.id] || 0;
            const recogida = ultimaRecogidaDe(c, k, calendar);
            if (recogida && recogidaCerrada(recogida)) {
                // Sólo se avisa si el día se queda sin nada suyo: si entregó, su pedido ya ocupa el hueco.
                if (real === 0 && k > hoy) liberadas.push({ id: c.id, nombre });
                continue;
            }
            const reservada = Math.max(0, Number(c.expectedLoad) / c.deliveryDays.length - real);
            if (reservada > 0) detalle.push({ id: c.id, nombre, reservada });
        }
        if (detalle.length || liberadas.length) {
            reservas[k] = { reservada: detalle.reduce((s, c) => s + c.reservada, 0), clientes: detalle, liberadas };
        }
    }
    return reservas;
}

/**
 * Última recogida que alimenta la entrega del día `k`. Lo recogido un día va a
 * la primera entrega del cliente que quede a MARGEN_MINIMO_DIAS laborables o
 * más: con recogida de lunes a viernes y entrega lunes y viernes, lo del
 * miércoles es lo último que llega al viernes, y lo del jueves va al lunes.
 * Es, por tanto, el día de recogida abierto más cercano hacia atrás con ese
 * margen. Si esa recogida en realidad sale en una entrega anterior (recoge
 * L-M-X-V y entrega L y V: al lunes no llega ninguna con margen), la entrega se
 * alimenta de la recogida más cercana aunque vaya justa, sin pasar de la
 * entrega anterior. null (la reserva no se libera) si el cliente no tiene días
 * de recogida o no cae ninguno en esa ventana.
 */
function ultimaRecogidaDe(cliente, k, calendar) {
    const recogidas = Array.isArray(cliente.pickupDays) ? cliente.pickupDays : [];
    if (!recogidas.length) return null;
    const esRecogida = (d) => recogidas.includes(diaSemana(d)) && esLaborable(calendar, d);
    const esEntrega = (d) => cliente.deliveryDays.includes(diaSemana(d)) && esLaborable(calendar, d);

    let laborables = esLaborable(calendar, k) ? 1 : 0; // laborables en (d, k]
    buscar: for (let d = addDays(k, -1), i = 0; i < 14; d = addDays(d, -1), i++) {
        if (laborables >= MARGEN_MINIMO_DIAS && esRecogida(d)) {
            // ¿Le da tiempo a salir en una entrega anterior a `k`? Entonces no alimenta ésta.
            for (let e = addDays(d, 1); e < k; e = addDays(e, 1)) {
                if (esEntrega(e) && diasLaborablesAdelantados(calendar, d, e) >= MARGEN_MINIMO_DIAS) break buscar;
            }
            return d;
        }
        if (esLaborable(calendar, d)) laborables++;
    }

    // Ninguna recogida llega con margen: la más cercana, hasta la entrega anterior (incluida).
    for (let d = addDays(k, -1), i = 0; i < 7; d = addDays(d, -1), i++) {
        if (esRecogida(d)) return d;
        if (esEntrega(d)) return null;
    }
    return null;
}

/**
 * Carga de un día: los pedidos reales más lo que aún queda reservado para
 * los grandes clientes con entrega ese día.
 * @returns {{real: number, reservada: number, total: number, clientes: Array, liberadas: Array}}
 */
export function cargaDelDia(byDay, reservas, k) {
    const real = (byDay[k] || []).reduce((s, o) => s + cargaPonderada(o.lines), 0);
    const r = reservas?.[k];
    const reservada = r?.reservada || 0;
    return { real, reservada, total: real + reservada, clientes: r?.clientes || [], liberadas: r?.liberadas || [] };
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
