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
    const fechaHoy = new Date().toLocaleDateString('es-ES', {
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const fechaLimiteFormatted = new Date(order.fechaLimite).toLocaleDateString('es-ES', {
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const client = order.client || {};
    const clientName = client.firstName ? `${client.firstName} ${client.lastName}`.trim() : 'Cliente rápido';

    // Generar el código QR como data URL
    const qrCodeDataUrl = await QRCode.toDataURL(`https://share.google/2s6o76QI8BlyONLeg`, {
        width: 100,
        margin: 1,
        errorCorrectionLevel: 'M',
    });

    // Logo de la empresa en Base64
    // Este es un logo de ejemplo - deberías reemplazarlo con tu logo real codificado en base64
    const logoBase64 = 'data:image/png;base64,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';

    const linesHtml = (order.lines || [])
        .map((l) => {
            let name = l.productName;
            if (!name) {
                const prod = products.find((p) => p.id === l.productId);
                name = prod ? prod.name : `#${l.productId}`;
            }

            // Calcular el IVA para cada producto (suponiendo un 21%)
            const iva = 21;
            const importeSinIva = (l.unitPrice * l.quantity) / (1 + (iva/100));
            const importeIva = (l.unitPrice * l.quantity) - importeSinIva;

            return `<div class="producto-linea">
                <span class="cantidad">${l.quantity}x</span>
                <span class="nombre">${name}</span>
                <span class="precio">${(l.unitPrice * l.quantity).toFixed(2)}€</span>
            </div>`;
        })
        .join('');

    // Calcular el IVA total (21% por defecto)
    const iva = 21;
    const importeSinIva = order.total / (1 + (iva/100));
    const importeIva = order.total - importeSinIva;

    const fullHtml = `
    <html>
      <head>
        <title>Ticket ${order.orderNum}</title>
        <style>
        /* Estilos básicos */
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
        
        body {
            font-family: 'Open Sans', sans-serif;
            padding: 5mm;
            margin: 0;
            width: 80mm;
            color: black;
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
            width: 60mm;
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
        
        .desglose-fiscal {
            font-size: 10px;
            text-align: right;
            margin: 5px 0 10px 0;
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
            text-transform: uppercase;
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
            margin-bottom: 15px;
        }
        
        .info-legal {
            font-size: 9px;
            margin-top: 15px;
            text-align: center;
            color: #666;
            padding-bottom: 15px;
        }
        
        .cut {
            break-after: page;
            page-break-after: always;
            margin-top: 30px;
        }
        </style>
      </head>
      <body>
        <div class="ticket-container">
          <!-- Cabecera con logo -->
          <div class="header">
            <div class="logo-container">
              <img src="${logoBase64}" alt="Tinte y Burbuja" class="logo" />
            </div>
            <div class="pedido-numero">Pedido: ${order.orderNum}</div>
            <div style="font-size:10px;">Fecha: ${fechaHoy}</div>
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
          
          <!-- Total e información fiscal -->
          <div class="total">
            Total: ${order.total.toFixed(2)}€
          </div>
          
          <div class="desglose-fiscal">
            <div>Base imponible: ${importeSinIva.toFixed(2)}€</div>
            <div>IVA (${iva}%): ${importeIva.toFixed(2)}€</div>
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
              <div class="qr-info">Consulte los horarios de apertura</div>
            </div>
            <div class="gracias">
              ¡Gracias por su confianza!
            </div>
            
            <!-- Información legal obligatoria -->
            <div class="info-legal">
              Tinte y Burbuja S.L. | CIF: B22837561<br>
              Carretera de Sabiote, 45 - 23400 Úbeda<br>
              Conserve este ticket para posibles reclamaciones<br>
              Dispone de hojas de reclamaciones a su disposición
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
