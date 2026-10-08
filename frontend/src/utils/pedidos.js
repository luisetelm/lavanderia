// Reglas de un pedido que comparten varias pantallas (tarjeta del pedido,
// Dashboard, Entregas). La regla que vale es la del backend (PATCH /orders/:id);
// aquí sólo se replica para pintar los botones.

/** El cliente paga con la factura de fin de mes: el pedido se entrega sin cobrar. */
export function pagaAFinDeMes(order) {
    return !!order?.client?.autoMonthlyInvoice;
}

/** Gran cliente (hoteles, restaurantes…): puede llevarse la ropa sin haber pagado; se le cobra en el momento o después. */
export function esGranCliente(order) {
    return !!order?.client?.isbigclient;
}

/** El pedido puede entregarse sin cobrar: gran cliente o factura a fin de mes. */
export function cobroAplazado(order) {
    return esGranCliente(order) || pagaAFinDeMes(order);
}

/** Se puede marcar como recogido: cobrado, sin importe, o con cobro aplazado. */
export function sePuedeRecoger(order) {
    if (!order) return false;
    return !!order.paid || Number(order.total) <= 0 || cobroAplazado(order);
}

/** Texto corto del estado de cobro para listas. */
export function etiquetaCobro(order) {
    if (order?.paid) return 'Pagado';
    if (Number(order?.total) <= 0) return 'Sin cobro';
    if (pagaAFinDeMes(order)) return 'Factura a fin de mes';
    if (esGranCliente(order)) return 'Pendiente de pago · gran cliente';
    return 'Pendiente de pago';
}
