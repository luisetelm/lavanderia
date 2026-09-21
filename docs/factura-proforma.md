# Facturas proforma

El presupuesto detallado que se entrega al cliente para que lo presente ante un
tercero. Lo motiva `TPV/2026/1903`: 146 prendas recuperadas de un incendio, 1.936 €
IVA incluido, cuyo trabajo tiene que pagar la aseguradora, que antes quiere ver por
escrito qué se va a hacer y cuánto cuesta.

> Estado: implementado y probado contra una base creada desde el schema
> (38 comprobaciones). Pendiente de aplicar `sql/030_proforma.sql` en producción.

## Qué es y qué no es

Una proforma **no es una factura**. Es una oferta:

- no devenga IVA ni se anota en el libro registro de facturas emitidas;
- no sale en el export a la gestoría (`GET /api/invoices/report`);
- no da derecho a deducción a quien la recibe;
- **se puede borrar**. Si el tercero no la acepta, se borra y no queda rastro de
  factura ninguna.

Ese último punto es el que decide todo el diseño.

## Por qué no es una fila en `invoices`

Porque una fila en `invoices` es una factura a todos los efectos, y en este código
se propaga sola a siete sitios: consume número de la serie `FAC/`, sale en el export
de la gestoría, aparece en `/invoices/unpaid` (facturas por cobrar del TPV), en el
portal del cliente, en Ventas y en la ficha del cliente, y hace que
`monthlyInvoicing` dé el pedido por facturado.

Y, sobre todo, porque **una factura no se borra nunca** — es la norma del código
(`utils/facturaDe.js`, `crearRectificativa`). Anular una proforma emitida como
factura exigiría una rectificativa, que es exactamente el rastro que no se quiere.

Añadir un `type` más a `invoices` y excluirlo en siete sitios es frágil: basta
olvidar uno. Así que tablas propias (`sql/030_proforma.sql`), serie propia y
borrado de verdad.

La proforma tampoco toca `OrderLine.invoicedInId` ni crea `invoiceTickets`: el
pedido sigue pendiente de facturar mientras la proforma está en vigor.

## El circuito

```
Pedido recibido (pending, unpaid)
   │
   └─ Ventas → botón "Proforma" → PRO/2026/0001 → PDF al cliente
        │
        ├─ ACEPTA        → "Aceptada" → se trabaja → "Facturar"
        │                  → FAC/2026/#### ligada a la proforma
        │
        ├─ VICIO OCULTO  → "Ajustar pedido" (añade el trabajo extra)
        │                  → "Revisar" → PRO/2026/0002, la anterior queda
        │                    'superseded' pero se conserva: es la que el
        │                    cliente tiene en la mano
        │
        └─ RECHAZA       → "Rechazada" → se borra la proforma
                           → cancelar el pedido, EN ESE ORDEN
                           No queda ninguna fila en `invoices`. Nunca la hubo.
```

El orden al rechazar importa: cancelar el pedido primero pone su `total` a 0
(`PATCH /orders/:id`), y entonces ya no se puede presupuestar ni comprobar nada.

## Estados

| Estado | Qué significa |
|---|---|
| `issued` | emitida, esperando respuesta |
| `accepted` | aceptada; ya se puede trabajar |
| `rejected` | reservado; en la práctica el rechazo se materializa borrándola |
| `superseded` | sustituida por una revisión |
| `invoiced` | ya se emitió la factura. A partir de aquí **no se puede borrar** |

## La numeración

Serie `PRO/<año>/####`, independiente de `FAC/`. El contador vive en `AppSettings`
(clave `proforma_last_num_<año>`), no en un `MAX()` sobre la tabla: una proforma
borrada **no debe devolver su número al mostrador**. Que una aseguradora tenga dos
documentos distintos numerados igual es peor que un hueco en una serie que no es
fiscal. El `INSERT ... ON CONFLICT ... RETURNING` lo hace atómico.

## El PDF

Se genera al vuelo en cada descarga (`GET /api/proformas/:id/pdf`) desde las líneas
congeladas en `proforma_line`, no se guarda en disco. Así no hay fichero que se
quede desfasado al editar ni que sobreviva al borrado.

Las líneas se copian congeladas a propósito: si mañana sube una tarifa, la oferta
que ya está en manos del cliente no puede cambiar sola.

El documento lleva marca de agua *PROFORMA*, el aviso de que no tiene valor fiscal
y las condiciones impresas. No es decoración: es lo que el cliente acepta al aceptar
el precio.

## Las condiciones

Van en el papel, no en un correo aparte. Las tres que no son negociables:

4. **Se factura el trabajo realizado.** El importe corresponde al tratamiento
   aplicado a cada prenda y se factura una vez ejecutado, *aunque el resultado no
   sea plenamente satisfactorio*. En prendas de incendio, humo o agua no puede
   garantizarse la eliminación total del olor, del hollín o de las manchas: el
   tratamiento se aplica sobre un tejido que llega ya dañado.
5. **Vicios ocultos y cambios en la previsión de trabajo.** Si al manipular o
   tratar una prenda aparece un defecto que no era apreciable en la recepción
   —forro o relleno dañado, quemaduras internas, tintes inestables, composición
   distinta de la etiquetada— *se detiene esa prenda y se avisa al cliente antes de
   continuar*. No se factura nada por encima de la proforma sin una revisión
   aceptada. Si no la acepta, la prenda se devuelve como esté y se cobra sólo el
   trabajo ya hecho sobre ella.
6. **Obligado al pago.** El documento se emite **a nombre del cliente**. El
   obligado al pago es él, pague quien pague. La aseguradora sólo aparece como
   mención («a presentar ante X, expediente Y»), para que el perito localice el
   siniestro.

Esa decisión —a nombre del cliente, no de la aseguradora— es la que mantiene la
relación comercial y fiscal con quien trajo la ropa. Si el seguro no paga, se
reclama a él.

## API

Todo bajo `/api/proformas`, sólo admin.

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/` | Emite. Body: `{orderIds, recipientName?, recipientRef?, validUntil?, notes?}`. Exige ficha fiscal completa del cliente, **NIF incluido**. Rechaza si el pedido ya tiene una en vigor (409) |
| POST | `/:id/revise` | Revisión: vuelve a presupuestar el pedido como esté ahora y deja la anterior en `superseded` |
| GET | `/?orderId=&clientId=&status=` | Listado |
| GET | `/:id` | Una |
| GET | `/:id/pdf` | El PDF, generado al vuelo |
| PATCH | `/:id` | `status` (`issued`/`accepted`/`rejected`), validez, mención al tercero, observaciones |
| POST | `/:id/invoice` | Aceptada y trabajo hecho: emite la factura normal de los mismos pedidos y cierra la proforma apuntando a ella |
| DELETE | `/:id` | Borra. Prohibido si ya está facturada. Si era una revisión, la anterior vuelve a `issued` |

El importe se calcula con el mismo criterio que `crearFactura()` —si cubre todo lo
facturable manda `order.total`; si no, se suma desde las líneas— para que la factura
que sigue a la proforma cuadre con ella.

## En el TPV

En Ventas, en la columna de factura de cada pedido sin facturar:

- Sin proforma: `Simplificada` · `Normal` · **`Proforma`** (abre `ProformaModal`).
- Con proforma en vigor: el número, el estado y `Descargar` · `Aceptada` /
  `Facturar` · `Revisar` · `Rechazada`. **Los botones de factura normal desaparecen**:
  con una proforma en vigor la factura se emite desde ella, para que quede ligada.
- En la columna de estado, una etiqueta *Presupuestado*, para que nadie lea
  «Pendiente» y crea que no se ha hecho nada.

## Cosas que no cambian, a propósito

`invoices`, `invoiceTickets`, `OrderLine.invoicedInId`, `Payment`, la caja, el
portal del cliente y el export a la gestoría. Una proforma nunca genera un cobro.

Con dos excepciones necesarias:

- **`monthlyInvoicing`** salta los pedidos con proforma en vigor. Sin eso, un
  cliente con `autoMonthlyInvoice` recibiría a fin de mes una factura automática por
  un importe que el tercero aún no ha aceptado.
- **`GET /orders/:id`** incluye `proformaOrders`, para que la fila de Ventas sepa
  si hay una en vigor sin una petición más por fila.

## Ojo con esto

- **Si el tercero paga por adelantado contra la proforma**, ese anticipo sí devenga
  IVA y obliga a emitir factura en ese momento. No se cobra nada contra una
  proforma.
- **El concepto que aparece en el papel importa.** En `TPV/2026/1903` los 80 kg
  entraron como `KG ROPA COLOR LAVADO Y PLANCHADO` a 8 €/kg. El precio coincide con
  `KG. ROPA BLANCA SINIESTRO HUMO` (id 186, `sql/024`), pero al perito se le enseña
  un documento que no menciona el siniestro. Conviene cambiar la línea antes de
  congelar el presupuesto.
- **Las prendas ocupan sitio mientras el tercero decide.** De ahí la validez por
  defecto de 30 días y la condición 2.
