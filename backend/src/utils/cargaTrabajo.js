// Carga de trabajo diaria: cada producto pesa `workloadWeight` "camisas
// equivalentes" (camisa = 1, traje ≈ 2,5, servilleta = 0,05...). La suma de
// las líneas con fecha de entrega en un día es la carga de ese día, y a partir
// de `daily_load_max` (AppSettings) el calendario del TPV lo da por lleno.
// Ver sql/025 para la calibración inicial con el histórico.

export const CARGA_MAX_POR_DEFECTO = 50;
const CLAVE_CARGA_MAX = 'daily_load_max';

export async function leerCargaMaxima(prisma) {
    const fila = await prisma.appSettings.findUnique({ where: { key: CLAVE_CARGA_MAX } });
    const n = parseFloat(fila?.value);
    return Number.isFinite(n) && n > 0 ? n : CARGA_MAX_POR_DEFECTO;
}

export async function guardarCargaMaxima(prisma, valor) {
    const n = Math.max(1, parseFloat(valor) || CARGA_MAX_POR_DEFECTO);
    await prisma.appSettings.upsert({
        where: { key: CLAVE_CARGA_MAX },
        update: { value: String(n) },
        create: { key: CLAVE_CARGA_MAX, value: String(n) },
    });
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
