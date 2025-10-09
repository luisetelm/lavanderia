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

// Agrupa líneas de varios pedidos por productId (o descripción) y calcula totales formateados
function aggregateOrderLines(orders) {
    const map = new Map();
    for (const o of orders) {
        const lines = o.lines || [];
        for (const item of lines) {
            const key = item.productId != null ? `p:${item.productId}` : `d:${(item.description || item.product?.name || '').trim()}`;
            const unit = Number(item.unitPrice || 0);
            const qty = Number(item.quantity || 0);
            // intenta leer tax del propio item, si no, 21%
            const taxPct = Number(item.taxPercent ?? item.taxRate ?? 21);

            const existing = map.get(key) || {
                productId: item.productId ?? null,
                description: item.description ?? item.product?.name ?? `Pedido ${o.id}`,
                quantity: 0,
                gross: 0,
                taxPct,
            };

            existing.quantity += qty;
            existing.gross += unit * qty;
            // si las líneas tienen distintos IVA, mantén el primero encontrado
            map.set(key, existing);
        }
    }

    return Array.from(map.values()).map((g, idx) => {
        const tax = Number(g.taxPct || 21);
        const quantity = Number(g.quantity || 0);
        const gross = Number(g.gross || 0);
        const unitPrice = quantity ? gross / quantity : 0;
        const net = gross / (1 + tax / 100);
        const taxAmount = gross - net;

        return {
            position: idx + 1,
            description: g.description,
            quantity: quantity.toFixed(3),           // Decimal(12,3)
            unitPrice: unitPrice.toFixed(4),         // Decimal(12,4)
            discountPct: '0.00',                     // por defecto
            taxRatePct: tax.toFixed(2),              // Decimal(5,2)
            netAmount: net.toFixed(2),               // Decimal(12,2)
            taxAmount: taxAmount.toFixed(2),         // Decimal(12,2)
            grossAmount: gross.toFixed(2),           // Decimal(12,2)
            productId: g.productId,
        };
    });
}

export async function crearFactura(prisma, {orderIds, type, invoiceData}) {


    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        throw httpError(400, 'Debes seleccionar al menos un pedido.');
    }
    if (!['n', 's'].includes(type)) {
        throw httpError(400, 'Tipo de factura inválido.');
    }

    // Si alguno de los OrderIds ya está en la tabla de facturas, no se puede facturar
    const existingInvoice = await prisma.invoiceTickets.findFirst({
        where: {
            ticketId: {in: orderIds}
        }
    });


    if (existingInvoice) {
        throw httpError(400, 'Algún pedido ya está facturado.');
    }

    // 1) Obtener pedidos
    const orders = await prisma.order.findMany({
        where: {id: {in: orderIds}},
        include: {
            lines: {include: {product: true}}, // si tus líneas están en order.lines
        },
    });

    if (orders.length !== orderIds.length) {
        throw httpError(400, 'Algún pedido no existe.');
    }

    // 2) Validaciones de coherencia0.
    const clientId = orders[0].clientId;

    // Tenemos que comprobar que el cliente  tiene los datos necesarios para la factura, y no vale el valor null
    const client = await prisma.User.findUnique({
        where: {id: clientId},
        select: {
            firstName: true,
            lastName: true,
            denominacionsocial: true,
            email: true,
            tipopersona: true,
            direccion: true,
            codigopostal: true,
            localidad: true,
        }
    });

    if (!client) {
        throw httpError(404, 'Cliente no encontrado.');
    }

    // Log inmediato para depuración: muestra el objeto cliente tal como lo devuelve Prisma
    console.log('[crearFactura] cliente recuperado:', JSON.stringify(client));

    // Helper robusto para detectar valores vacíos o inválidos
    const isEmpty = (v) => v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || v.trim().toLowerCase() === 'null' || v.trim().toLowerCase() === 'undefined'));

    // Validación explícita: email obligatorio + (denominación social o nombre) + dirección completa
    const missing = [];
    if (isEmpty(client.email)) missing.push('email');

    const hasDenom = !isEmpty(client.denominacionsocial);
    const hasName = !isEmpty(client.firstName) || !isEmpty(client.lastName);
    if (!hasDenom && !hasName) missing.push('nombre o denominación social');

    if (isEmpty(client.direccion)) missing.push('direccion');
    if (isEmpty(client.codigopostal)) missing.push('codigopostal');
    if (isEmpty(client.localidad)) missing.push('localidad');

    // Log de depuración: muestra el cliente y los campos detectados como vacíos
    if (missing.length > 0) {
        // Uso console.log para asegurar visibilidad en stdout
        console.log('[crearFactura] Validación cliente - valores recibidos:', client);
        console.log('[crearFactura] Validación cliente - campos faltantes detectados:', missing);
        throw httpError(400, `El cliente debe tener los campos obligatorios para la factura: ${missing.join(', ')}`);
    }


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

                // Crear invoiceLines agrupadas por producto (una línea por producto con cantidades y totales sumados)
                const grouped = aggregateOrderLines(orders);
                for (const line of grouped) {
                    await tx.invoiceLines.create({
                        data: {
                            invoiceId: inv.id,
                            position: line.position,
                            description: line.description,
                            quantity: line.quantity,
                            unitPrice: line.unitPrice,
                            discountPct: line.discountPct,
                            taxRatePct: line.taxRatePct,
                            netAmount: line.netAmount,
                            taxAmount: line.taxAmount,
                            grossAmount: line.grossAmount,
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
            User: true,
            invoiceLines: true,
            invoiceTickets: {
                include: {
                    order: {include: {lines: {include: {product: true}}}}
                }
            }
        },
    });


    if (type === 'n') { // RENDER DE LA FACTURA NORMAL

        // 6) Generar PDF
        const pdfDir = path.join(process.cwd(), 'invoices_pdfs');
        if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, {recursive: true});
        const pdfFilename = `factura_${invoice.id}.pdf`;
        const pdfPath = path.join(pdfDir, pdfFilename);

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
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            await page.setContent(html, {waitUntil: 'load'});
            await page.pdf({path: pdfPath, format: 'A4', printBackground: true});
        } finally {
            await browser.close();
        }

        // 7) Email (si hay email y SMTP correctamente configurado)
        // Envío "best-effort": si falla el email no rompemos la creación de la factura
        let emailSent = false;
        let emailError = null;
        if (cliente.email) {
            const {SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL} = process.env;
            if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) {
                console.warn('SMTP no configurado, no se enviará email de factura.');
                emailError = 'SMTP not configured';
            } else {
                const transporter = nodemailer.createTransport({
                    host: SMTP_HOST,
                    port: parseInt(SMTP_PORT, 10),
                    secure: Number(SMTP_PORT) === 465,
                    auth: {user: SMTP_USER, pass: SMTP_PASS},
                });
                try {
                    // Verifica conexión/configuración con el servidor SMTP
                    await transporter.verify();
                } catch (err) {
                    console.error('[crearFactura] SMTP verify failed:', err && err.message ? err.message : err);
                    emailError = `SMTP verify failed: ${err && err.message ? err.message : String(err)}`;
                }

                if (!emailError) {
                    try {
                        await transporter.sendMail({
                            from: FROM_EMAIL,
                            to: [cliente.email, 'hola@tinteyburbuja.es'],
                            subject: `Factura ${result.number} - Tinte y Burbuja`,
                            text: `Estimado cliente,\n\nAdjuntamos la factura correspondiente a su pedido.\n\nGracias por confiar en nosotros.\n\nUn saludo,\nTinte y Burbuja`,
                            attachments: [{filename: pdfFilename, path: pdfPath}],
                        });
                        emailSent = true;
                    } catch (err) {
                        console.error('[crearFactura] Error enviando email:', err && err.message ? err.message : err);
                        emailError = `sendMail failed: ${err && err.message ? err.message : String(err)}`;
                    }
                }
            }
        } else {
            emailError = 'No cliente email';
        }

    }

    // Adjuntamos info sobre email al resultado para que el frontend pueda mostrar un mensaje
    const output = {...convertBigIntToString(result), meta: {emailSent: !!emailSent, emailError: emailError}};
    return output;
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

    // Si existen invoiceLines (agrupadas por producto), renderízalas directamente.
    // En caso contrario, como fallback, recorremos invoiceTickets -> order.lines.
    let linesHtml = '';
    if (Array.isArray(invoice.invoiceLines) && invoice.invoiceLines.length > 0) {
        linesHtml = invoice.invoiceLines.map((line) => {
            const unit = Number(line.unitPrice || 0);
            const qty = Number(line.quantity || 0);
            const taxPct = Number(line.taxRatePct ?? 21);
            const lineTotal = Number(line.grossAmount || unit * qty || 0);
            const desc = line.description || '';
            return `
        <tr>
          <td>${desc}</td>
          <td class="num">${money(unit)}</td>
          <td class="num">${qty}</td>
          <td class="num">${pct(taxPct)}</td>
          <td class="num">${money(lineTotal)}</td>
        </tr>`;
        }).join('');
    } else if (Array.isArray(invoice.invoiceTickets)) {
        linesHtml = invoice.invoiceTickets.flatMap((t) => {
            const order = t.order || {};
            const lines = order.lines || [];
            return lines.map((item) => {
                const unit = Number(item.unitPrice || 0);
                const qty = Number(item.quantity || 0);
                const taxPct = (item.taxPercent ?? item.taxRate ?? invoice.taxPercent ?? invoice.taxRate ?? 21);
                const lineTotal = unit * qty;
                const desc = item.description ?? item.product?.name ?? ('Pedido ' + (order.id ?? ''));
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
    }

    // (Tu CSS/HTML original aquí… recortado por brevedad)
    return `
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Factura ${invoice.number}</title>
<style> :root{ --accent:#0f172a; --muted:#6b7280; --line:#e5e7eb; --ok:#16a34a; /* verde */ --warn:#dc2626; /* rojo */ } *{ box-sizing:border-box; } html,body{ margin:0; padding:0; } @page{ size:A4; margin:10mm; } body{ font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing: antialiased; color:#111827; font-size:12px; line-height:1.45; background:#fff; } .header{ display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid var(--line); padding-bottom:18px; margin-bottom:18px; gap:16px; } .brand{ display:flex; align-items:center; gap:12px; } .brand .title{ font-weight:700; font-size:20px; letter-spacing:.5px; color:var(--accent); text-transform:uppercase; } .logo{ height:42px; width:auto; object-fit:contain; display:block; } .seller{ text-align:right; font-size:12px; color:#111827; } .seller .name{ font-weight:700; } .status-badge{ display:inline-block; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:700; line-height:1; border:1px solid currentColor; margin-top:6px; } .status-paid{ color:var(--ok); } .status-due{ color:var(--warn); } .invoice-meta{ display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:16px 0 10px; } .meta-card{ border:1px solid var(--line); border-radius:8px; padding:12px 14px; background:#fff; } .meta-title{ font-size:12px; text-transform:uppercase; color:var(--muted); margin:0 0 6px; letter-spacing:.4px;} .meta-grid{ display:grid; grid-template-columns:120px 1fr; row-gap:4px; column-gap:8px; font-size:12px; } .label{ color:var(--muted); } .value{ font-weight:600; color:#111827; } .section-title{ font-size:14px; font-weight:700; margin:18px 0 8px; color:#111827; } table{ width:100%; border-collapse:collapse; } thead th{ text-align:left; font-size:11px; padding:8px 8px; background:#f8fafc; color:#374151; border-bottom:1px solid var(--line); text-transform:uppercase; letter-spacing:.3px; } tbody td{ font-size:11px; line-height:1.35; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; } tfoot td{ padding:6px 8px; } .num{ text-align:right; white-space:nowrap; } .totals{ margin-top:16px; display:flex; justify-content:flex-end; } .totals-table{ width:380px; border:1px solid var(--line); border-radius:10px; overflow:hidden; } .totals-table tr td{ padding:12px 14px; border-bottom:1px solid var(--line); font-size:13px; } .totals-table tr:last-child td{ border-bottom:none; } .totals-table .label{ color:#374151; } .totals-table .strong{ font-weight:800; font-size:16px; color:#0b1220; } .footnote{ margin-top:18px; font-size:11px; color:#4b5563; } .urls{ position: fixed; left: 0; bottom: 0; width: 100vw; margin: 0; padding: 10px 0 8px 0; font-size: 12px; color: #0f172a; text-align: center; background: none; z-index: 100; } @media print{ .urls{ position: fixed; left: 0; bottom: 0; width: 100vw; margin: 0; padding: 10px 0 8px 0; font-size: 12px; color: #0f172a; text-align: center; background: none; z-index: 100; } } </style></head>
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
          <div class="label">${cliente.etiquetaNombre}:</div><div class="value">${cliente.denominacionsocial}</div>
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
                where: {id: Number(id)}, include: {
                    User: true,
                    invoiceLines: true,
                    invoiceTickets: {
                        include: {
                            order: {include: {lines: {include: {product: true}}}}
                        }
                    }
                }
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
                skip, take: pageSize, orderBy: {issuedAt: 'desc'}, include: {User: true, invoiceTickets: true},
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
