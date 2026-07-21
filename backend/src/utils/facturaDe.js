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
