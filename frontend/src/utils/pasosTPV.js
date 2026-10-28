// TPV por pasos: el pedido se toma en este orden. La fecha va después de las
// prendas para que el calendario pueda decir cuántas piezas iguales hay ya ese día.
// La vista clásica (todo a la vez) sigue disponible con el interruptor del TPV.
import { esTelefonoValido } from './telefono.js';

export const PASOS = [
    { key: 'cliente', titulo: 'Cliente', icono: 'user' },
    { key: 'prendas', titulo: 'Prendas', icono: 'bag' },
    { key: 'entrega', titulo: 'Entrega', icono: 'calendar' },
    { key: 'revisar', titulo: 'Revisar', icono: 'check' },
];

export const esPaso = (key) => PASOS.some(p => p.key === key);

// Teléfono del cliente del pedido en curso: el de su ficha o el del cliente nuevo
export const telefonoCliente = (draft) => (draft.selectedUser ? draft.selectedUser.phone : draft.quickClient?.phone) || '';

// Qué pasos tienen ya lo necesario. No bloquea el avance: sólo marca la barra
// de pasos y el resumen. La comprobación que vale es la de «Validar pedido».
export function pasosCompletos(draft) {
    const q = draft.quickClient || {};
    const cliente = draft.selectedUser
        ? esTelefonoValido(draft.selectedUser.phone || '')
        : Boolean(q.firstName && q.lastName && esTelefonoValido(q.phone || ''));
    return {
        cliente,
        prendas: (draft.cart || []).length > 0,
        entrega: Boolean(draft.fechaLimite),
        revisar: false,
    };
}

// Paso del TPV en el que está cada campo al que llevan los avisos de «Validar pedido»
export function pasoDeCampo(campo) {
    if (!campo) return null;
    if (campo.startsWith('pos-cliente')) return 'cliente';
    if (campo === 'pos-prendas') return 'prendas';
    if (campo === 'pos-entrega' || campo === 'pos-observaciones') return 'entrega';
    return null;
}

// Vista elegida en el TPV, recordada en el equipo (la tablet es compartida)
const VISTA_KEY = 'tpvVista';
export function leerVistaTPV() {
    try { return localStorage.getItem(VISTA_KEY) === 'clasica' ? 'clasica' : 'pasos'; } catch { return 'pasos'; }
}
export function guardarVistaTPV(vista) {
    try { localStorage.setItem(VISTA_KEY, vista); } catch { /* sin almacenamiento: vale para esta sesión */ }
}

// Lo que el pedido en curso necesita saber del calendario de entregas (fecha
// sugerida y días que adelanta cada fecha) para calcular el suplemento de urgencia,
// a partir de la respuesta de /orders/delivery-dates
export function infoCalendario(data, lineas = '') {
    const daysAheadByDate = {};
    (data?.days || []).forEach(d => { daysAheadByDate[d.date] = d.daysAhead || 0; });
    return {
        suggestedDate: data?.suggestedDate || null,
        urgency: { pctPerDay: Number(data?.urgency?.pctPerDay) || 0, maxPct: Number(data?.urgency?.maxPct) || 0 },
        daysAheadByDate,
        lineas, // prendas con las que se calculó la sugerida (lineasDelPedido)
    };
}

// Prendas del pedido en curso para /orders/delivery-dates: «producto x cantidad»
// juntando las líneas del mismo producto («12x2,7x1»). La sugerida busca un día en
// el que quepan; sirve también de clave para saber si hay que volver a pedirla.
export function lineasDelPedido(cart) {
    const porProducto = {};
    (cart || []).forEach(c => { porProducto[c.productId] = (porProducto[c.productId] || 0) + (Number(c.quantity) || 0); });
    return Object.keys(porProducto).sort((a, b) => a - b)
        .filter(id => porProducto[id] > 0)
        .map(id => `${id}x${porProducto[id]}`).join(',');
}

// Pedir desde el TPV la misma validación que hace la barra del pedido en curso
export const EVENTO_VALIDAR = 'tpv:validar-pedido';
export const pedirValidacion = () => window.dispatchEvent(new Event(EVENTO_VALIDAR));
