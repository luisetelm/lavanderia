// backend/src/services/entregasRuta.js
// Pedidos de grandes clientes (hoteles, restaurantes, apartamentos): se les
// lleva la ropa en ruta, en sus días fijos de entrega, así que nadie los entrega
// en el mostrador y se quedaban en "listo para recoger" para siempre (y les
// llegaba el recordatorio de recogida, ver reminders.js).
//
// Cada día, al cierre (cron en server.js), los que estén "listos" con la fecha de
// entrega de hoy o anterior se dan por entregados, sin aviso al cliente. Los que
// aún están pendientes o en proceso no se tocan: no han salido. Si un día no se
// entrega alguno (cliente cerrado, festivo), se vuelve a poner en "listo" desde
// su ficha y se entregará con la fecha que se le ponga.
// La factura mensual no depende de esto: incluye todos los pedidos del mes.

const ZONA = 'Europe/Madrid';

/** 'YYYY-MM-DD' de hoy en Madrid (el servidor puede ir en UTC). */
const hoyEnMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());

export async function entregarPedidosEnRuta(prisma) {
    const hoy = hoyEnMadrid();
    // fechaLimite se guarda a medianoche UTC del día de entrega (utils/cargaTrabajo.js)
    const where = {
        status: 'ready',
        fechaLimite: { lte: new Date(`${hoy}T00:00:00.000Z`) },
        client: { isbigclient: true },
    };
    const pedidos = await prisma.order.findMany({ where, select: { id: true, orderNum: true } });
    if (!pedidos.length) return { hoy, entregados: 0, pedidos: [] };

    await prisma.order.updateMany({
        where: { id: { in: pedidos.map(p => p.id) }, status: 'ready' },
        data: { status: 'collected', updatedAt: new Date() },
    });
    console.log(`[Ruta] ${pedidos.length} pedido(s) de grandes clientes dados por entregados (${hoy}): ${pedidos.map(p => p.orderNum).join(', ')}`);
    return { hoy, entregados: pedidos.length, pedidos: pedidos.map(p => p.orderNum) };
}
