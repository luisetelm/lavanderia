// Diagnóstico SOLO LECTURA: pedidos pagados con tarjeta SIN fila en Payment.
// No modifica nada. Sirve para planificar el cierre de consolidación del 19/03/2026.
//
// Uso:  node scripts/diagnose_tpv_orphans.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CUTOFF = new Date('2026-03-20T00:00:00');      // pedidos creados ANTES del 20/03
const NON_CASH = ['card_pos', 'card', 'stripe', 'transfer'];
const eur = (n) => `${Number(n || 0).toFixed(2)} €`;

async function main() {
    // 1) Todos los pedidos pagados con tarjeta
    const cardOrders = await prisma.order.findMany({
        where: { paymentMethod: 'card' },
        select: { id: true, orderNum: true, total: true, paid: true, status: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'asc' },
    });

    // 2) IDs de pedidos que YA tienen un Payment no-efectivo
    const withPay = await prisma.payment.findMany({
        where: { orderId: { in: cardOrders.map(o => o.id) }, method: { in: NON_CASH } },
        select: { orderId: true },
    });
    const paidSet = new Set(withPay.map(p => p.orderId));

    const orphans = cardOrders.filter(o => !paidSet.has(o.id));

    // 3) Distribución por estado (todos los huérfanos)
    const byStatus = {};
    for (const o of orphans) {
        const k = o.status || 'null';
        byStatus[k] = byStatus[k] || { n: 0, sum: 0 };
        byStatus[k].n++; byStatus[k].sum += Number(o.total || 0);
    }

    // 4) Selección candidata a consolidar: cobrados (paid), creados antes del 20/03, no cancelados
    const selectable = orphans.filter(o => o.paid === true && o.createdAt < CUTOFF && o.status !== 'cancelled');
    const afterCutoff = orphans.filter(o => o.createdAt >= CUTOFF);
    const notPaid = orphans.filter(o => o.createdAt < CUTOFF && o.paid !== true);
    const sum = (arr) => arr.reduce((a, o) => a + Number(o.total || 0), 0);

    // 4b) Chequeo de integridad: pedidos CANCELADOS marcados como pagados (no debería ocurrir)
    const cancelledPaid = await prisma.order.findMany({
        where: { status: 'cancelled', paid: true },
        select: { id: true, orderNum: true, total: true, paymentMethod: true },
        orderBy: { id: 'asc' },
    });

    console.log('='.repeat(64));
    console.log(`Pedidos con paymentMethod='card':            ${cardOrders.length}`);
    console.log(`  · con Payment ya registrado:               ${paidSet.size}`);
    console.log(`  · HUÉRFANOS (sin Payment):                 ${orphans.length}  -> ${eur(sum(orphans))}`);
    console.log('='.repeat(64));

    console.log('\nHuérfanos por estado:');
    for (const k of Object.keys(byStatus).sort())
        console.log(`  ${k.padEnd(12)} ${String(byStatus[k].n).padStart(4)}  ->  ${eur(byStatus[k].sum)}`);

    console.log('\nSelección a CONSOLIDAR (paid=true, createdAt < 2026-03-20 y status != cancelled):');
    console.log(`  ${selectable.length} pedidos  ->  ${eur(sum(selectable))}`);
    console.log(`Huérfanos creados el 20/03 o después (NO entran, flujo vivo): ${afterCutoff.length} -> ${eur(sum(afterCutoff))}`);
    console.log(`Huérfanos anteriores SIN cobrar (paid=false, NO entran): ${notPaid.length} -> ${eur(sum(notPaid))}`);

    console.log('\nINTEGRIDAD · pedidos CANCELADOS marcados como pagados (revisar/corregir):');
    if (cancelledPaid.length === 0) console.log('  (ninguno) ✔');
    for (const o of cancelledPaid)
        console.log(`  ${o.orderNum.padEnd(16)} ${eur(o.total).padStart(10)}  método=${o.paymentMethod ?? '-'}  (id ${o.id})`);

    // 5) Cierres existentes alrededor del 19/03/2026
    const closuresNear = await prisma.cashClosure.findMany({
        where: { closedat: { gte: new Date('2026-03-10'), lte: new Date('2026-03-31T23:59:59') } },
        orderBy: { closedat: 'asc' },
        select: { id: true, closedat: true, countedamount: true, notes: true },
    });
    const lastBefore = await prisma.cashClosure.findFirst({
        where: { closedat: { lt: new Date('2026-03-19T00:00:00') } },
        orderBy: { closedat: 'desc' },
        select: { id: true, closedat: true, countedamount: true },
    });
    const firstAfter = await prisma.cashClosure.findFirst({
        where: { closedat: { gte: new Date('2026-03-19T00:00:00') } },
        orderBy: { closedat: 'asc' },
        select: { id: true, closedat: true, countedamount: true },
    });

    console.log('\nÚltimo cierre ANTES del 19/03:', lastBefore
        ? `#${lastBefore.id}  ${lastBefore.closedat.toISOString()}  contado=${eur(lastBefore.countedamount)}` : 'NINGUNO');
    console.log('Primer cierre EN/DESPUÉS del 19/03:', firstAfter
        ? `#${firstAfter.id}  ${firstAfter.closedat.toISOString()}  contado=${eur(firstAfter.countedamount)}` : 'NINGUNO');

    console.log('\nCierres entre 10/03 y 31/03:');
    if (closuresNear.length === 0) console.log('  (ninguno)');
    for (const c of closuresNear)
        console.log(`  #${c.id}  ${c.closedat.toISOString()}  contado=${eur(c.countedamount)}  ${c.notes || ''}`);

    await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });



