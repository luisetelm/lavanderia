// backend/src/routes/invoices.js
import {PrismaClient} from '@prisma/client';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

// --- helpers ---
function httpError(code, message) {
    const err = new Error(message);
    err.statusCode = code;
    return err;
}

export async function crearFactura(prisma, {orderIds, type, invoiceData}) {


    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        throw httpError(400, 'Debes seleccionar al menos un pedido.');
    }
    if (!['n', 's'].includes(type)) {
        throw httpError(400, 'Tipo de factura inválido.');
    }

    // 1) Obtener pedidos
    const orders = await prisma.order.findMany({
        where: {id: {in: orderIds}}, include: {
            client: true, lines: {include: {product: true}}, // si tus líneas están en order.lines
        },
    });
    if (orders.length !== orderIds.length) {
        throw httpError(400, 'Algún pedido no existe.');
    }

    // 2) Validaciones de coherencia0.
    const clientId = orders[0].clientId;

    let paid;

    if (type === 's') {
        paid = true;
    } else {
        paid = orders[0].paid;
        for (const o of orders) {
            if (o.clientId !== clientId) {
                throw httpError(400, 'Todos los pedidos deben ser del mismo cliente.');
            }
            if (o.paid !== paid) {
                throw httpError(400, 'Todos los pedidos deben tener el mismo estado de pago.');
            }
            if (o.invoiceId) {
                throw httpError(400, `El pedido ${o.id} ya está facturado.`);
            }
        }
    }

    // 3) Cálculo de importes (simple: 21% sobre total bruto)
    const totalGross = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const totalNet = +(totalGross / 1.21).toFixed(2);
    const totalTax = +(totalGross - totalNet).toFixed(2);

    // 4) Crear factura + vínculos en una transacción
    const year = new Date().getFullYear();
    const invoice = await prisma.$transaction(async (tx) => {
        // número único con reintento (requiere UNIQUE en Invoice.number)
        let num;
        for (let i = 0; i < 5; i++) {
            num = await nextInvoiceNum(tx, year);
            try {
                const inv = await tx.invoices.create({
                    data: {
                        number: num,
                        invoiceYear: year,
                        issuedAt: new Date(),
                        operationDate: new Date(),
                        currency: 'EUR',
                        sellerName: invoiceData?.sellerName || '',
                        sellerTaxId: invoiceData?.sellerTaxId || '',
                        sellerAddress: invoiceData?.sellerAddress || '',
                        clientId,
                        paid,
                        totalNet,
                        totalTax,
                        totalGross,
                        docStatus: 'draft',
                        isRectifying: false,
                        notes: invoiceData?.notes || '',
                        type, // guarda el tipo
                    },
                });

                // pivot: asegúrate de que los nombres de columnas coincidan con tu schema
                for (const o of orders) {
                    await tx.invoiceTickets.create({
                        data: {
                            invoiceId: inv.id, ticketId: o.id, // <-- si tu pivot usa orderId (no ticketId)
                        },
                    });
                }
                return inv;
            } catch (e) {
                // Si es colisión de UNIQUE en number, reintenta
                if (e.code === 'P2002') continue;
                throw e;
            }
        }
        throw httpError(409, 'No se pudo generar un número de factura único.');
    });

    // 5) Cargar factura completa para el render
    const result = await prisma.invoices.findUnique({
        where: {id: invoice.id}, include: {
            User: true,                 // usa "client", no "User"
            invoiceTickets: {
                include: {
                    order: {
                        include: {
                            lines: {include: {product: true}},
                        },
                    },
                },
            },
        },
    });


    if (type === 'n') { // RENDER DE LA FACTURA NORMAL

        // 6) Generar PDF
        const pdfDir = path.join(process.cwd(), 'invoices_pdfs');
        if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, {recursive: true});
        const pdfFilename = `factura_${invoice.id}.pdf`;
        const pdfPath = path.join(pdfDir, pdfFilename);
        const publicUrl = `/invoices/pdf/${pdfFilename}`; // <- lo que sirves por la ruta protegida

        const cliente = result.client || {};
        const direccionCompleta = [cliente.direccion, cliente.codigopostal, cliente.localidad, cliente.provincia, cliente.pais,].filter(Boolean).join(', ');

        const esFisica = (cliente.tipopersona || '').toLowerCase().includes('fís');
        const etiquetaNombre = esFisica ? 'Nombre' : 'Denominación social';
        const valorNombre = esFisica ? `${cliente.firstName || ''} ${cliente.lastName || ''}`.trim() : (cliente.denominacionsocial || `${cliente.firstName || ''} ${cliente.lastName || ''}`.trim());

        const html = buildInvoiceHtml({
            invoice: result, cliente: {...cliente, direccionCompleta, etiquetaNombre, valorNombre}
        });

        //const browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox','--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            await page.setContent(html, {waitUntil: 'load'});
            await page.pdf({path: pdfPath, format: 'A4', printBackground: true});
        } finally {
            await browser.close();
        }

        // 7) Email (si hay email y SMTP correctamente configurado)
        if (cliente.email) {
            const {SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL} = process.env;
            if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) {
                // registra pero no revienta el flujo
                console.warn('SMTP no configurado, no se enviará email de factura.');
            } else {
                const transporter = nodemailer.createTransport({
                    host: SMTP_HOST,
                    port: parseInt(SMTP_PORT, 10),
                    secure: Number(SMTP_PORT) === 465,
                    auth: {user: SMTP_USER, pass: SMTP_PASS},
                });
                await transporter.sendMail({
                    from: FROM_EMAIL,
                    to: cliente.email,
                    subject: `Factura ${result.number} - Tinte y Burbuja`,
                    text: `Estimado cliente,\n\nAdjuntamos la factura correspondiente a su pedido.\n\nGracias por confiar en nosotros.\n\nUn saludo,\nTinte y Burbuja`,
                    attachments: [{filename: pdfFilename, path: pdfPath}],
                });
            }
        }

    }

    return {...convertBigIntToString(result)};
}

// Mantén tu convertBigIntToString tal cual
function convertBigIntToString(obj) {
    if (Array.isArray(obj)) return obj.map(convertBigIntToString);
    if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : convertBigIntToString(v)]));
    return obj;
}

// Generador de HTML, usa issuedAt de la factura
function buildInvoiceHtml({invoice, cliente}) {
    const money = (n) => Number(n || 0).toLocaleString('es-ES', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    }) + ' €';
    const pct = (n) => Number(n ?? 0).toLocaleString('es-ES', {maximumFractionDigits: 2});
    const issuedStr = invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleDateString('es-ES') : '';

    const paidStatus = (invoice.status ?? (invoice.paid ? 'Pagada' : 'Pendiente')).toString();
    const isPaid = paidStatus.toLowerCase().includes('pag');

    const linesHtml = invoice.invoiceTickets.flatMap((t) => {
        return t.order.lines.map((item) => {
            const unit = Number(item.unitPrice || 0);
            const qty = Number(item.quantity || 0);
            const taxPct = (item.taxPercent ?? item.taxRate ?? invoice.taxPercent ?? invoice.taxRate ?? 21);
            const lineTotal = unit * qty;
            const desc = item.description ?? item.product?.name ?? ('Pedido ' + t.order.id);
            return `
        <tr>
          <td>${desc}</td>
          <td class="num">${money(unit)}</td>
          <td class="num">${qty}</td>
          <td class="num">${pct(taxPct)}</td>
          <td class="num">${money(lineTotal)}</td>
        </tr>`;
        });
    }).join('');

    // (Tu CSS/HTML original aquí… recortado por brevedad)
    return `
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Factura ${invoice.number}</title>
<style>/* … tu CSS exactamente como lo tenías … */</style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="brand">
        <img class="logo" src="https://app.tinteyburbuja.es/logo.png" alt="Logo" />
      </div>
      <div class="seller">
        <div class="name">Gestiones y Apartamentos Úbeda S.L.</div>
        <div>CIF: B22837561</div>
        <div>Carretera de Sabiote, 45</div>
        <div>23400 Úbeda</div>
      </div>
    </div>

    <div class="invoice-meta">
      <div class="meta-card">
        <div class="meta-title">Factura</div>
        <div class="meta-grid">
          <div class="label">Número:</div><div class="value">${invoice.number}</div>
          <div class="label">Fecha:</div><div class="value">${issuedStr}</div>
        </div>
      </div>
      <div class="meta-card">
        <div class="meta-title">Cliente</div>
        <div class="meta-grid">
          <div class="label">${cliente.etiquetaNombre}:</div><div class="value">${cliente.valorNombre}</div>
          <div class="label">NIF:</div><div class="value">${cliente.nif ?? ''}</div>
          <div class="label">Dirección:</div><div class="value">${cliente.direccionCompleta}</div>
        </div>
      </div>
    </div>

    <div class="section-title">Detalle de la factura</div>
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
        <tr><td class="label">Subtotal</td><td class="num">${money(invoice.totalNet)}</td></tr>
        <tr><td class="label">IVA total</td><td class="num">${money(invoice.totalTax)}</td></tr>
        <tr><td class="label">Retención total</td><td class="num">${money(invoice.totalWithholding ?? 0)}</td></tr>
        <tr>
          <td class="strong">Total</td>
          <td class="num strong">
            ${money(invoice.totalGross ?? ((invoice.totalNet ?? 0) + (invoice.totalTax ?? 0) - (invoice.totalWithholding ?? 0)))}
            <div class="status-badge ${isPaid ? 'status-paid' : 'status-due'}">${paidStatus}</div>
          </td>
        </tr>
      </table>
    </div>

    ${!isPaid ? `<div style="margin:18px 0 0 0; padding:12px 16px; border:1px solid #dc2626; border-radius:8px; background:#fff0f0; color:#b91c1c; font-size:13px;">
      <b>Factura pendiente de pago.</b> Realice una transferencia a la cuenta <b>ES3530670069313863613125</b> indicando en el concepto el número de factura: <b>${invoice.number}</b>.
    </div>` : ''}

  </div>
  <div class="urls">https://www.tinteyburbuja.es</div>
</body>
</html>`;
}

// Genera el siguiente número (usa el año pasado como arg)
export async function nextInvoiceNum(prisma, year = new Date().getFullYear()) {
    const lastInvoice = await prisma.invoices.findFirst({
        where: {number: {startsWith: `FAC/${year}/`}}, orderBy: {id: 'desc'}, select: {number: true},
    });
    let nextNumber = 1;
    if (lastInvoice?.number) {
        const match = lastInvoice.number.match(/(\d{4})$/);
        if (match) nextNumber = parseInt(match[1], 10) + 1;
    }
    return `FAC/${year}/${String(nextNumber).padStart(4, '0')}`;
}

export default async function (fastify) {
    const prisma = fastify.prisma || new PrismaClient();

    // Crear factura normal o simplificada
    fastify.post('/', async (req, reply) => {
        try {
            const {orderIds, type, invoiceData} = req.body;
            const factura = await crearFactura(prisma, {orderIds, type, invoiceData});
            return reply.send(factura);
        } catch (e) {
            const code = e.statusCode || 500;
            return reply.code(code).send({error: e.message || 'Error creando la factura.'});
        }
    });

    // Crear factura rectificativa
    fastify.post('/rectificativa', async (req, reply) => {
        try {
            const {originalInvoiceId, rectificationData} = req.body;
            if (!originalInvoiceId) throw httpError(400, 'Debes indicar la factura original.');

            const original = await prisma.invoices.findUnique({
                where: {id: Number(originalInvoiceId)},
            });
            if (!original) throw httpError(404, 'Factura original no encontrada.');
            if (original.type === 'rectificativa') {
                throw httpError(400, 'No se puede rectificar una factura rectificativa.');
            }

            const rectificativa = await prisma.invoices.create({
                data: {
                    clientId: original.clientId,
                    type: 'rectificativa',
                    issuedAt: new Date(),
                    operationDate: new Date(),
                    currency: original.currency || 'EUR',
                    originalInvoiceId: original.id, ...rectificationData,
                },
            });

            await prisma.invoices.update({where: {id: original.id}, data: {rectified: true}});
            return reply.send(convertBigIntToString(rectificativa));
        } catch (e) {
            const code = e.statusCode || 500;
            return reply.code(code).send({error: e.message || 'Error creando la factura rectificativa.'});
        }
    });

    // Obtener una factura
    fastify.get('/:id', async (req, reply) => {
        try {
            const {id} = req.params;
            const invoice = await prisma.invoices.findUnique({
                where: {id: Number(id)}, include: {client: true, invoiceTickets: true},
            });
            if (!invoice) return reply.code(404).send({error: 'Factura no encontrada'});
            return reply.send(convertBigIntToString(invoice));
        } catch {
            return reply.code(500).send({error: 'Error obteniendo la factura'});
        }
    });

    // Listar facturas
    fastify.get('/', async (req, reply) => {
        try {
            const pageNum = parseInt(req.query.page ?? 0, 10) || 0;
            const pageSize = parseInt(req.query.size ?? 50, 10) || 50;
            const skip = pageNum * pageSize;
            const total = await prisma.invoices.count();
            const invoices = await prisma.invoices.findMany({
                skip, take: pageSize, orderBy: {issuedAt: 'desc'}, include: {client: true, invoiceTickets: true},
            });
            return reply.send({
                data: convertBigIntToString(invoices), meta: {
                    total,
                    page: pageNum,
                    size: pageSize,
                    totalPages: Math.ceil(total / pageSize),
                    hasNextPage: pageNum < Math.ceil(total / pageSize) - 1,
                    hasPrevPage: pageNum > 0,
                },
            });
        } catch {
            return reply.code(500).send({error: 'Error listando facturas'});
        }
    });

    // Descargar PDF (protegido con JWT a tu gusto)
    fastify.get('/pdf/:filename', async (request, reply) => {
        const {filename} = request.params;
        if (!/^factura_\d+\.pdf$/.test(filename)) {
            return reply.code(400).send({error: 'Nombre de archivo inválido'});
        }
        const filePath = path.join(process.cwd(), 'invoices_pdfs', filename);
        if (!fs.existsSync(filePath)) {
            return reply.code(404).send({error: 'Archivo no encontrado'});
        }
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        return reply.send(fs.createReadStream(filePath));
    });
}
