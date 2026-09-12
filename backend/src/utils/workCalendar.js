// Calendario laboral: combina el horario semanal (work_schedule) con las
// excepciones puntuales (work_schedule_exceptions: festivos, vacaciones,
// aperturas extraordinarias) para saber qué días está abierta la lavandería.
//
// Todas las fechas se manejan como cadenas 'YYYY-MM-DD' en hora local del
// servidor para evitar el desfase de toISOString() a medianoche.

/** Fecha local -> 'YYYY-MM-DD' */
export function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' -> Date a medianoche local */
export function fromYmd(s) {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
}

/** Suma días a una cadena 'YYYY-MM-DD' */
export function addDays(s, n) {
    const d = fromYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
}

/** Lunes de la semana a la que pertenece la fecha */
export function mondayOf(s) {
    const d = fromYmd(s);
    const dow = d.getDay(); // 0=Dom
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return ymd(d);
}

/** Convierte lo que devuelve Prisma para un @db.Date en 'YYYY-MM-DD' */
function exceptionKey(date) {
    // Prisma devuelve las columnas DATE como DateTime a medianoche UTC.
    return new Date(date).toISOString().slice(0, 10);
}

/**
 * Devuelve un mapa { 'YYYY-MM-DD': { isWorking, label, capacityMin, isException } }
 * para todos los días entre from y to (ambos inclusive).
 * Si no hay horario semanal configurado, se asume lunes-viernes abierto.
 */
export async function getWorkCalendar(prisma, from, to) {
    const [weekly, exceptions] = await Promise.all([
        prisma.workSchedule.findMany(),
        prisma.workScheduleException.findMany({
            where: { date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
        }),
    ]);

    const weeklyMap = {};
    weekly.forEach(w => { weeklyMap[w.dayOfWeek] = w; });
    const exceptionMap = {};
    exceptions.forEach(e => { exceptionMap[exceptionKey(e.date)] = e; });

    const calendar = {};
    let cursor = from;
    let guard = 0;
    while (cursor <= to && guard++ < 400) {
        const dow = fromYmd(cursor).getDay();
        const exc = exceptionMap[cursor];
        const wk = weeklyMap[dow];
        if (exc) {
            calendar[cursor] = {
                isWorking: !!exc.isWorking,
                label: exc.label || (exc.isWorking ? 'Apertura especial' : 'Cerrado'),
                capacityMin: exc.capacityMin || 0,
                isException: true,
            };
        } else if (wk) {
            calendar[cursor] = { isWorking: !!wk.isWorking, label: null, capacityMin: wk.capacityMin || 0, isException: false };
        } else {
            const working = dow >= 1 && dow <= 5;
            calendar[cursor] = { isWorking: working, label: null, capacityMin: 0, isException: false };
        }
        cursor = addDays(cursor, 1);
    }
    return calendar;
}

/**
 * Comprueba un único día. Devuelve la entrada del calendario
 * ({ isWorking, label, ... }) o null si la fecha no es válida.
 */
export async function getDayInfo(prisma, dateLike) {
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (Number.isNaN(d.getTime())) return null;
    // Las fechas límite llegan como 'YYYY-MM-DD' (o ISO a medianoche UTC):
    // se lee en UTC para que no se corran de día.
    const key = typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateLike)
        ? dateLike
        : d.toISOString().slice(0, 10);
    const cal = await getWorkCalendar(prisma, key, key);
    return cal[key] || null;
}

/** Primer día abierto a partir de la fecha dada (inclusive). */
export async function nextWorkingDay(prisma, from, maxDays = 60) {
    const cal = await getWorkCalendar(prisma, from, addDays(from, maxDays));
    let cursor = from;
    for (let i = 0; i <= maxDays; i++) {
        if (cal[cursor]?.isWorking) return cursor;
        cursor = addDays(cursor, 1);
    }
    return from;
}
