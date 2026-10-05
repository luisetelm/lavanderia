// Rutas de la aplicación para abrir un pedido o un cliente desde cualquier
// pantalla. Todo lo que navegue a un pedido o a un cliente pasa por aquí: así
// el destino se cambia en un solo sitio (por ejemplo, cuando exista una página
// de detalle de pedido bastará con tocar rutaPedido).

/**
 * Ruta para abrir un pedido. Hoy es la lista de Tareas filtrada por su número,
 * llevado en la URL para que sobreviva a una recarga o a abrirlo en otra pestaña.
 * @param {{id?: number|string, orderNum?: string}} order
 */
export function rutaPedido(order) {
    const num = order?.orderNum || order?.id;
    if (!num) return '/tareas';
    return `/tareas?pedido=${encodeURIComponent(String(num))}`;
}

/** Ruta de la ficha de un cliente (o de cualquier usuario). */
export function rutaCliente(client) {
    const id = typeof client === 'object' ? client?.id : client;
    return id ? `/usuarios/${id}` : '/usuarios';
}
