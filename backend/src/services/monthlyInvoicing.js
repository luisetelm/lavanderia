import { crearFactura } from '../routes/invoices.js';

/**
 * Genera facturas normales para todos los clientes con autoMonthlyInvoice=true.
 * Factura los pedidos del mes anterior que no estén ya facturados.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<{processed: number, invoiced: number, errors: Array}>}
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
                    // Excluir pedidos que ya tienen factura
                    invoiceTickets: null,
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
            await crearFactura(prisma, {
                orderIds,
                type: 'n',
            });

            invoiced++;
            console.log(`[MonthlyInvoicing] Factura generada para cliente ${client.id}`);
        } catch (err) {
            const errorMsg = `Cliente ${client.id} (${client.firstName} ${client.lastName}): ${err.message || err}`;
            console.error(`[MonthlyInvoicing] Error: ${errorMsg}`);
            errors.push(errorMsg);
        }
    }

    const summary = { processed, invoiced, errors };
    console.log(`[MonthlyInvoicing] Resumen: ${invoiced}/${processed} facturados, ${errors.length} errores`);
    return summary;
}
