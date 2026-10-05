// Rutas de la aplicación para abrir un pedido o un cliente desde cualquier
// pantalla. Todo lo que navegue a un pedido o a un cliente pasa por aquí: así
// el destino se cambia en un solo sitio (por ejemplo, cuando exista una página
// de detalle de pedido bastará con tocar rutaPedido).

/**
 * Ruta de la página de un pedido (/pedidos/:id). Si sólo se conoce el número
 * (sin id), se cae en la lista de Tareas filtrada por ese número.
 * @param {{id?: number|string, orderNum?: string}} order
 */
export function rutaPedido(order) {
    if (order?.id) return `/pedidos/${order.id}`;
    if (order?.orderNum) return `/tareas?pedido=${encodeURIComponent(String(order.orderNum))}`;
    return '/tareas';
}

/** Ruta de la ficha de un cliente (o de cualquier usuario). */
export function rutaCliente(client) {
    const id = typeof client === 'object' ? client?.id : client;
    return id ? `/usuarios/${id}` : '/usuarios';
}

/** Vista de Entregas de un día ('YYYY-MM-DD'); sin día, la de hoy. */
export function rutaEntregas(dia) {
    return dia ? `/entregas?dia=${dia}` : '/entregas';
}
