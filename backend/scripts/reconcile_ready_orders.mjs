// Conciliación de pedidos "ready" contra la lista escrita a mano de la lavandería.
//
// Contexto: se enviaron avisos de "pedido listo" a clientes cuyos pedidos en realidad
// YA estaban recogidos, pero seguían marcados como 'ready' en el sistema. La lavandería
// pasó una lista a mano de los pedidos que SÍ siguen pendientes de recoger.
//
// Lógica (por descarte): todo pedido en estado 'ready' de 2026 que NO aparezca en la
// lista de pendientes => en realidad ya se recogió => se marca como 'collected'.
//
// IMPORTANTE: el cambio se hace DIRECTAMENTE en la base de datos con Prisma, NO a través
// de la API, para NO disparar la notificación de "pedido recogido" a los clientes.
//
// ─────────────────────────────────────────────────────────────────────────────
// USO:
//   1) Crea el fichero con los pedidos que SIGUEN pendientes (uno por línea):
//        scripts/pending_list.txt      (formato: TPV/2026/0001)
//   2) Simulación (no toca nada, solo informe):
//        node scripts/reconcile_ready_orders.mjs
//   3) Aplicar de verdad (solo los pagados):
//        node scripts/reconcile_ready_orders.mjs --apply
//   4) Aplicar incluyendo los recogidos-sin-pagar (revísalo antes):
//        node scripts/reconcile_ready_orders.mjs --apply --include-unpaid
//
//   Opcional: usar otro fichero de lista:
//        node scripts/reconcile_ready_orders.mjs --list=scripts/mi_lista.txt
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Argumentos ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INCLUDE_UNPAID = args.includes('--include-unpaid');
const YEAR = (args.find(a => a.startsWith('--year=')) || '--year=2026').split('=')[1];
const listArg = args.find(a => a.startsWith('--list='));
const LIST_PATH = listArg ? listArg.split('=')[1] : 'scripts/pending_list.txt';

const eur = (n) => `${Number(n || 0).toFixed(2)} €`;
const name = (c) => c ? `${c.firstName || ''} ${c.lastName || ''}`.trim() : '(sin cliente)';

// Normaliza un orderNum para comparar de forma tolerante:
// "TPV / 2026 / 0001" -> "TPV/2026/1"  (mayúsculas, sin espacios, sin ceros a la izq. en el nº final)
function normalize(raw) {
    if (!raw) return '';
    const parts = String(raw)
        .toUpperCase()
        .replace(/\s+/g, '')
        .split('/')
        .filter(Boolean);
    if (parts.length === 0) return '';
    // quitar ceros a la izquierda del último segmento si es numérico
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) parts[parts.length - 1] = String(parseInt(last, 10));
    return parts.join('/');
}

async function main() {
    // ── 1) Leer la lista escrita a mano ──────────────────────────────────────
    const listFile = path.resolve(process.cwd(), LIST_PATH);
    if (!fs.existsSync(listFile)) {
        console.error(`\n❌ No existe el fichero de lista: ${listFile}`);
        console.error(`   Crea "${LIST_PATH}" con un número de pedido por línea (ej. TPV/2026/0001).\n`);
        process.exit(1);
    }
    const rawLines = fs.readFileSync(listFile, 'utf8')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('#'));

    const pendingSet = new Set(rawLines.map(normalize).filter(Boolean));

    // ── 2) Pedidos en 'ready' del año indicado ───────────────────────────────
    const readyOrders = await prisma.order.findMany({
        where: {
            status: 'ready',
            orderNum: { contains: `/${YEAR}/` },
        },
        select: {
            id: true, orderNum: true, total: true, paid: true, status: true,
            createdAt: true, updatedAt: true,
            client: { select: { firstName: true, lastName: true, phone: true } },
        },
        orderBy: { createdAt: 'asc' },
    });

    // ── 3) Clasificar ────────────────────────────────────────────────────────
    const staysReady = [];   // están en la lista => siguen pendientes (correcto)
    const toCollectPaid = []; // no están en la lista y están pagados => marcar collected
    const toCollectUnpaid = []; // no están en la lista pero NO pagados => revisar

    const matchedFromList = new Set();

    for (const o of readyOrders) {
        const key = normalize(o.orderNum);
        if (pendingSet.has(key)) {
            staysReady.push(o);
            matchedFromList.add(key);
        } else {
            const isPaid = o.paid === true || Number(o.total) <= 0;
            (isPaid ? toCollectPaid : toCollectUnpaid).push(o);
        }
    }

    // Números de la lista que no casan con ningún pedido 'ready' (erratas / ya recogidos / otro estado)
    const notFound = [...pendingSet].filter(k => !matchedFromList.has(k));

    // ── 4) Informe ───────────────────────────────────────────────────────────
    const line = '─'.repeat(72);
    console.log(`\n${line}`);
    console.log(`  CONCILIACIÓN DE PEDIDOS 'ready'  —  año ${YEAR}`);
    console.log(`  Modo: ${APPLY ? '⚠️  APLICAR CAMBIOS' : '🔍 SIMULACIÓN (no se modifica nada)'}`);
    console.log(`  Lista de pendientes: ${LIST_PATH}  (${pendingSet.size} pedidos)`);
    console.log(line);
    console.log(`  Pedidos en 'ready' en el sistema : ${readyOrders.length}`);
    console.log(`  Siguen pendientes (en la lista)  : ${staysReady.length}`);
    console.log(`  → A marcar 'collected' (pagados) : ${toCollectPaid.length}`);
    console.log(`  → Recogidos SIN pagar (revisar)  : ${toCollectUnpaid.length}`);
    console.log(`  Nºs de la lista sin coincidencia : ${notFound.length}`);
    console.log(line);

    if (toCollectPaid.length) {
        console.log(`\n✅ SE MARCARÁN COMO 'collected' (${toCollectPaid.length}):`);
        for (const o of toCollectPaid) {
            console.log(`   ${o.orderNum.padEnd(16)} ${eur(o.total).padStart(10)}  ${name(o.client)}`);
        }
    }

    if (toCollectUnpaid.length) {
        console.log(`\n⚠️  RECOGIDOS PERO SIN PAGAR (${toCollectUnpaid.length}) — ${INCLUDE_UNPAID ? 'SE INCLUIRÁN' : 'NO se tocan sin --include-unpaid'}:`);
        for (const o of toCollectUnpaid) {
            console.log(`   ${o.orderNum.padEnd(16)} ${eur(o.total).padStart(10)}  ${name(o.client)}  📞 ${o.client?.phone || '-'}`);
        }
    }

    if (notFound.length) {
        console.log(`\n❓ EN LA LISTA PERO NO ESTÁN EN 'ready' (${notFound.length}) — revisa a mano (¿errata?, ¿ya recogido?, ¿otro año?):`);
        for (const k of notFound) console.log(`   ${k}`);
    }

    // ── 5) Aplicar ───────────────────────────────────────────────────────────
    const targets = INCLUDE_UNPAID ? [...toCollectPaid, ...toCollectUnpaid] : toCollectPaid;

    if (!APPLY) {
        console.log(`\n${line}`);
        console.log(`  SIMULACIÓN: no se ha modificado nada.`);
        console.log(`  Para aplicar: node scripts/reconcile_ready_orders.mjs --apply${INCLUDE_UNPAID ? ' --include-unpaid' : ''}`);
        console.log(`${line}\n`);
        return;
    }

    if (targets.length === 0) {
        console.log(`\nNo hay pedidos que actualizar. Fin.\n`);
        return;
    }

    const now = new Date();
    const ids = targets.map(o => o.id);
    const res = await prisma.order.updateMany({
        where: { id: { in: ids }, status: 'ready' }, // guard extra: solo si siguen en ready
        data: { status: 'collected', updatedAt: now },
    });

    console.log(`\n${line}`);
    console.log(`  ✅ Actualizados ${res.count} pedidos a 'collected' (sin enviar notificaciones).`);
    console.log(`${line}\n`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });

