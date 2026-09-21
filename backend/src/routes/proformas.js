// backend/src/routes/proformas.js
//
// Facturas proforma: el presupuesto detallado que se entrega al cliente para que
// lo presente ante un tercero (una aseguradora, el caso que las motiva).
//
// Una proforma no es una factura. No devenga IVA, no entra en el libro registro
// de facturas emitidas, no sale en el export a la gestoría y no da derecho a
// deducción: es una oferta. Por eso:
//
//   * vive en sus propias tablas (sql/030) y con su propia serie, PRO/;
//   * se puede BORRAR. Si el tercero no la acepta, se borra y no queda rastro de
//     factura ninguna. Una fila en `invoices` no se borra nunca —habría que
//     anularla con una rectificativa, que es justo el rastro que no se quiere;
//   * no toca `OrderLine.invoicedInId` ni crea `invoiceTickets`: el pedido sigue
//     pendiente de facturar hasta que se emita la factura de verdad, con
//     `POST /:id/invoice`.
//
// El PDF no se guarda en disco: se genera en cada descarga a partir de las líneas
// congeladas en la tabla. Así no hay fichero que se quede desfasado ni que
// sobreviva al borrado de la proforma.
//
// Ver docs/factura-proforma.md.
import puppeteer from 'puppeteer';
import { aggregateOrderLines, convertBigIntToString, crearFactura } from './invoices.js';

// Mismos datos que la plantilla de factura (routes/invoices.js).
const VENDEDOR = {
    nombre: 'Gestiones y Apartamentos Úbeda S.L.',
    cif: 'B22837561',
    direccion: 'Carretera de Sabiote, 45',
    localidad: '23400 Úbeda',
    marca: 'Tinte y Burbuja',
};

const DIAS_VALIDEZ_POR_DEFECTO = 30;
const IVA = 21;

const ESTADOS_VIVOS = ['issued', 'accepted'];

function httpError(code, message) {
    const err = new Error(message);
    err.statusCode = code;
    return err;
}

const esVacio = (v) => v === null || v === undefined
    || (typeof v === 'string' && (v.trim() === '' || ['null', 'undefined'].includes(v.trim().toLowerCase())));

// Serie PRO/<año>/####. El contador vive en AppSettings y no en un MAX() sobre la
// tabla: una proforma borrada no debe devolver su número al mostrador. Que la
// aseguradora tenga dos documentos distintos numerados igual es peor que un hueco
// en una serie que no es fiscal. El INSERT ... ON CONFLICT lo hace atómico.
export async function nextProformaNum(tx, year = new Date().getFullYear()) {
    const key = `proforma_last_num_${year}`;
    const rows = await tx.$queryRaw`
        INSERT INTO "AppSettings" (key, value) VALUES (${key}, '1')
        ON CONFLICT (key) DO UPDATE SET value = (("AppSettings".value)::int + 1)::text
        RETURNING value`;
    const n = parseInt(rows[0].value, 10);
    return `PRO/${year}/${String(n).padStart(4, '0')}`;
}

// Lee los pedidos, valida y calcula el presupuesto. Mismo criterio de importe que
// crearFactura(), para que la factura que siga a la proforma cuadre con ella:
// si cubre todo lo facturable manda `order.total`; si sólo cubre líneas añadidas
// después, se suma desde las líneas.
async function presupuestar(prisma, orderIds) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        throw httpError(400, 'Debes indicar al menos un pedido.');
    }

    const ordersRaw = await prisma.order.findMany({
        where: { id: { in: orderIds } },
        include: { lines: { include: { product: true } } },
    });
    if (ordersRaw.length !== orderIds.length) {
        throw httpError(400, 'Algún pedido no existe.');
    }

    const cancelado = ordersRaw.find((o) => o.status === 'cancelled');
    if (cancelado) {
        throw httpError(400, `El pedido ${cancelado.orderNum} está cancelado.`);
    }

    const clientId = ordersRaw[0].clientId;
    if (!clientId) {
        throw httpError(400, 'El pedido no tiene cliente: una proforma va siempre a nombre de alguien.');
    }
    for (const o of ordersRaw) {
        if (o.clientId !== clientId) {
            throw httpError(400, 'Todos los pedidos deben ser del mismo cliente.');
        }
    }

    // Sólo se presupuesta lo que está pendiente de facturar y no anulado.
    const orders = ordersRaw.map((o) => ({
        ...o,
        lines: o.lines.filter((l) => l.invoicedInId === null && l.voidedAt === null),
    }));

    if (!orders.some((o) => o.lines.length > 0)) {
        throw httpError(400, 'No hay nada que presupuestar: el pedido ya está facturado por completo.');
    }

    const esCompleta = ordersRaw.every(
        (o) => o.lines.filter((l) => l.voidedAt === null).every((l) => l.invoicedInId === null)
    );

    const grouped = aggregateOrderLines(orders);
    const totalGross = esCompleta
        ? +orders.reduce((s, o) => s + Number(o.total || 0), 0).toFixed(2)
        : +grouped.reduce((s, g) => s + Number(g.grossAmount), 0).toFixed(2);

    if (!totalGross || totalGross <= 0) {
        throw httpError(400, 'No se puede presupuestar un importe de 0 €.');
    }

    const totalNet = +(totalGross / (1 + IVA / 100)).toFixed(2);
    const totalTax = +(totalGross - totalNet).toFixed(2);

    return { orders, clientId, grouped, totalGross, totalNet, totalTax };
}

// El documento se va a presentar ante un tercero, así que el cliente necesita
// ficha fiscal completa. Aquí el NIF sí es obligatorio: sin él la aseguradora no
// puede identificar al asegurado. (crearFactura no lo exige; una proforma para un
// siniestro, sí.)
async function validarCliente(prisma, clientId) {
    const client = await prisma.user.findUnique({
        where: { id: clientId },
        select: {
            firstName: true, lastName: true, denominacionsocial: true, tipopersona: true,
            nif: true, direccion: true, codigopostal: true, localidad: true,
            provincia: true, pais: true, email: true,
        },
    });
    if (!client) throw httpError(404, 'Cliente no encontrado.');

    const faltan = [];
    if (esVacio(client.denominacionsocial) && esVacio(client.firstName) && esVacio(client.lastName)) {
        faltan.push('nombre o denominación social');
    }
    if (esVacio(client.nif)) faltan.push('NIF');
    if (esVacio(client.direccion)) faltan.push('dirección');
    if (esVacio(client.codigopostal)) faltan.push('código postal');
    if (esVacio(client.localidad)) faltan.push('localidad');

    if (faltan.length) {
        throw httpError(400, `Para emitir la proforma faltan datos del cliente: ${faltan.join(', ')}.`);
    }
    return client;
}

const PROFORMA_INCLUDE = {
    client: true,
    lines: { orderBy: { position: 'asc' } },
    orders: { include: { order: { select: { id: true, orderNum: true, total: true, status: true } } } },
    invoice: { select: { id: true, number: true, issuedAt: true } },
    supersedes: { select: { id: true, number: true } },
};

function fechaValidez(validUntil, issuedAt) {
    if (validUntil) {
        const d = new Date(validUntil);
        if (isNaN(d.getTime())) throw httpError(400, 'Fecha de validez no válida.');
        return d;
    }
    const d = new Date(issuedAt);
    d.setDate(d.getDate() + DIAS_VALIDEZ_POR_DEFECTO);
    return d;
}

// Crea la proforma. `supersedesId` la marca como revisión de otra (vicio oculto,
// más trabajo del previsto): la anterior queda 'superseded'.
async function crearProforma(prisma, { orderIds, recipientName, recipientRef, validUntil, notes, createdBy, supersedesId = null }) {
    const { orders, clientId, grouped, totalGross, totalNet, totalTax } = await presupuestar(prisma, orderIds);
    await validarCliente(prisma, clientId);

    const issuedAt = new Date();
    const hasta = fechaValidez(validUntil, issuedAt);
    if (hasta < issuedAt) throw httpError(400, 'La validez no puede ser anterior a hoy.');

    const year = issuedAt.getFullYear();

    const creada = await prisma.$transaction(async (tx) => {
        const number = await nextProformaNum(tx, year);

        const p = await tx.proforma.create({
            data: {
                number,
                proformaYear: year,
                issuedAt,
                validUntil: hasta,
                clientId,
                recipientName: esVacio(recipientName) ? null : String(recipientName).trim(),
                recipientRef: esVacio(recipientRef) ? null : String(recipientRef).trim(),
                totalNet, totalTax, totalGross,
                status: 'issued',
                notes: esVacio(notes) ? null : String(notes).trim(),
                supersedesId,
                createdBy: createdBy ?? null,
            },
        });

        await tx.proformaLine.createMany({
            data: grouped.map((l) => ({
                proformaId: p.id,
                position: l.position,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discountPct: l.discountPct,
                taxRatePct: l.taxRatePct,
                netAmount: l.netAmount,
                taxAmount: l.taxAmount,
                grossAmount: l.grossAmount,
            })),
        });

        await tx.proformaOrder.createMany({
            data: orders.map((o) => ({ proformaId: p.id, orderId: o.id })),
        });

        if (supersedesId) {
            await tx.proforma.update({
                where: { id: supersedesId },
                data: { status: 'superseded', updatedAt: new Date() },
            });
        }

        return p;
    });

    return prisma.proforma.findUnique({ where: { id: creada.id }, include: PROFORMA_INCLUDE });
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (n) => Number(n || 0).toLocaleString('es-ES', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
}) + ' €';

const cantidad = (n) => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 3 });

const fechaES = (d) => (d ? new Date(d).toLocaleDateString('es-ES') : '');

function datosCliente(cliente) {
    const esFisica = (cliente?.tipopersona || '').toLowerCase().includes('fís');
    const nombre = esFisica
        ? `${cliente?.firstName || ''} ${cliente?.lastName || ''}`.trim()
        : (cliente?.denominacionsocial || `${cliente?.firstName || ''} ${cliente?.lastName || ''}`.trim());
    const direccion = [cliente?.direccion, cliente?.codigopostal, cliente?.localidad, cliente?.provincia, cliente?.pais]
        .filter(Boolean).join(', ');
    return {
        etiqueta: esFisica ? 'Nombre' : 'Denominación social',
        // Ojo: la plantilla de factura imprime `denominacionsocial` siempre; aquí
        // se usa el nombre calculado, que es correcto también para personas físicas.
        nombre: nombre || '—',
        nif: cliente?.nif || '',
        direccion,
    };
}

// Las condiciones no son decorativas: son lo que se acepta al aceptar el precio.
// Van en el documento, no en un correo aparte.
function condicionesHtml({ proforma, unidades }) {
    const hasta = fechaES(proforma.validUntil);
    const tercero = proforma.recipientName
        ? `su presentación ante ${esc(proforma.recipientName)}`
        : 'su presentación ante un tercero';
    const ref = proforma.recipientRef
        ? ` (referencia del expediente: <strong>${esc(proforma.recipientRef)}</strong>)`
        : '';

    return `
<ol class="cond">
  <li><strong>Naturaleza del documento.</strong> Esta factura proforma es un presupuesto
      detallado y no tiene valor fiscal: no es una factura a efectos del IVA, no la
      sustituye y no da derecho a deducción. La factura se emitirá una vez realizado
      el trabajo.</li>
  <li><strong>Validez.</strong> Los precios se mantienen hasta el <strong>${hasta}</strong>.
      Transcurrido ese plazo sin aceptación, las prendas podrán devolverse sin tratar
      o presupuestarse de nuevo con la tarifa vigente.</li>
  <li><strong>Recuento.</strong> ${unidades} unidades recibidas, relacionadas en el detalle.
      Lo que no figure en el detalle no está presupuestado.</li>
  <li><strong>Se factura el trabajo realizado.</strong> El importe corresponde al
      tratamiento aplicado a cada prenda y se factura una vez ejecutado,
      <strong>aunque el resultado no sea plenamente satisfactorio</strong>. En prendas
      afectadas por incendio, humo, agua u otros siniestros no puede garantizarse la
      eliminación total del olor, del hollín o de las manchas, ni la recuperación del
      color, del brillo o del tacto originales: el tratamiento se aplica sobre un tejido
      que llega ya dañado y su alcance depende del estado en que se recibe. La aceptación
      de esta proforma implica la conformidad con este punto.</li>
  <li><strong>Vicios ocultos y cambios en la previsión de trabajo.</strong> Lo presupuestado
      se calcula sobre lo que es apreciable en la recepción. Si al manipular o tratar una
      prenda aparece un defecto que no lo era —daños en el tejido, en el relleno o en el
      forro, quemaduras internas, costuras o adhesivos deteriorados, tintes inestables,
      composición distinta de la etiquetada, tratamientos anteriores incompatibles— o
      cualquier otra circunstancia que altere el trabajo previsto,
      <strong>se detendrá el tratamiento de esa prenda y se avisará al cliente antes de
      continuar</strong>, detallando el trabajo adicional y su importe. No se ejecutará ni
      se facturará ningún importe superior al de esta proforma sin una revisión aceptada.
      Si no se acepta, la prenda se devuelve en el estado en que se encuentre y se factura
      únicamente el trabajo ya realizado sobre ella.</li>
  <li><strong>Obligado al pago.</strong> Este documento se emite a nombre del cliente para
      ${tercero}${ref}. El obligado al pago frente a ${esc(VENDEDOR.nombre)} es el cliente,
      con independencia de que el importe sea reembolsado o abonado directamente por un
      tercero.</li>
</ol>`;
}

// Exportada para poder revisar el documento sin levantar un navegador.
export function buildProformaHtml({ proforma, cliente }) {
    const c = datosCliente(cliente);
    const unidades = (proforma.lines || []).reduce((s, l) => s + Number(l.quantity || 0), 0);

    const linesHtml = (proforma.lines || []).map((l) => `
        <tr>
          <td>${esc(l.description)}</td>
          <td class="num">${money(l.unitPrice)}</td>
          <td class="num">${cantidad(l.quantity)}</td>
          <td class="num">${cantidad(l.taxRatePct)}</td>
          <td class="num">${money(l.grossAmount)}</td>
        </tr>`).join('');

    const pedidos = (proforma.orders || []).map((po) => po.order?.orderNum).filter(Boolean).join(', ');

    return `
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Proforma ${esc(proforma.number)}</title>
<style>
*{ box-sizing:border-box; } html,body{ margin:0; padding:0; } @page{ size:A4; margin:10mm; }
body{ font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing: antialiased; color:#111827; font-size:12px; line-height:1.45; background:#fff; position:relative; }
.marca-agua{ position:fixed; top:38%; left:50%; transform:translate(-50%,-50%) rotate(-28deg); font-size:110px; font-weight:800; letter-spacing:8px; color:rgba(220,38,38,.07); white-space:nowrap; z-index:0; }
.wrapper{ position:relative; z-index:1; }
.header{ display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid #e5e7eb; padding-bottom:18px; margin-bottom:12px; gap:16px; }
.logo{ height:42px; width:auto; object-fit:contain; display:block; }
.seller{ text-align:right; font-size:12px; }
.seller .name{ font-weight:700; }
.doc-title{ font-size:20px; font-weight:800; letter-spacing:.5px; text-transform:uppercase; color:#0f172a; margin:6px 0 2px; }
.doc-warn{ display:inline-block; border:1px solid #dc2626; color:#b91c1c; background:#fff5f5; border-radius:6px; padding:8px 12px; font-size:11.5px; margin:8px 0 14px; }
.invoice-meta{ display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:10px 0; }
.meta-card{ border:1px solid #e5e7eb; border-radius:8px; padding:12px 14px; }
.meta-title{ font-size:12px; text-transform:uppercase; color:#6b7280; margin:0 0 6px; letter-spacing:.4px; }
.meta-grid{ display:grid; grid-template-columns:118px 1fr; row-gap:4px; column-gap:8px; font-size:12px; }
.label{ color:#6b7280; } .value{ font-weight:600; }
.section-title{ font-size:14px; font-weight:700; margin:16px 0 8px; }
table{ width:100%; border-collapse:collapse; }
thead th{ text-align:left; font-size:11px; padding:8px; background:#f8fafc; color:#374151; border-bottom:1px solid #e5e7eb; text-transform:uppercase; letter-spacing:.3px; }
tbody td{ font-size:11px; line-height:1.35; padding:6px 8px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
.num{ text-align:right; white-space:nowrap; }
.totals{ margin-top:16px; display:flex; justify-content:flex-end; }
.totals-table{ width:340px; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; }
.totals-table tr td{ padding:10px 14px; border-bottom:1px solid #e5e7eb; font-size:13px; }
.totals-table tr:last-child td{ border-bottom:none; }
.totals-table .strong{ font-weight:800; font-size:16px; color:#0b1220; }
.cond{ font-size:10.5px; color:#374151; padding-left:18px; margin:6px 0 0; }
.cond li{ margin-bottom:5px; text-align:justify; }
.notas{ margin-top:12px; border-left:3px solid #048ABF; padding:6px 10px; background:#f8fafc; font-size:11px; white-space:pre-wrap; }
.firma{ margin-top:22px; display:grid; grid-template-columns:1fr 1fr; gap:24px; font-size:11px; }
.firma .caja{ border:1px solid #e5e7eb; border-radius:8px; padding:10px 12px; height:78px; }
.urls{ margin-top:18px; text-align:center; font-size:11px; color:#0f172a; }
</style></head>
<body>
  <div class="marca-agua">PROFORMA</div>
  <div class="wrapper">
    <div class="header">
      <div>
        <img class="logo" src="https://app.tinteyburbuja.com/logo.png" alt="Logo" />
        <div class="doc-title">Factura proforma</div>
      </div>
      <div class="seller">
        <div class="name">${esc(VENDEDOR.nombre)}</div>
        <div>CIF: ${esc(VENDEDOR.cif)}</div>
        <div>${esc(VENDEDOR.direccion)}</div>
        <div>${esc(VENDEDOR.localidad)}</div>
      </div>
    </div>

    <div class="doc-warn">
      <strong>Documento sin valor fiscal.</strong> No es una factura a efectos del IVA ni la
      sustituye: es un presupuesto. La factura se emitirá una vez realizado el trabajo.
    </div>

    <div class="invoice-meta">
      <div class="meta-card">
        <div class="meta-title">Proforma</div>
        <div class="meta-grid">
          <div class="label">Número:</div><div class="value">${esc(proforma.number)}</div>
          <div class="label">Fecha:</div><div class="value">${fechaES(proforma.issuedAt)}</div>
          <div class="label">Válida hasta:</div><div class="value">${fechaES(proforma.validUntil)}</div>
          ${pedidos ? `<div class="label">Pedido:</div><div class="value">${esc(pedidos)}</div>` : ''}
          ${proforma.supersedes ? `<div class="label">Revisa:</div><div class="value">${esc(proforma.supersedes.number)}</div>` : ''}
        </div>
      </div>
      <div class="meta-card">
        <div class="meta-title">Cliente</div>
        <div class="meta-grid">
          <div class="label">${esc(c.etiqueta)}:</div><div class="value">${esc(c.nombre)}</div>
          <div class="label">NIF:</div><div class="value">${esc(c.nif)}</div>
          <div class="label">Dirección:</div><div class="value">${esc(c.direccion)}</div>
          ${proforma.recipientName ? `<div class="label">A presentar ante:</div><div class="value">${esc(proforma.recipientName)}</div>` : ''}
          ${proforma.recipientRef ? `<div class="label">Expediente:</div><div class="value">${esc(proforma.recipientRef)}</div>` : ''}
        </div>
      </div>
    </div>

    <div class="section-title">Detalle del presupuesto</div>
    <table>
      <thead>
        <tr>
          <th style="width:42%;">Descripción</th>
          <th class="num" style="width:14%;">Precio unitario</th>
          <th class="num" style="width:10%;">Cantidad</th>
          <th class="num" style="width:9%;">IVA (%)</th>
          <th class="num" style="width:13%;">Importe</th>
        </tr>
      </thead>
      <tbody>${linesHtml}</tbody>
    </table>

    <div class="totals">
      <table class="totals-table">
        <tr><td class="label">Base imponible</td><td class="num">${money(proforma.totalNet)}</td></tr>
        <tr><td class="label">IVA (${IVA} %)</td><td class="num">${money(proforma.totalTax)}</td></tr>
        <tr><td class="strong">Total presupuestado</td><td class="num strong">${money(proforma.totalGross)}</td></tr>
      </table>
    </div>

    ${proforma.notes ? `<div class="notas">${esc(proforma.notes)}</div>` : ''}

    <div class="section-title">Condiciones</div>
    ${condicionesHtml({ proforma, unidades: cantidad(unidades) })}

    <div class="firma">
      <div class="caja">
        <div class="label">Conforme (cliente)</div>
        <div style="margin-top:6px; color:#6b7280;">Fecha y firma</div>
      </div>
      <div class="caja">
        <div class="label">${esc(VENDEDOR.marca)}</div>
        <div style="margin-top:6px; color:#6b7280;">${fechaES(proforma.issuedAt)}</div>
      </div>
    </div>

    <div class="urls">https://www.tinteyburbuja.com</div>
  </div>
</body>
</html>`;
}

async function renderPdf(proforma) {
    const html = buildProformaHtml({ proforma, cliente: proforma.client || {} });
    const browser = await puppeteer.launch({
        headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        return await page.pdf({ format: 'A4', printBackground: true });
    } finally {
        await browser.close();
    }
}

// ─── Rutas ───────────────────────────────────────────────────────────────────

export default async function (fastify) {
    const prisma = fastify.prisma;

    const requireAdmin = (req, reply) => {
        if (req.user?.role !== 'admin') {
            reply.code(403).send({ error: 'Solo administradores' });
            return false;
        }
        return true;
    };

    const fallo = (reply, e, porDefecto) => {
        const code = e.statusCode || 500;
        if (code >= 500) console.error('[proformas]', e);
        return reply.code(code).send({ error: e.message || porDefecto });
    };

    // Emitir una proforma.
    // Body: { orderIds, recipientName?, recipientRef?, validUntil?, notes? }
    fastify.post('/', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const { orderIds } = req.body || {};

            // Una sola proforma en vigor por pedido: si hay más trabajo del
            // previsto, se revisa (POST /:id/revise), no se emite otra en paralelo.
            const enVigor = await prisma.proforma.findFirst({
                where: {
                    orders: { some: { orderId: { in: (orderIds || []).map(Number) } } },
                    status: { in: ESTADOS_VIVOS },
                },
                select: { number: true },
            });
            if (enVigor) {
                throw httpError(409, `El pedido ya tiene la proforma ${enVigor.number} en vigor. Revísala o bórrala antes de emitir otra.`);
            }

            const p = await crearProforma(prisma, {
                ...(req.body || {}),
                orderIds: (orderIds || []).map(Number),
                createdBy: req.user?.userId ?? null,
            });
            return reply.send(convertBigIntToString(p));
        } catch (e) {
            return fallo(reply, e, 'Error emitiendo la proforma.');
        }
    });

    // Revisión: aparece un vicio oculto o cambia la previsión de trabajo. Se
    // vuelve a presupuestar el pedido tal como está ahora y la anterior queda
    // 'superseded' (se conserva: es lo que el cliente ya tiene en la mano).
    fastify.post('/:id/revise', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const id = Number(req.params.id);
            const anterior = await prisma.proforma.findUnique({
                where: { id },
                include: { orders: true },
            });
            if (!anterior) throw httpError(404, 'Proforma no encontrada.');
            if (!ESTADOS_VIVOS.includes(anterior.status)) {
                throw httpError(400, `No se puede revisar una proforma en estado "${anterior.status}".`);
            }

            const p = await crearProforma(prisma, {
                orderIds: anterior.orders.map((o) => o.orderId),
                recipientName: req.body?.recipientName ?? anterior.recipientName,
                recipientRef: req.body?.recipientRef ?? anterior.recipientRef,
                validUntil: req.body?.validUntil ?? null,
                notes: req.body?.notes ?? anterior.notes,
                createdBy: req.user?.userId ?? null,
                supersedesId: anterior.id,
            });
            return reply.send(convertBigIntToString(p));
        } catch (e) {
            return fallo(reply, e, 'Error revisando la proforma.');
        }
    });

    // Listado. ?orderId= devuelve las del pedido (lo que usa la fila de Ventas).
    fastify.get('/', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const { orderId, clientId, status } = req.query || {};
            const where = {};
            if (orderId) where.orders = { some: { orderId: Number(orderId) } };
            if (clientId) where.clientId = Number(clientId);
            if (status) where.status = status;

            const proformas = await prisma.proforma.findMany({
                where, orderBy: { id: 'desc' }, include: PROFORMA_INCLUDE,
            });
            return reply.send(convertBigIntToString(proformas));
        } catch (e) {
            return fallo(reply, e, 'Error listando proformas.');
        }
    });

    fastify.get('/:id', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const p = await prisma.proforma.findUnique({
                where: { id: Number(req.params.id) }, include: PROFORMA_INCLUDE,
            });
            if (!p) throw httpError(404, 'Proforma no encontrada.');
            return reply.send(convertBigIntToString(p));
        } catch (e) {
            return fallo(reply, e, 'Error obteniendo la proforma.');
        }
    });

    // El PDF se genera al vuelo desde las líneas congeladas: nunca está desfasado
    // y no queda ningún fichero si la proforma se borra.
    fastify.get('/:id/pdf', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const p = await prisma.proforma.findUnique({
                where: { id: Number(req.params.id) }, include: PROFORMA_INCLUDE,
            });
            if (!p) throw httpError(404, 'Proforma no encontrada.');

            const pdf = await renderPdf(p);
            const nombre = `proforma_${p.number.replace(/\//g, '-')}.pdf`;
            reply.header('Content-Type', 'application/pdf');
            reply.header('Content-Disposition', `attachment; filename="${nombre}"`);
            return reply.send(Buffer.from(pdf));
        } catch (e) {
            return fallo(reply, e, 'Error generando el PDF de la proforma.');
        }
    });

    // Respuesta del destinatario: accepted | rejected. También permite retocar la
    // mención al tercero, la validez y las observaciones (el PDF se regenera solo).
    fastify.patch('/:id', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const id = Number(req.params.id);
            const p = await prisma.proforma.findUnique({ where: { id } });
            if (!p) throw httpError(404, 'Proforma no encontrada.');
            if (p.status === 'invoiced') throw httpError(400, 'La proforma ya está facturada.');

            const data = { updatedAt: new Date() };
            const { status, recipientName, recipientRef, validUntil, notes } = req.body || {};

            if (status !== undefined) {
                if (!['issued', 'accepted', 'rejected'].includes(status)) {
                    throw httpError(400, 'Estado no válido.');
                }
                data.status = status;
            }
            if (recipientName !== undefined) data.recipientName = esVacio(recipientName) ? null : String(recipientName).trim();
            if (recipientRef !== undefined) data.recipientRef = esVacio(recipientRef) ? null : String(recipientRef).trim();
            if (notes !== undefined) data.notes = esVacio(notes) ? null : String(notes).trim();
            if (validUntil !== undefined) data.validUntil = fechaValidez(validUntil, p.issuedAt);

            await prisma.proforma.update({ where: { id }, data });
            const actualizada = await prisma.proforma.findUnique({ where: { id }, include: PROFORMA_INCLUDE });
            return reply.send(convertBigIntToString(actualizada));
        } catch (e) {
            return fallo(reply, e, 'Error actualizando la proforma.');
        }
    });

    // Aceptada y trabajo hecho: se emite la factura de verdad sobre los mismos
    // pedidos y la proforma queda cerrada apuntando a ella.
    fastify.post('/:id/invoice', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const id = Number(req.params.id);
            const p = await prisma.proforma.findUnique({ where: { id }, include: { orders: true } });
            if (!p) throw httpError(404, 'Proforma no encontrada.');
            if (p.status === 'invoiced') throw httpError(400, 'La proforma ya está facturada.');
            if (!ESTADOS_VIVOS.includes(p.status)) {
                throw httpError(400, `No se puede facturar una proforma en estado "${p.status}".`);
            }

            const factura = await crearFactura(prisma, {
                orderIds: p.orders.map((o) => o.orderId),
                type: 'n',
            });

            await prisma.proforma.update({
                where: { id },
                data: { status: 'invoiced', invoiceId: BigInt(factura.id), updatedAt: new Date() },
            });

            const cerrada = await prisma.proforma.findUnique({ where: { id }, include: PROFORMA_INCLUDE });
            return reply.send(convertBigIntToString({ proforma: cerrada, invoice: factura }));
        } catch (e) {
            return fallo(reply, e, 'Error facturando la proforma.');
        }
    });

    // Borrado: el camino de "no queda rastro" cuando el destinatario no acepta.
    // Sólo se cierra una vez emitida la factura, que sí es un documento fiscal.
    fastify.delete('/:id', async (req, reply) => {
        if (!requireAdmin(req, reply)) return;
        try {
            const id = Number(req.params.id);
            const p = await prisma.proforma.findUnique({ where: { id } });
            if (!p) throw httpError(404, 'Proforma no encontrada.');
            if (p.status === 'invoiced') {
                throw httpError(400, 'No se puede borrar una proforma ya facturada: anula la factura con una rectificativa.');
            }

            await prisma.$transaction(async (tx) => {
                // Si era una revisión, la anterior vuelve a estar en vigor.
                if (p.supersedesId) {
                    await tx.proforma.update({
                        where: { id: p.supersedesId },
                        data: { status: 'issued', updatedAt: new Date() },
                    });
                }
                // Líneas y pivot caen por ON DELETE CASCADE (sql/030).
                await tx.proforma.delete({ where: { id } });
            });

            return reply.send({ deleted: true, number: p.number });
        } catch (e) {
            return fallo(reply, e, 'Error borrando la proforma.');
        }
    });
}
