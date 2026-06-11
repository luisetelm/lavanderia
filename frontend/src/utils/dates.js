export function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getPrimerDiaMes() {
    const hoy = new Date();
    return formatDate(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
}

export function getUltimoDiaMes() {
    const hoy = new Date();
    return formatDate(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
}

export function getDateRange(preset) {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const d = hoy.getDate();

    // Lunes como primer día de la semana (ISO)
    const startOfWeek = (date) => {
        const tmp = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const dow = (tmp.getDay() + 6) % 7; // 0 = lunes
        tmp.setDate(tmp.getDate() - dow);
        return tmp;
    };
    const addDays = (date, n) => {
        const t = new Date(date);
        t.setDate(t.getDate() + n);
        return t;
    };

    switch (preset) {
        case 'today':
            return [formatDate(hoy), formatDate(hoy)];
        case 'yesterday': {
            const ayer = new Date(y, m, d - 1);
            return [formatDate(ayer), formatDate(ayer)];
        }
        case 'last_7':
            return [formatDate(new Date(y, m, d - 6)), formatDate(hoy)];
        case 'last_30':
            return [formatDate(new Date(y, m, d - 29)), formatDate(hoy)];
        case 'this_week': {
            const monday = startOfWeek(hoy);
            return [formatDate(monday), formatDate(addDays(monday, 6))];
        }
        case 'last_week': {
            const monday = addDays(startOfWeek(hoy), -7);
            return [formatDate(monday), formatDate(addDays(monday, 6))];
        }
        case 'this_month':
            return [formatDate(new Date(y, m, 1)), formatDate(new Date(y, m + 1, 0))];
        case 'last_month':
            return [formatDate(new Date(y, m - 1, 1)), formatDate(new Date(y, m, 0))];
        case 'last_3':
            return [formatDate(new Date(y, m - 2, 1)), formatDate(new Date(y, m + 1, 0))];
        case 'last_6':
            return [formatDate(new Date(y, m - 5, 1)), formatDate(new Date(y, m + 1, 0))];
        case 'this_year':
            return [formatDate(new Date(y, 0, 1)), formatDate(new Date(y, 11, 31))];
        case 'last_year':
            return [formatDate(new Date(y - 1, 0, 1)), formatDate(new Date(y - 1, 11, 31))];
        default:
            return [getPrimerDiaMes(), getUltimoDiaMes()];
    }
}

export const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export const DATE_PRESETS = [
    { key: 'today', label: 'Hoy' },
    { key: 'yesterday', label: 'Ayer' },
    { key: 'last_7', label: 'Últimos 7 días' },
    { key: 'this_week', label: 'Esta semana' },
    { key: 'last_week', label: 'Semana pasada' },
    { key: 'last_30', label: 'Últimos 30 días' },
    { key: 'this_month', label: 'Este mes' },
    { key: 'last_month', label: 'Mes anterior' },
    { key: 'last_3', label: 'Últimos 3 meses' },
    { key: 'last_6', label: 'Últimos 6 meses' },
    { key: 'this_year', label: 'Este año' },
    { key: 'last_year', label: 'Año anterior' },
];
