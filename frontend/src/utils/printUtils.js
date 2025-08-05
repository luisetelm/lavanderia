// configuración mínima de QZ Tray
async function connectQZ() {
    if (qz.websocket.isActive()) return;
    try {
        await qz.websocket.connect();
        // opcional: verificar firma/seguridad si usas certificados
        // qz.security.setCertificate(...);
        // qz.security.setSignaturePromise(...);
    } catch (e) {
        console.error('Error conectando a QZ Tray:', e);
        throw e;
    }
}

function buildRawHtml(htmlContent) {
    // QZ puede imprimir HTML mediante “qz.print” con tipo 'html'
    return [
        {
            type: 'html',
            format: 'plain',
            data: htmlContent,
        },
    ];
}

async function sendToPrinter(printerName, data, options = {}) {
    await connectQZ();
    try {
        const config = qz.configs.create(printerName, options); // puedes pasar opciones como tamaño/dpi
        await qz.print(config, data);
    } catch (err) {
        console.error('Error imprimiendo con QZ Tray:', err);
        throw err;
    }
}

export async function printWashLabels({
                                          orderNum,
                                          clientFirstName,
                                          clientLastName,
                                          totalItems,
                                          fechaLimite = '',
                                      }) {
    const clientName = `${clientFirstName} ${clientLastName}`.trim();
    const fechaLimiteFormatted = new Date(fechaLimite).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    let labelsHtml = '';
    for (let i = 1; i <= totalItems; i++) {
        labelsHtml += `
      <div>
        <div>Cliente: ${clientName}</div>
        <div>Pedido: ${orderNum}</div>
        <div>Prendas: ${i} de ${totalItems}</div>
        <div>Fecha: ${fechaLimiteFormatted}</div>
      </div>
      <div class="cut"></div>
    `;
    }

    const fullHtml = `
    <html>
      <head>
        <title>Etiquetas ${orderNum}</title>
        <style>
        
        @page {
  margin: 0;
  size: auto; /* deja que la impresora decida la altura, ancho adaptado */
}


            body {
                font-size: 1.2em;
                font-family: monospace;
                margin-top: 0;
                padding: 0 20px 20px 20px;
                max-width: 70mm;
            }
            .cut {
                /* después de la línea de corte, hacer salto */
                break-after: page;
                page-break-after: always;
            }
        </style>
      </head>
      <body>
        ${labelsHtml}
      </body>
    </html>
  `;

    try {
        await sendToPrinter('LAVADORA', buildRawHtml(fullHtml));
    } catch (e) {
        // fallback visual si falla
        console.warn('QZ Tray falló, recayendo a window.print()', e);
        const w = window.open('', 'print_labels_fallback');
        w.document.write(fullHtml);
        w.document.close();
        w.focus();
        setTimeout(() => {
            w.print();
            w.close();
        }, 300);
    }
}

export async function printSaleTicket(order, products = [], printerName) {
    const fechaLimiteFormatted = new Date(order.fechaLimite).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const client = order.client || {};
    const clientName = client.firstName
        ? `${client.firstName} ${client.lastName}`.trim()
        : 'Cliente rápido';

    const linesHtml = (order.lines || [])
        .map((l) => {
            let name = l.productName;
            if (!name) {
                const prod = products.find((p) => p.id === l.productId);
                name = prod ? prod.name : `#${l.productId}`;
            }
            return `<div>${l.quantity}x ${name} — ${(l.unitPrice * l.quantity).toFixed(2)}€</div>`;
        })
        .join('');

    const fullHtml = `
    <html>
      <head>
        <title>Ticket ${order.orderNum}</title>
        <link rel="stylesheet" href="/src/assets/css/ticket.css">
        <style>
        .ticket-no-pagado {
    border: 2px solid #f5c6cb;
    padding: 10px 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

body {
    font-family: monospace;
    padding: 0 10px 20px 10px;
    max-width: 70mm;
}

.section {
    margin-bottom: 8px;
}

.bold {
    font-weight: bold;
}

hr {
    border: none;
    border-bottom: 1px dashed #000;
    margin: 6px 0;
}

.cut {
    /* después de la línea de corte, hacer salto */
    break-after: page;
    page-break-after: always;
}
</style>
      </head>
      <body>
        <div class="section" style="text-align:center;">
          <div class="bold">Tinte y Burbuja</div>
          <div>Pedido: ${order.orderNum}</div>
        </div>
        <div class="section">
          <div>Cliente: ${clientName}</div>
          ${client.phone ? `<div>Tel: ${client.phone}</div>` : ''}
          ${order.paid ? `<div class="bold">Pago: ${order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}</div>` : `<div class="ticket-no-pagado">Pendiente de pago</div>`}
        </div>
        <hr/>
        <div class="section">
          ${linesHtml}
        </div>
        <hr/>
        <div class="section bold">
          Total: ${order.total.toFixed(2)}€
        </div>
        <div>Fecha estimada: ${fechaLimiteFormatted}</div>
        <div>Observaciones: ${order.observaciones ? order.observaciones : 'Ninguna'}</div>
        <div style="margin-top:8px; text-align:center; font-size:10px;">
          ¡Gracias por su confianza!
        </div>
        <div class="cut"></div>
      </body>
    </html>
  `;

    try {
        await sendToPrinter('CLIENTE', buildRawHtml(fullHtml));
    } catch (e) {
        console.warn('QZ Tray falló, recayendo a window.print()', e);
        const w = window.open('', 'print_ticket_fallback');
        w.document.write(fullHtml);
        w.document.close();
        w.focus();
        setTimeout(() => {
            w.print();
            w.close();
        }, 300);

    }
}
