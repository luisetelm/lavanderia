// frontend/src/qzHelper.js

export async function listPrinters() {
    return qz.getPrinters();
}

export function printerConfig(name) {
    return qz.configs.create(name);
}

// Ticket de venta
export function buildSaleTicket({ order }) {
    const client = order.client || {};
    const clientName = client.firstName
        ? `${client.firstName} ${client.lastName || ''}`.trim()
        : 'Cliente rápido';
    const lines = (order.lines || []).map(
        (l) => `${l.quantity}x ${l.productName || l.productId} ${(l.unitPrice * l.quantity).toFixed(2)}€`
    );
    return `
***** LAVANDERÍA *****

Pedido: ${order.orderNum}
Cliente: ${clientName}
Tel: ${client.phone || ''}

${lines.join('\n')}

Total: ${order.total.toFixed(2)}€
Pago: ${order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}

Gracias por su confianza!
`.trim();
}

// Etiqueta de lavado numerada
export function buildWashLabel({
                                   orderNum,
                                   clientFirstName,
                                   clientLastName,
                                   itemIndex,
                                   totalItems,
                               }) {
    const clientName = `${clientFirstName} ${clientLastName}`.trim();
    return `
*** ETIQUETA LAVADO ***

Cliente: ${clientName}
Pedido: ${orderNum}
Prenda: ${orderNum}/${itemIndex} de ${totalItems}

--------------------
`.trim();
}

// Imprime a impresora dada
export async function printToPrinter(printerName, contentLines) {
    if (!window.qz) throw new Error('QZ Tray no está cargado');
    const config = printerConfig(printerName);
    // Construir array de objetos raw (plain text)
    const data = contentLines.map((line) => ({ type: 'raw', format: 'plain', data: line + '\n' }));
    // Añadir comando de corte (puede variar según impresora térmica)
    data.push({ type: 'raw', format: 'plain', data: '\x1D\x56\x00' }); // cortar
    await qz.print(config, data);
}
