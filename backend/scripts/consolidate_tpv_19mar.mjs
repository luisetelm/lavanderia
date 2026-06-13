// Consolidación del histórico TPV: crea un "cierre del 19/03/2026" que agrupa
// todos los cobros con tarjeta huérfanos (pedidos card sin fila en Payment).
//
// SEGURIDAD:
//   - Por defecto corre en DRY-RUN (no escribe nada, solo informa).
//   - Para aplicar de verdad:   node scripts/consolidate_tpv_19mar.mjs --apply
//   - Toda la escritura va en UNA transacción (todo o nada).
//
// IMPORTANTE: ejecutar contra la BD de PRODUCCIÓN (DATABASE_URL correcto).
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---- Parámetros de la consolidación ----
const APPLY = process.argv.includes('--apply');
const NON_CASH = ['card_pos', 'card', 'stripe', 'transfer'];
const CUTOFF = new Date('2026-03-20T00:00:00');          // pedidos creados ANTES del 20/03
const PAYMENT_DATE = new Date('2026-03-19T16:55:00');    // fecha que se pondrá a cada Payment
const CLOSURE_DATE = new Date('2026-03-19T17:00:00');    // fecha del cierre de consolidación
const MARK_RECONCILED = true;                            // saldo histórico => ya conciliado
const NOTE = 'Consolidación TPV histórico (cobros con tarjeta sin Payment) hasta 19/03/2026';
// userId del cierre (obligatorio en el modelo). Fijado al usuario 1 (Luis).
const CLOSURE_USER_ID = 1;
const eur = (n) => `${Number(n || 0).toFixed(2)} €`;

async function main() {
    console.log(`MODO: ${APPLY ? '*** APPLY (escribe en BD) ***' : 'DRY-RUN (solo lectura)'}\n`);

    // 1) Pedidos con tarjeta COBRADOS (paid) sin Payment no-efectivo, creados antes del corte y no cancelados
    const cardOrders = await prisma.order.findMany({
        where: { paymentMethod: 'card', paid: true, createdAt: { lt: CUTOFF }, status: { not: 'cancelled' } },
        select: { id: true, orderNum: true, total: true, clientId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
    });
    const withPay = await prisma.payment.findMany({
        where: { orderId: { in: cardOrders.map(o => o.id) }, method: { in: NON_CASH } },
        select: { orderId: true },
    });
    const paidSet = new Set(withPay.map(p => p.orderId));
    const orphans = cardOrders.filter(o => !paidSet.has(o.id));

    const total = orphans.reduce((a, o) => a + Number(o.total || 0), 0);
    console.log(`Pedidos a consolidar: ${orphans.length}`);
    console.log(`Importe total:        ${eur(total)}`);
    console.log(`Fecha Payment:        ${PAYMENT_DATE.toISOString()}`);
    console.log(`Fecha cierre:         ${CLOSURE_DATE.toISOString()}`);
    console.log(`reconciled:           ${MARK_RECONCILED}\n`);

    if (orphans.length === 0) { console.log('Nada que consolidar.'); await prisma.$disconnect(); return; }

    // Aviso si ya existe un cierre con esa fecha (evitar duplicar la consolidación)
    const dup = await prisma.cashClosure.findFirst({ where: { closedat: CLOSURE_DATE } });
    if (dup) console.log(`AVISO: ya existe un cierre con closedat=${CLOSURE_DATE.toISOString()} (#${dup.id}). Revisa antes de --apply.\n`);

    if (!APPLY) {
        console.log('Muestra (primeros 10):');
        for (const o of orphans.slice(0, 10))
            console.log(`  ${o.orderNum.padEnd(16)} ${eur(o.total).padStart(10)}  cliente=${o.clientId ?? '-'}`);
        console.log('\nDRY-RUN: no se ha escrito nada. Repite con --apply para aplicar.');
        await prisma.$disconnect();
        return;
    }

    // 2) Aplicar en una transacción
    const result = await prisma.$transaction(async (tx) => {
        // 2a) Cierre de consolidación (solo-tarjeta: efectivo neutro)
        const last = await tx.cashClosure.findFirst({
            where: { closedat: { lt: CLOSURE_DATE } }, orderBy: { closedat: 'desc' },
        });
        // Resolver userId obligatorio del cierre
        let userId = CLOSURE_USER_ID ?? last?.userId ?? null;
        if (userId == null) {
            const u = await tx.user.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
            userId = u?.id ?? null;
        }
        if (userId == null) throw new Error('No hay ningún usuario para asignar al cierre (userId es obligatorio).');

        const opening = last ? Number(last.countedamount) : 0;
        const closure = await tx.cashClosure.create({
            data: {
                closedat: CLOSURE_DATE,
                openingamount: String(opening),
                expectedamount: String(opening),
                countedamount: String(opening),
                diff: '0',
                userId,
                notes: NOTE,
            },
        });

        // 2b) Un Payment por pedido huérfano
        let created = 0;
        for (const o of orphans) {
            await tx.payment.create({
                data: {
                    amount: String(o.total),
                    method: 'card_pos',
                    status: 'completed',
                    orderId: o.id,
                    clientId: o.clientId ?? null,
                    recordedBy: null,
                    note: NOTE,
                    reconciled: MARK_RECONCILED,
                    reconciledAt: MARK_RECONCILED ? PAYMENT_DATE : null,
                    createdAt: PAYMENT_DATE,
                },
            });
            created++;
        }
        return { closureId: closure.id, created };
    }, { timeout: 180000, maxWait: 20000 });
    console.log(`\nOK. Cierre #${result.closureId} creado. Payments insertados: ${result.created}. Total: ${eur(total)}`);
    await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });






