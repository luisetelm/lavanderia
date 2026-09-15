import { crearFactura } from '../routes/invoices.js';
import { cobrarFacturaSepa, mandatoActivo } from './sepa.js';

/**
 * Genera facturas normales para todos los clientes con autoMonthlyInvoice=true.
 * Factura los pedidos del mes anterior que no estén ya facturados y, si el
 * cliente tiene la domiciliación SEPA activa, lanza el adeudo de la factura.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<{processed: number, invoiced: number, sepaCharged: number, errors: Array}>}
 */
export async function generateMonthlyInvoices(prisma) {
    const now = new Date();
    // Primer día del mes anterior
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // Último día del mes anterior (= día 0 del mes actual)
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    console.log(`[MonthlyInvoicing] Generando facturas del ${startOfLastMonth.toISOString()} al ${endOfLastMonth.toISOString()}`);

    // Buscar clientes con auto-facturación activa
    const clients = await prisma.user.findMany({
        where: {
            autoMonthlyInvoice: true,
            role: 'customer',
        },
        select: { id: true, firstName: true, lastName: true, email: true }
    });

    console.log(`[MonthlyInvoicing] Encontrados ${clients.length} clientes con auto-facturación`);

    let processed = 0;
    let invoiced = 0;
    let sepaCharged = 0;
    const errors = [];

    for (const client of clients) {
        processed++;
        try {
            // Buscar pedidos del mes anterior sin facturar
            const orders = await prisma.order.findMany({
                where: {
                    clientId: client.id,
                    createdAt: {
                        gte: startOfLastMonth,
                        lte: endOfLastMonth,
                    },
                    total: { gt: 0 },
                    // Excluir pedidos que ya tienen factura. Con la relación 1:N
                    // (sql/009) el filtro es "ninguna factura vinculada".
                    invoiceTickets: { none: {} },
                    // Excluir cancelados
                    status: { not: 'cancelled' },
                },
                select: { id: true, orderNum: true, total: true }
            });

            if (orders.length === 0) {
                console.log(`[MonthlyInvoicing] Cliente ${client.id} (${client.firstName} ${client.lastName}): sin pedidos para facturar`);
                continue;
            }

            const orderIds = orders.map(o => o.id);
            const totalAmount = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

            console.log(`[MonthlyInvoicing] Cliente ${client.id} (${client.firstName} ${client.lastName}): ${orders.length} pedidos, total ${totalAmount.toFixed(2)}€`);

            // Crear factura normal usando la función existente
            const factura = await crearFactura(prisma, {
                orderIds,
                type: 'n',
            });

            invoiced++;
            console.log(`[MonthlyInvoicing] Factura generada para cliente ${client.id}`);

            // Domiciliación SEPA: el adeudo se lanza en el momento. Si falla, la
            // factura ya está emitida y queda pendiente de cobro como siempre.
            if (factura?.id && await mandatoActivo(prisma, client.id)) {
                try {
                    await cobrarFacturaSepa(prisma, factura.id);
                    sepaCharged++;
                } catch (err) {
                    errors.push(`Cliente ${client.id} (${client.firstName} ${client.lastName}): factura emitida, pero el adeudo SEPA falló: ${err.message || err}`);
                }
            }
        } catch (err) {
            const errorMsg = `Cliente ${client.id} (${client.firstName} ${client.lastName}): ${err.message || err}`;
            console.error(`[MonthlyInvoicing] Error: ${errorMsg}`);
            errors.push(errorMsg);
        }
    }

    const summary = { processed, invoiced, sepaCharged, errors };
    console.log(`[MonthlyInvoicing] Resumen: ${invoiced}/${processed} facturados, ${sepaCharged} adeudos SEPA, ${errors.length} errores`);
    return summary;
}
