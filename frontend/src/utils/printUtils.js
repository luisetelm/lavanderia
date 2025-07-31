// frontend/src/utils/printUtils.js

export function printWashLabels({
                                    orderNum,
                                    clientFirstName,
                                    clientLastName,
                                    totalItems,
                                }) {
    const clientName = `${clientFirstName} ${clientLastName}`.trim();

    let labelsHtml = '';
    for (let i = 1; i <= totalItems; i++) {
        labelsHtml += `
      <div class="label">
        <div>Cliente: ${clientName}</div>
        <div>Pedido: ${orderNum}/${i} de ${totalItems}</div>
      </div>
      <div class="cut"></div>
    `;
    }

    const w = window.open('', 'print_labels');
    w.document.write(`
    <html>
      <head>
        <title>Etiquetas ${orderNum}</title>
        <style>
          body {
            font-family: sans-serif;
            padding: 8px;
            margin: 0;
          }
          .label {
            width: 220px;
            padding: 8px;
            margin-bottom: 12px;
            border: 1px solid #000;
            box-sizing: border-box;
            page-break-inside: avoid;
          }
          .label div { margin: 4px 0; }
          .cut {
            height: 1px;
            background: #000;
            margin: 8px 0 12px;
          }
          @media print {
            .label { page-break-after: always; }
            body { margin: 0; }
          }
        </style>
      </head>
      <body>
        ${labelsHtml}
      </body>
    </html>
  `);
    w.document.close();
    w.focus();
    setTimeout(() => {
        w.print();
        w.close();
    }, 300);
}

export function printSaleTicket(order, products = []) {
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

    const w = window.open('', 'print_ticket');
    w.document.write(`
    <html>
      <head>
        <title>Ticket ${order.orderNum}</title>
        <style>
          body { font-family: monospace; padding: 8px; width: 300px; }
          .section { margin-bottom: 8px; }
          .bold { font-weight: bold; }
          hr { border: none; border-bottom: 1px dashed #000; margin: 6px 0; }
        </style>
      </head>
      <body>
        <div class="section" style="text-align:center;">
          <div class="bold">Lavandería</div>
          <div>Pedido: ${order.orderNum}</div>
        </div>
        <div class="section">
          <div>Cliente: ${clientName}</div>
          ${client.phone ? `<div>Tel: ${client.phone}</div>` : ''}
          <div>Pago: ${order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}</div>
        </div>
        <hr/>
        <div class="section">
          ${linesHtml}
        </div>
        <hr/>
        <div class="section bold">
          Total: ${order.total.toFixed(2)}€
        </div>
        <div style="margin-top:8px; text-align:center; font-size:10px;">
          ¡Gracias por su confianza!
        </div>
      </body>
    </html>
  `);
    w.document.close();
    w.focus();
    setTimeout(() => {
        w.print();
        w.close();
    }, 300);
}
