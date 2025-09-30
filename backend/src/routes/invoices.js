// backend/src/routes/invoices.js
import { PrismaClient } from '@prisma/client';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

export default async function (fastify, opts) {
    const prisma = fastify.prisma || new PrismaClient();

    // Crear factura normal o simplificada
    fastify.post('/', async (req, reply) => {
        const { orderIds, type, invoiceData } = req.body; // type: 'normal' | 'simplificada'
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return reply.status(400).send({ error: 'Debes seleccionar al menos un pedido.' });
        }
        if (!['normal', 'simplificada'].includes(type)) {
            return reply.status(400).send({ error: 'Tipo de factura inválido.' });
        }
        // Obtener los pedidos
        const orders = await prisma.order.findMany({
            where: { id: { in: orderIds } },
            include: { client: true }
        });
        if (orders.length !== orderIds.length) {
            return reply.status(400).send({ error: 'Algún pedido no existe.' });
        }
        // Validar que todos los pedidos son del mismo cliente y mismo estado de pago y no facturados
        const clientId = orders[0].clientId;
        const paymentStatus = orders[0].paymentStatus;
        for (const o of orders) {
            if (o.clientId !== clientId) {
                return reply.status(400).send({ error: 'Todos los pedidos deben ser del mismo cliente.' });
            }
            if (o.paymentStatus !== paymentStatus) {
                return reply.status(400).send({ error: 'Todos los pedidos deben tener el mismo estado de pago.' });
            }
            if (o.invoiceId) {
                return reply.status(400).send({ error: `El pedido ${o.id} ya está facturado.` });
            }
        }
        // Calcular importes fiscales
        const totalGross = orders.reduce((sum, o) => sum + o.total, 0);
        const totalNet = +(totalGross / 1.21).toFixed(2);
        const totalTax = +(totalGross - totalNet).toFixed(2);

        // Crear la factura
        const invoice = await prisma.invoices.create({
            data: {
                // Rellena los campos obligatorios según tu modelo
                seriesId: invoiceData?.seriesId || 1,
                number: invoiceData?.number || undefined,
                invoiceYear: new Date().getFullYear(),
                issuedAt: new Date(),
                operationDate: new Date(),
                currency: 'EUR',
                sellerName: invoiceData?.sellerName || '',
                sellerTaxId: invoiceData?.sellerTaxId || '',
                sellerAddress: invoiceData?.sellerAddress || '',
                customerName: orders[0].client ? `${orders[0].client.firstName} ${orders[0].client.lastName}` : '',
                customerTaxId: orders[0].client?.taxId || '',
                customerAddress: orders[0].client?.address || '',
                totalNet,
                totalTax,
                totalGross,
                docStatus: 'draft',
                paymentStatus: paymentStatus || 'unpaid',
                isRectifying: false,
                notes: invoiceData?.notes || '',
            },
            include: { invoiceTickets: true }
        });

        // Vincular pedidos a la factura en la tabla puente invoiceTickets
        for (const o of orders) {
            await prisma.invoiceTickets.create({
                data: {
                    invoiceId: invoice.id,
                    ticketId: Number(o.id)
                }
            });
        }

        // Devuelve la factura con los pedidos vinculados
        const result = await prisma.invoices.findUnique({
            where: { id: invoice.id },
            include: {
                invoiceTickets: {
                    include: { order: true }
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
        const html = `
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; }
                    h1 { font-size: 24px; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { border: 1px solid #ccc; padding: 8px; }
                </style>
            </head>
            <body>
                <h1>Factura #${invoice.id}</h1>
                <p>Cliente: ${invoice.customerName}</p>
                <p>Fecha: ${new Date(invoice.issuedAt).toLocaleDateString()}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Pedido</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${result.invoiceTickets.map(t => `
                            <tr>
                                <td>${t.order.id}</td>
                                <td>${t.order.total.toFixed(2)} €</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <p>Base imponible: ${invoice.totalNet.toFixed(2)} €</p>
                <p>IVA: ${invoice.totalTax.toFixed(2)} €</p>
                <p><strong>Total: ${invoice.totalGross.toFixed(2)} €</strong></p>
            </body>
            </html>
        `;
        const browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.pdf({ path: pdfPath, format: 'A4' });
        await browser.close();

        // Añadir la ruta del PDF a la respuesta
        result.pdfPath = pdfPath;
        return convertBigIntToString(result);
    });

    // Crear factura rectificativa
    fastify.post('/rectificativa', async (req, reply) => {
        const { originalInvoiceId, rectificationData } = req.body;
        if (!originalInvoiceId) {
            return reply.status(400).send({ error: 'Debes indicar la factura original.' });
        }
        const original = await prisma.invoice.findUnique({ where: { id: originalInvoiceId }, include: { orders: true } });
        if (!original) {
            return reply.status(404).send({ error: 'Factura original no encontrada.' });
        }
        if (original.type === 'rectificativa') {
            return reply.status(400).send({ error: 'No se puede rectificar una factura rectificativa.' });
        }
        // Crear la factura rectificativa
        const rectificativa = await prisma.invoice.create({
            data: {
                clientId: original.clientId,
                type: 'rectificativa',
                date: new Date(),
                total: rectificationData?.total || 0,
                originalInvoiceId: original.id,
                ...rectificationData
            },
            include: { client: true }
        });
        // Marcar la original como rectificada (opcional: puedes añadir un campo en el modelo)
        await prisma.invoice.update({ where: { id: original.id }, data: { rectified: true } });
        return rectificativa;
    });

    // Obtener una factura
    fastify.get('/:id', async (req, reply) => {
        const { id } = req.params;
        const invoice = await prisma.invoice.findUnique({
            where: { id: Number(id) },
            include: { orders: true, client: true }
        });
        if (!invoice) return reply.status(404).send({ error: 'Factura no encontrada' });
        return invoice;
    });

    // Listar facturas
    fastify.get('/', async (req, reply) => {
        const { page = 0, size = 50 } = req.query;
        const pageNum = parseInt(page) || 0;
        const pageSize = parseInt(size) || 50;
        const skip = pageNum * pageSize;
        const total = await prisma.invoice.count();
        const invoices = await prisma.invoice.findMany({
            skip, take: pageSize,
            orderBy: { date: 'desc' },
            include: { client: true, orders: true }
        });
        return {
            data: invoices,
            meta: {
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

function convertBigIntToString(obj) {
    if (Array.isArray(obj)) {
        return obj.map(convertBigIntToString);
    } else if (obj && typeof obj === 'object') {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : convertBigIntToString(v)])
        );
    }
    return obj;
}
