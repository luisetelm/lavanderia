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
    switch (preset) {
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
    { key: 'this_month', label: 'Este mes' },
    { key: 'last_month', label: 'Mes anterior' },
    { key: 'last_3', label: 'Últimos 3 meses' },
    { key: 'last_6', label: 'Últimos 6 meses' },
    { key: 'this_year', label: 'Este año' },
    { key: 'last_year', label: 'Año anterior' },
];
