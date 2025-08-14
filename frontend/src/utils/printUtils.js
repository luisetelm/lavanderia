// Importar la biblioteca para generar códigos QR
import QRCode from 'qrcode';

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
    return [{
        type: 'html', format: 'plain', data: htmlContent,
    },];
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

// --- ESC/POS helpers ---
const LF = '\x0A';
const ESC_INIT = '\x1B\x40';
const CUT_ESC_I = '\x1B\x69';        // Corte (ESC i) -> muy fiable en TM-U220
const CUT_GS_V_FULL = '\x1D\x56\x00'; // Alternativa GS V 0 (corte total)

function buildCut({feed = 0, variant = 'auto', partial = false, feedAfter = 0} = {}) {
    const feedBlock = LF.repeat(Math.max(0, feed));

    if (variant === 'gs') {
        if (partial) {
            // Corte parcial estándar (GS V 1)
            return ESC_INIT + feedBlock + '\x1D\x56\x01';
        }
        if (feedAfter > 0) {
            // GS V 66 n → corta y avanza n unidades
            return ESC_INIT + feedBlock + '\x1D\x56\x42' + String.fromCharCode(feedAfter);
        }
        // Corte total GS V 0
        return ESC_INIT + feedBlock + '\x1D\x56\x00';
    }

    // Variante 'auto' → prueba ESC i (corte total clásico)
    return ESC_INIT + feedBlock + CUT_ESC_I;
}


// frontend/src/utils/printUtils.js
// frontend/src/utils/printUtils.js
const SIZE_NORMAL = '\x1D\x21\x00'   // Tamaño normal
const SIZE_DOUBLE = '\x1D\x21\x11'   // Doble ancho y alto

export async function printWashLabels({
                                          orderNum, clientFirstName, clientLastName, totalItems, fechaLimite = ''
                                      }) {
    const clientName = `${clientFirstName} ${clientLastName}`.trim()
    const fecha = fechaLimite
        ? new Date(fechaLimite).toLocaleDateString('es-ES', {
            year: 'numeric', month: '2-digit', day: '2-digit'
        })
        : ''

    const printData = []
    printData.push({type: 'raw', format: 'command', data: ESC_INIT})


    for (let i = 1; i <= totalItems; i++) {
        const lines =
            `Cliente: ${clientName}${LF}` +
            `Pedido: ${orderNum}${LF}` +
            `Prendas: ${i} de ${totalItems}${LF}` +
            (fecha ? `Fecha: ${fecha}${LF}` : '')

        // Texto en tamaño grande
        printData.push({type: 'raw', format: 'command', data: SIZE_DOUBLE})
        printData.push({type: 'raw', format: 'command', data: lines})


        // Restablecer a tamaño normal
        printData.push({type: 'raw', format: 'command', data: SIZE_NORMAL})

        // Corte al borde (sin feed adicional para que corte justo después del contenido)
        printData.push({
            type: 'raw',
            format: 'command',
            data: buildCut({feed: 1})
        })
    }

    // Etiqueta "invisible" inicial para ajustar el papel
    printData.push({
        type: 'raw',
        format: 'command',
        // Avanzamos 5 líneas vacías y cortamos
        data: buildCut({feed: 6})
    })

    await sendToPrinter(`LAVADORA`, printData)
}

export async function printWashLabelsOLD({
                                             orderNum, clientFirstName, clientLastName, totalItems, fechaLimite = '',
                                         }) {
    const clientName = `${clientFirstName} ${clientLastName}`.trim();
    const fechaLimiteFormatted = new Date(fechaLimite).toLocaleDateString('es-ES', {
        year: 'numeric', month: '2-digit', day: '2-digit',
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
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const client = order.client || {};
    const clientName = client.firstName ? `${client.firstName} ${client.lastName}`.trim() : 'Cliente rápido';

    // Generar el código QR como data URL
    const qrCodeDataUrl = await QRCode.toDataURL(`Pedido: ${order.orderNum}`, {
        width: 100,
        margin: 1,
        errorCorrectionLevel: 'M',
    });

    const linesHtml = (order.lines || [])
        .map((l) => {
            let name = l.productName;
            if (!name) {
                const prod = products.find((p) => p.id === l.productId);
                name = prod ? prod.name : `#${l.productId}`;
            }
            return `<div class="producto-linea">
                <span class="cantidad">${l.quantity}x</span>
                <span class="nombre">${name}</span>
                <span class="precio">${(l.unitPrice * l.quantity).toFixed(2)}€</span>
            </div>`;
        })
        .join('');

    const fullHtml = `
    <html>
      <head>
        <title>Ticket ${order.orderNum}</title>
        <style>
        /* Estilos básicos */
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
        
        body {
            font-family: 'Open Sans', sans-serif;
            padding: 0;
            margin: 0;
            max-width: 70mm;
            color: #333;
        }
        
        .ticket-container {
            padding: 6px 10px 20px;
        }
        
        /* Cabecera */
        .header {
            text-align: center;
            margin-bottom: 10px;
        }
        
        .logo-container {
            margin-bottom: 6px;
        }
        
        .logo {
            width: 50mm;
            height: auto;
        }
        
        .company-name {
            font-weight: 700;
            font-size: 16px;
            margin: 4px 0;
        }
        
        .pedido-numero {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 6px;
        }
        
        /* Info cliente */
        .client-info {
            margin-bottom: 8px;
            font-size: 12px;
        }
        
        /* Productos */
        .productos {
            margin: 8px 0;
        }
        
        .producto-linea {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            font-size: 12px;
        }
        
        .cantidad {
            width: 30px;
        }
        
        .nombre {
            flex-grow: 1;
            padding: 0 5px;
        }
        
        .precio {
            text-align: right;
            width: 60px;
        }
        
        /* Total y otra info */
        .total {
            font-weight: 700;
            font-size: 14px;
            text-align: right;
            margin: 5px 0;
        }
        
        .ticket-no-pagado {
            border: 2px solid #f5c6cb;
            padding: 6px;
            margin: 8px 0;
            text-align: center;
            font-weight: 600;
            color: #721c24;
            background-color: #f8d7da;
            border-radius: 4px;
        }
        
        .payment-info {
            font-weight: 600;
            margin: 5px 0;
        }
        
        hr {
            border: none;
            border-bottom: 1px dashed #ccc;
            margin: 8px 0;
        }
        
        /* Información adicional */
        .info-adicional {
            font-size: 11px;
            margin-top: 8px;
        }
        
        .observaciones {
            font-size: 11px;
            margin-top: 4px;
            font-style: italic;
        }
        
        /* QR y agradecimiento */
        .footer {
            margin-top: 12px;
            text-align: center;
        }
        
        .qr-container {
            margin-bottom: 8px;
        }
        
        .qr-code {
            max-width: 100px;
        }
        
        .qr-info {
            font-size: 10px;
            margin-top: 2px;
        }
        
        .gracias {
            margin-top: 8px;
            font-size: 12px;
            font-weight: 600;
        }
        
        .cut {
            break-after: page;
            page-break-after: always;
        }
        </style>
      </head>
      <body>
        <div class="ticket-container">
          <!-- Cabecera con logo -->
          <div class="header">
            <div class="logo-container">
              <img src="/logo.png" alt="Tinte y Burbuja" class="logo" />
            </div>
            <div class="pedido-numero">Pedido: ${order.orderNum}</div>
          </div>
          
          <!-- Información del cliente -->
          <div class="client-info">
            <div><strong>Cliente:</strong> ${clientName}</div>
            ${client.phone ? `<div><strong>Teléfono:</strong> ${client.phone}</div>` : ''}
            ${order.paid
        ? `<div class="payment-info">Pago: ${order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}</div>`
        : `<div class="ticket-no-pagado">Pendiente de pago</div>`}
          </div>
          
          <hr/>
          
          <!-- Detalle de productos -->
          <div class="productos">
            ${linesHtml}
          </div>
          
          <hr/>
          
          <!-- Total -->
          <div class="total">
            Total: ${order.total.toFixed(2)}€
          </div>
          
          <!-- Información adicional -->
          <div class="info-adicional">
            <div><strong>Fecha estimada de entrega:</strong> ${fechaLimiteFormatted}</div>
            <div class="observaciones">
              ${order.observaciones ? `<strong>Observaciones:</strong> ${order.observaciones}` : ''}
            </div>
          </div>
          
          <!-- Pie con QR y agradecimiento -->
          <div class="footer">
            <div class="qr-container">
              <img src="${qrCodeDataUrl}" alt="QR Code" class="qr-code" />
              <div class="qr-info">Código del pedido</div>
            </div>
            <div class="gracias">
              ¡Gracias por su confianza!
            </div>
          </div>
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
