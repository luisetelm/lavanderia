// backend/src/routes/invoices.js
import {PrismaClient} from '@prisma/client';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

export default async function (fastify, opts) {
    const prisma = fastify.prisma || new PrismaClient();

    // Crear factura normal o simplificada
    fastify.post('/', async (req, reply) => {
        const {orderIds, type, invoiceData} = req.body; // type: 'normal' | 'simplificada'
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return reply.status(400).send({error: 'Debes seleccionar al menos un pedido.'});
        }
        if (!['normal', 'simplificada'].includes(type)) {
            return reply.status(400).send({error: 'Tipo de factura inválido.'});
        }
        // Obtener los pedidos
        const orders = await prisma.order.findMany({
            where: {id: {in: orderIds}}, include: {client: true}
        });
        if (orders.length !== orderIds.length) {
            return reply.status(400).send({error: 'Algún pedido no existe.'});
        }
        // Validar que todos los pedidos son del mismo cliente y mismo estado de pago y no facturados
        const clientId = orders[0].clientId;
        const paid = orders[0].paid;

        for (const o of orders) {
            if (o.clientId !== clientId) {
                return reply.status(400).send({error: 'Todos los pedidos deben ser del mismo cliente.'});
            }
            if (o.paid !== paid) {
                return reply.status(400).send({error: 'Todos los pedidos deben tener el mismo estado de pago.'});
            }
            if (o.invoiceId) {
                return reply.status(400).send({error: `El pedido ${o.id} ya está facturado.`});
            }
        }
        // Calcular importes fiscales
        const totalGross = orders.reduce((sum, o) => sum + o.total, 0);
        const totalNet = +(totalGross / 1.21).toFixed(2);
        const totalTax = +(totalGross - totalNet).toFixed(2);

        // Copiar solo el id del cliente a la factura
        const client = orders[0].client;
        // Crear la factura
        const invoice = await prisma.invoices.create({
            data: {
                // Rellena los campos obligatorios según tu modelo
                number: await nextInvoiceNum(prisma),
                invoiceYear: new Date().getFullYear(),
                issuedAt: new Date(),
                operationDate: new Date(),
                currency: 'EUR',
                sellerName: invoiceData?.sellerName || '',
                sellerTaxId: invoiceData?.sellerTaxId || '',
                sellerAddress: invoiceData?.sellerAddress || '',
                clientId: client?.id,
                paid: paid,
                totalNet,
                totalTax,
                totalGross,
                docStatus: 'draft',
                isRectifying: false,
                notes: invoiceData?.notes || '',
            }, include: {invoiceTickets: true}
        });

        // Vincular pedidos a la factura en la tabla puente invoiceTickets
        for (const o of orders) {
            await prisma.invoiceTickets.create({
                data: {
                    invoiceId: invoice.id, ticketId: Number(o.id)
                }
            });
        }

        // Devuelve la factura con los pedidos vinculados y el cliente
        const result = await prisma.invoices.findUnique({
            where: {id: invoice.id},
            include: {
                User: true,
                invoiceTickets: {
                    include: {
                        order: {
                            include: {
                                lines: {
                                    include: {product: true}
                                }
                            }
                        }
                    }
                }
            }
        });

        // Generar PDF automáticamente
        const pdfDir = path.join(process.cwd(), 'invoices_pdfs');
        if (!fs.existsSync(pdfDir)) {
            fs.mkdirSync(pdfDir);
        }
        const pdfPath = path.join(pdfDir, `factura_${invoice.id}.pdf`);
        // Generar HTML simple para la factura

        const cliente = result.User || {};
        // Construir dirección completa en una sola línea
        const direccionCompleta = [
            cliente.direccion,
            cliente.codigopostal,
            cliente.localidad,
            cliente.provincia,
            cliente.pais
        ].filter(Boolean).join(', ');
        // Determinar etiqueta y valor de nombre
        const esFisica = (cliente.tipopersona || '').toLowerCase() === 'física';
        const etiquetaNombre = esFisica ? 'Nombre' : 'Denominación social';
        const valorNombre = esFisica
            ? ((cliente.firstName || '') + ' ' + (cliente.lastName || ''))
            : (cliente.denominacionsocial || ((cliente.firstName || '') + ' ' + (cliente.lastName || '')));
        const html = `
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Factura ${invoice.id}</title>
  <style>
    :root{
      --accent:#0f172a;
      --muted:#6b7280;
      --line:#e5e7eb;
      --ok:#16a34a;     /* verde */
      --warn:#dc2626;   /* rojo */
    }
    *{ box-sizing:border-box; }
    html,body{ margin:0; padding:0; }
    @page{ size:A4; margin:10mm; }
    body{
      font-family: Arial, Helvetica, sans-serif;
      -webkit-font-smoothing: antialiased;
      color:#111827; font-size:12px; line-height:1.45;
      background:#fff;
    }
    .header{ display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid var(--line); padding-bottom:18px; margin-bottom:18px; gap:16px; }
    .brand{ display:flex; align-items:center; gap:12px; }
    .brand .title{ font-weight:700; font-size:20px; letter-spacing:.5px; color:var(--accent); text-transform:uppercase; }
    .logo{ height:42px; width:auto; object-fit:contain; display:block; }
    .seller{ text-align:right; font-size:12px; color:#111827; }
    .seller .name{ font-weight:700; }
    .status-badge{ display:inline-block; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:700; line-height:1; border:1px solid currentColor; margin-top:6px; }
    .status-paid{ color:var(--ok); }
    .status-due{ color:var(--warn); }
    .invoice-meta{ display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:16px 0 10px; }
    .meta-card{ border:1px solid var(--line); border-radius:8px; padding:12px 14px; background:#fff; }
    .meta-title{ font-size:12px; text-transform:uppercase; color:var(--muted); margin:0 0 6px; letter-spacing:.4px;}
    .meta-grid{ display:grid; grid-template-columns:120px 1fr; row-gap:4px; column-gap:8px; font-size:12px; }
    .label{ color:var(--muted); }
    .value{ font-weight:600; color:#111827; }
    .section-title{ font-size:14px; font-weight:700; margin:18px 0 8px; color:#111827; }
    table{ width:100%; border-collapse:collapse; }
    thead th{ text-align:left; font-size:11px; padding:8px 8px; background:#f8fafc; color:#374151; border-bottom:1px solid var(--line); text-transform:uppercase; letter-spacing:.3px; }
    tbody td{ font-size:11px; line-height:1.35; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
    tfoot td{ padding:6px 8px; }
    .num{ text-align:right; white-space:nowrap; }
    .totals{ margin-top:16px; display:flex; justify-content:flex-end; }
    .totals-table{ width:380px; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
    .totals-table tr td{ padding:12px 14px; border-bottom:1px solid var(--line); font-size:13px; }
    .totals-table tr:last-child td{ border-bottom:none; }
    .totals-table .label{ color:#374151; }
    .totals-table .strong{ font-weight:800; font-size:16px; color:#0b1220; }
    .footnote{ margin-top:18px; font-size:11px; color:#4b5563; }
    .urls{
      position: fixed;
      left: 0;
      bottom: 0;
      width: 100vw;
      margin: 0;
      padding: 10px 0 8px 0;
      font-size: 12px;
      color: #0f172a;
      text-align: center;
      background: none;
      z-index: 100;
    }
    @media print{
      .urls{
        position: fixed;
        left: 0;
        bottom: 0;
        width: 100vw;
        margin: 0;
        padding: 10px 0 8px 0;
        font-size: 12px;
        color: #0f172a;
        text-align: center;
        background: none;
        z-index: 100;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <!-- Encabezado -->
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

    <!-- Meta factura + cliente -->
    <div class="invoice-meta">
      <div class="meta-card">
        <div class="meta-title">Factura</div>
        <div class="meta-grid">
          <div class="label">Número:</div>
          <div class="value">${invoice.number}</div>
          <div class="label">Fecha:</div>
          <div class="value">${
            invoice.createdAt
                ? (new Date(invoice.createdAt)).toLocaleDateString('es-ES')
                : (invoice.formattedDate ?? '')
        }</div>
        </div>
      </div>
      <div class="meta-card">
        <div class="meta-title">Cliente</div>
        <div class="meta-grid">
          <div class="label">${etiquetaNombre}:</div>
          <div class="value">${valorNombre}</div>
          <div class="label">NIF:</div>
          <div class="value">${cliente.nif ?? ''}</div>
          <div class="label">Dirección:</div>
          <div class="value">${direccionCompleta}</div>
        </div>
      </div>
    </div>

    <!-- Detalle -->
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
      <tbody>
        ${
            result.invoiceTickets.flatMap(t =>
                t.order.lines.map(item => {
                    const unit = Number(item.unitPrice || 0);
                    const qty = Number(item.quantity || 0);
                    const taxPct = (item.taxPercent ?? item.taxRate ?? invoice.taxPercent ?? invoice.taxRate ?? 21);
                    const lineTotal = unit * qty;
                    const money = n => n.toLocaleString('es-ES', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    }) + ' €';
                    const pct = n => Number(n ?? 0).toLocaleString('es-ES', {maximumFractionDigits: 2});
                    const desc = item.description ?? item.product?.name ?? ('Pedido ' + t.order.id);
                    return `
                <tr>
                  <td>${desc}</td>
                  <td class="num">${money(unit)}</td>
                  <td class="num">${qty}</td>
                  <td class="num">${pct(taxPct)}</td>
                  <td class="num">${money(lineTotal)}</td>
                </tr>`;
                })
            ).join('')
        }
      </tbody>
    </table>

    <!-- Totales -->
    <div class="totals">
      <table class="totals-table">
        <tr>
          <td class="label">Subtotal</td>
          <td class="num">${(invoice.totalNet ?? 0).toLocaleString('es-ES', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })} €</td>
        </tr>
        <tr>
          <td class="label">IVA total</td>
          <td class="num">${(invoice.totalTax ?? 0).toLocaleString('es-ES', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })} €</td>
        </tr>
        <tr>
          <td class="label">Retención total</td>
          <td class="num">${(invoice.totalWithholding ?? 0).toLocaleString('es-ES', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })} €</td>
        </tr>
        <tr>
          <td class="strong">Total</td>
          <td class="num strong">${
            (invoice.totalGross ?? ((invoice.totalNet ?? 0) + (invoice.totalTax ?? 0) - (invoice.totalWithholding ?? 0)))
                .toLocaleString('es-ES', {minimumFractionDigits: 2, maximumFractionDigits: 2})
        } €
          
          <div class="status-badge ${
            (invoice.status ?? (invoice.paid ? 'pagada' : 'pendiente'))
                .toString().toLowerCase().includes('pag')
                ? 'status-paid' : 'status-due'
        }">
          ${
            (invoice.status ?? (invoice.paid ? 'Pagada' : 'Pendiente'))
        }
        </div>
          
          
          </td>
        </tr>
      </table>
    </div>

    <!-- Mensaje de pago por transferencia si está pendiente -->
    ${((invoice.status ?? (invoice.paid ? 'pagada' : 'pendiente')).toString().toLowerCase().includes('pend'))
            ? `<div style="margin:18px 0 0 0; padding:12px 16px; border:1px solid #dc2626; border-radius:8px; background:#fff0f0; color:#b91c1c; font-size:13px;">
        <b>Factura pendiente de pago.</b> Realice una transferencia a la cuenta <b>ES3530670069313863613125</b> indicando en el concepto el número de factura: <b>${invoice.number}</b>.
      </div>`
            : ''}
    <!-- Nota / URLs -->
  </div>
  <div class="urls">https://www.tinteyburbuja.es</div>
</body>
</html>
`;


        //const browser = await puppeteer.launch({headless: 'new'});
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(html, {waitUntil: 'networkidle0'});
        await page.pdf({path: pdfPath, format: 'A4'});
        await browser.close();

        // Enviar email al cliente con la factura adjunta
        if (cliente.email) {
            // Configura tu transporte SMTP aquí
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.example.com',
                port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
                secure: false,
                auth: {
                    user: process.env.SMTP_USER || 'usuario@example.com',
                    pass: process.env.SMTP_PASS || 'contraseña',
                },
            });
            const mailOptions = {
                from: process.env.FROM_EMAIL || 'facturas@tudominio.com',
                to: cliente.email,
                subject: `Factura ${invoice.number} - Tinte y Burbuja`,
                text: `Estimado cliente,\n\nAdjuntamos la factura correspondiente a su pedido.\n\nGracias por confiar en nosotros.\n\nUn saludo,\nTinte y Burbuja`,
                attachments: [
                    {
                        filename: `factura_${invoice.id}.pdf`,
                        path: pdfPath,
                    },
                ],
            };
            try {
                await transporter.sendMail(mailOptions);
            } catch (err) {
                console.error('Error enviando email de factura:', err);
            }
        }
        // Añadir la ruta del PDF a la respuesta
        result.pdfPath = pdfPath;

        //Podemos añadir el resultado de transporter?

        return convertBigIntToString(result);
    });

    // Crear factura rectificativa
    fastify.post('/rectificativa', async (req, reply) => {
        const {originalInvoiceId, rectificationData} = req.body;
        if (!originalInvoiceId) {
            return reply.status(400).send({error: 'Debes indicar la factura original.'});
        }
        const original = await prisma.invoice.findUnique({where: {id: originalInvoiceId}, include: {orders: true}});
        if (!original) {
            return reply.status(404).send({error: 'Factura original no encontrada.'});
        }
        if (original.type === 'rectificativa') {
            return reply.status(400).send({error: 'No se puede rectificar una factura rectificativa.'});
        }
        // Crear la factura rectificativa
        const rectificativa = await prisma.invoice.create({
            data: {
                clientId: original.clientId,
                type: 'rectificativa',
                date: new Date(),
                total: rectificationData?.total || 0,
                originalInvoiceId: original.id, ...rectificationData
            }, include: {client: true}
        });
        // Marcar la original como rectificada (opcional: puedes añadir un campo en el modelo)
        await prisma.invoice.update({where: {id: original.id}, data: {rectified: true}});
        return rectificativa;
    });

    // Obtener una factura
    fastify.get('/:id', async (req, reply) => {
        const {id} = req.params;
        const invoice = await prisma.invoice.findUnique({
            where: {id: Number(id)}, include: {orders: true, client: true}
        });
        if (!invoice) return reply.status(404).send({error: 'Factura no encontrada'});
        return invoice;
    });

    // Listar facturas
    fastify.get('/', async (req, reply) => {
        const {page = 0, size = 50} = req.query;
        const pageNum = parseInt(page) || 0;
        const pageSize = parseInt(size) || 50;
        const skip = pageNum * pageSize;
        const total = await prisma.invoice.count();
        const invoices = await prisma.invoice.findMany({
            skip, take: pageSize, orderBy: {date: 'desc'}, include: {client: true, orders: true}
        });
        return {
            data: invoices, meta: {
                total,
                page: pageNum,
                size: pageSize,
                totalPages: Math.ceil(total / pageSize),
                hasNextPage: pageNum < Math.ceil(total / pageSize) - 1,
                hasPrevPage: pageNum > 0
            }
        };
    });
}

export async function nextInvoiceNum(prisma) {
    const year = new Date().getFullYear();
    // Buscar la última factura del año actual
    const lastInvoice = await prisma.invoices.findFirst({
        where: {
            number: {startsWith: `FAC/${year}/`},
        },
        orderBy: {
            id: 'desc',
        },
    });
    let nextNumber = 1;
    if (lastInvoice && lastInvoice.number) {
        // Extraer el número correlativo del string, asumiendo formato FAC/2025/0001
        const match = lastInvoice.number.match(/(\d{4})$/);
        if (match) {
            nextNumber = parseInt(match[1], 10) + 1;
        }
    }
    return `FAC/${year}/${String(nextNumber).padStart(4, '0')}`;
}

function convertBigIntToString(obj) {
    if (Array.isArray(obj)) {
        return obj.map(convertBigIntToString);
    } else if (obj && typeof obj === 'object') {
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : convertBigIntToString(v)]));
    }
    return obj;
}
