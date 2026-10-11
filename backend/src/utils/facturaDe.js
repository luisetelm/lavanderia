// Un pedido puede tener varias facturas: la original, las rectificativas por lo
// que se le quita y las nuevas por lo que se le añade (ver sql/009 y
// docs/ajustes-pedidos-facturados.md).
//
// Esta función devuelve la factura "vigente" del pedido, entendiendo por tal la
// primera que no sea rectificativa — que es la que hay que enseñar o marcar como
// pagada cuando el código antiguo hablaba de "la factura del pedido".
//
// Acepta tanto el array actual como el objeto único que devolvía Prisma cuando
// la relación era 1:1, para no depender del orden de despliegue.
export function facturaDe(order) {
    const tickets = order?.invoiceTickets;
    if (!tickets) return null;

    const lista = Array.isArray(tickets) ? tickets : [tickets];
    const vigente = lista.find((t) => t?.invoices && !t.invoices.isRectifying);
    return vigente?.invoices || lista[0]?.invoices || null;
}

/** La factura está cobrada. */
export const facturaCobrada = (inv) => inv?.paid === true || inv?.paymentStatus === 'paid';

// Factura NORMAL del pedido que sigue sin cobrar. Mientras exista, lo que está
// pendiente es la factura y no el pedido: se cobra la factura (Ventas o ficha del
// pedido, POST /invoices/:id/collect) y el pedido queda cobrado con ella. Por eso
// el cobro directo del pedido (POST /orders/:id/pay, enlaces de Stripe) se rechaza.
//
// Las simplificadas no cuentan: son el ticket de un solo pedido de mostrador y se
// siguen cobrando desde el pedido. Las rectificativas tampoco.
export function facturaPendienteDe(order) {
    const tickets = order?.invoiceTickets;
    if (!tickets) return null;
    const lista = Array.isArray(tickets) ? tickets : [tickets];
    const t = lista.find((x) => x?.invoices && !x.invoices.isRectifying
        && x.invoices.type === 'n' && !facturaCobrada(x.invoices));
    return t?.invoices || null;
}

/** Mensaje de rechazo del cobro directo de un pedido incluido en una factura normal sin cobrar. */
export const avisoFacturaPendiente = (inv) =>
    `El pedido está incluido en la factura ${inv?.number || ''} pendiente de cobro: cobra la factura, no el pedido.`.replace('  ', ' ');
