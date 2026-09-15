// Estados de la domiciliación SEPA (backend/src/services/sepa.js, docs/domiciliacion-sepa.md)

// invoices.paymentStatus mientras hay un adeudo lanzado y cuando se rechaza o devuelve
export const FACTURA_SEPA_EN_CURSO = 'sepa_processing';
export const FACTURA_SEPA_FALLIDA = 'sepa_failed';

// Payment.status de un adeudo (method = 'sepa')
export const ADEUDO_ESTADO = {
    pending: {texto: 'En curso', color: '#d97706', fondo: '#fffbeb'},
    completed: {texto: 'Cobrado', color: '#16a34a', fondo: '#f0fdf4'},
    failed: {texto: 'Rechazado', color: '#dc2626', fondo: '#fef2f2'},
    disputed: {texto: 'Devuelto', color: '#dc2626', fondo: '#fef2f2'},
};

// sepa_mandate.status
export const MANDATO_ESTADO = {
    active: 'Activa',
    pending: 'Pendiente de confirmar',
    inactive: 'Cancelada por el banco o el cliente',
    replaced: 'Sustituida por otra cuenta',
    revoked: 'Cancelada',
};
