# Ajustes en pedidos ya cobrados y facturados

Diseño para dos operaciones que hoy no existen:

- **Quitar** ítems de un pedido cobrado (se facturó de más).
- **Añadir** ítems a un pedido cobrado (prenda olvidada, arreglo de costura).

Desde el TPV son la misma acción — modificar las líneas de un pedido — pero
según el estado del pedido tienen consecuencias distintas en caja y en la
facturación.

> Estado: pasos 1, 2 y 3 implementados y verificados contra una copia local de
> producción. Pasos 4 a 6 pendientes.

## Cómo factura ahora `crearFactura()`

Sólo emite las líneas con `invoicedInId = null` y sin anular, y las marca con la
factura emitida. Un pedido puede así facturarse varias veces, una por cada tanda
de líneas que se le añada.

El importe se calcula de dos maneras, a propósito:

- **Primera factura del pedido** (cubre todo lo facturable) → se usa
  `order.total`, exactamente como se ha hecho siempre.
- **Facturación parcial** (líneas añadidas después) → se suma sólo lo pendiente,
  desde las propias líneas que se van a emitir.

El motivo de conservar `order.total` en el primer caso: de los 992 pedidos
facturados, 991 tienen `order.total` idéntico a la suma de sus líneas. El único
que discrepa es `TPV/2026/0163`, cancelado (`total = 0`) pero con líneas por
36,18 €. Calcular siempre desde las líneas habría cambiado su importe, así que
el camino histórico se deja intacto.

## Aviso: las migraciones de Prisma están bloqueadas

`prisma migrate` **no se puede usar en este proyecto**. La migración
`20250813083752_luis` está en estado fallido desde agosto de 2025, también en
producción, con el log *"A migration failed to apply. New migrations cannot be
applied"*. Intentaba borrar la tabla `Task`, que sigue viva con 41 filas.

Consecuencias:

- Hay 6 migraciones en disco y sólo 3 registradas; una de las registradas ni
  siquiera existe ya en disco.
- Desde entonces los cambios se aplican con scripts SQL numerados en
  `backend/sql/` (001 a 009). **Esa es la convención a seguir.**
- Secuela: `model Task` desapareció del `schema.prisma` pero la tabla existe, así
  que `prisma.task` es `undefined` y `GET /api/tasks` devuelve 500. No se ha
  notado porque el frontend no llama a esa ruta. Conviene arreglarlo aparte.

---

## 1. Situación actual (verificado sobre copia de producción)

| Cuestión | Estado real |
|---|---|
| `POST /api/invoices/rectificativa` | **Rota.** Devuelve 500. Escribe en `originalInvoiceId` y `rectified`, columnas que no existen; las reales son `rectifiesInvoiceId` e `isRectifying`. Además asigna `type: 'rectificativa'` a una columna `char(1)`. |
| Rectificativas emitidas | **0** en todo el histórico. |
| Añadir o quitar líneas | **No existe.** `PATCH /orders/lines/:lineId` sólo cambia `discount` y falla si `order.paid`. |
| Devoluciones de dinero | **0.** Sólo hay `Payment` con `completed` (1.278) y `pending` (5). Ningún importe negativo. |
| Facturas por pedido | **Máximo una.** Índice único `invoicetickets_ticket_pk` sobre `ticketId`. |
| Arqueo de caja | **Ya preparado.** `cash.js` trata `refund_cash_out` como salida y la resta del importe esperado. |
| Tipos de factura en uso | `s` simplificada (881), `n` normal (36). |

La conclusión operativa: hoy, si hay que corregir un pedido cobrado, no existe
ninguna vía en la aplicación.

---

## 2. Principios de diseño

1. **Una factura emitida no se modifica ni se borra.** Se corrige emitiendo una
   rectificativa que la referencia. Es la razón de ser de casi todo lo que sigue.
2. **Añadir y quitar no son simétricos.** Decisión tomada:
   - **Añadir** un producto o servicio es una **operación nueva** → factura
     nueva por lo añadido. No es una corrección: cuando se emitió la primera
     factura, era correcta.
   - **Quitar** es corregir un error de la operación original → **rectificativa**.

   En el TPV el gesto es el mismo; la diferencia está en el documento que se
   emite y ocurre sin que el empleado tenga que decidir nada.
3. **El pedido es el documento operativo; la factura, el fiscal.** Un pedido pasa
   a poder tener **varias facturas**, y hay que saber qué línea cubre cada una.
4. **Todo ajuste deja rastro**: quién, cuándo, por qué, y qué importe movió.
   Sin motivo obligatorio no se guarda.
5. **El dinero se mueve en el día del ajuste**, no en el del cobro original.
   Un arqueo ya cerrado no se toca nunca.

---

## 3. Cambios en el modelo de datos

### 3.1 Permitir varias facturas por pedido

```sql
DROP INDEX invoicetickets_ticket_pk;   -- deja la PK compuesta (invoiceId, ticketId)
```

Sin esto no se puede vincular la rectificativa al mismo pedido. Es el único
cambio de esquema imprescindible.

**Cuidado:** `crearFactura()` da por hecho que un pedido tiene como mucho una
factura (`findFirst` por `ticketId`). Al levantar el índice hay que cambiarlo por
"buscar la factura **vigente**", entendiendo por vigente la que no ha sido
rectificada.

### 3.2 Sin columna nueva para "factura rectificada"

No hace falta. Una factura está rectificada si existe otra con
`rectifiesInvoiceId = su id`. Los campos `isRectifying` y `rectifiesInvoiceId`
ya están en el esquema y no se usan.

### 3.3 Trazabilidad línea → factura (consecuencia de "añadir = operación nueva")

Si un pedido puede acumular facturas, `invoiceTickets` ya no basta: vincula
factura y pedido entero, y no dice qué líneas cubre cada una. Sin esto, al
facturar lo añadido se volvería a facturar todo el pedido.

Añadir a `OrderLine`:

```prisma
invoicedInId  BigInt?     // factura que cubre esta línea; null = pendiente
```

Con esto todo se vuelve trivial y sin ambigüedad:

- **Facturar lo añadido** = facturar las líneas con `invoicedInId = null`.
- **Rectificar una anulación** = rectificar exactamente la factura que aparece
  en `invoicedInId` de la línea anulada.
- El estado "pedido facturado" pasa a ser "no le quedan líneas pendientes".

Requiere un relleno inicial en la migración: para cada pedido ya facturado,
asignar a todas sus líneas la factura de su `invoiceTickets`. Son 917 facturas,
es un `UPDATE ... FROM` de una pasada.

### 3.3.bis Integridad referencial ausente (hallazgo)

Detectado al implementar el paso 1:

- **`invoiceLines` no tiene ninguna clave ajena real en la base de datos.** El
  `onDelete: Cascade` del schema es sólo declarativo de Prisma; PostgreSQL no lo
  aplica. Un `DELETE` por SQL deja las líneas colgando sin avisar.
- **Hay 434 líneas de factura huérfanas en producción**, apuntando a facturas que
  ya no existen. Probablemente de borrados manuales antiguos.

**Decisión tomada: las 434 huérfanas no se borran.** Son el único rastro que
queda de esas facturas y no hay forma de saber hoy qué documentaban.

Eso impide crear una clave ajena normal: PostgreSQL valida las filas existentes y
la rechaza. Comprobado en la copia local:

```
FK normal       -> RECHAZADA: «viola la llave foránea»
FK NOT VALID    -> creada, y las 434 se conservan
INSERT huérfano -> bloqueado
```

La migración del paso 2 debe usar `NOT VALID`, que aplica la restricción a las
filas nuevas sin validar las antiguas:

```sql
ALTER TABLE "invoiceLines"
    ADD CONSTRAINT fk_invoicelines_invoice FOREIGN KEY ("invoiceId")
    REFERENCES invoices(id) ON DELETE CASCADE NOT VALID;
```

Protege de aquí en adelante y deja el pasado como está. Si algún día se depuran
las 434, un `VALIDATE CONSTRAINT` la convierte en una FK plena sin recrearla.

Conviene aplicar el mismo criterio a `invoiceTickets`, que tampoco tiene FK real.

### 3.4 Anulación de líneas en vez de borrado

Añadir a `OrderLine`:

```prisma
voidedAt     DateTime?
voidedBy     Int?
voidReason   String?
```

Borrar la fila haría irreconstruible el ticket original, que es justo lo que la
factura documenta. Los totales pasan a calcularse ignorando las líneas anuladas.

### 3.5 Devoluciones como `Payment` negativo

Un registro nuevo con `amount` negativo, no una modificación del pago original:
el histórico de caja debe ser un diario, no un estado mutable. `status` sigue
siendo `completed`; lo que marca la devolución es el signo.

### 3.6 Serie de numeración propia

`nextInvoiceNum()` fija el prefijo `FAC/`. Conviene parametrizarlo para emitir
`REC/2026/0001` y que las rectificativas no se intercalen en la serie de
facturas. **A confirmar con la gestoría** (ver §7).

> Aparte: `nextInvoiceNum` ordena por `id desc`, no por número. Funciona mientras
> id y número crezcan a la vez, pero es frágil. Merece corregirse.

---

## 4. Endpoints

### 4.1 Reparar `POST /api/invoices/rectificativa`

- `originalInvoiceId` → `rectifiesInvoiceId`
- `rectified: true` → eliminar (se deriva, §3.2)
- `type: 'rectificativa'` → heredar el de la original (`s` o `n`) y marcar
  `isRectifying: true`
- Numeración con la serie de §3.5
- Copiar las `invoiceLines` con los importes de la corrección
- Vincular `invoiceTickets` al mismo pedido (necesita §3.1)

### 4.2 Nuevo: `POST /api/orders/:id/adjustments`

Un único endpoint para las dos operaciones, porque en el TPV son el mismo gesto.

```jsonc
{
  "add":    [{ "productId": 42, "variantId": null, "quantity": 1 }],
  "void":   [{ "lineId": 987, "reason": "cobrada por error" }],
  "reason": "cliente añade arreglo de bajos",
  "settlementMethod": "cash"     // cómo se cobra o devuelve la diferencia
}
```

Todo dentro de una transacción. Los dos lados se tratan por separado, porque
fiscalmente son cosas distintas (§2.2):

1. Aplica altas y anulaciones, recalcula el total del pedido.
2. **Lo anulado que ya estaba facturado** → rectificativa sobre la factura que
   indica su `invoicedInId` (§4.1). Si aún no estaba facturado, no hay nada que
   rectificar.
3. **Lo añadido** → queda con `invoicedInId = null`, pendiente de facturar.
   Si el pedido ya tenía factura, se emite una **factura nueva** sólo por esas
   líneas, con la serie normal `FAC/` y heredando el tipo (`s`/`n`) de la
   anterior.
4. **Liquidación del dinero**, con el neto de las dos operaciones:
   - Neto > 0 → `Payment` positivo (+ `CashMovement` `sale_cash_in` si es efectivo).
   - Neto < 0 → `Payment` negativo (+ `CashMovement` `refund_cash_out` si es efectivo).
   - Neto = 0 → sin movimiento, pero los documentos fiscales se emiten igual.
5. Devuelve el pedido y los documentos generados, para imprimir.

**Un ajuste puede emitir dos documentos a la vez** (una rectificativa por lo
quitado y una factura por lo añadido). No se compensan entre sí: son operaciones
distintas y cada una lleva su papel. Lo único que se compensa es el dinero.

**Casos que debe rechazar:** pedido `cancelled`; línea que no es del pedido o ya
anulada; ajuste que deje el pedido en negativo; y falta de motivo.

**Limitación conocida de la implementación actual.** El ajuste no es una única
transacción de principio a fin: los cambios sobre las líneas van en una, y la
emisión de documentos y la liquidación del dinero, después. No se pudo hacer de
otra forma sin refactorizar `crearFactura()`, que abre su propia transacción y
genera el PDF con Puppeteer (lento, y no debe correr dentro de una transacción).

El orden está elegido para que un fallo a mitad deje el estado lo menos dañino
posible: primero las líneas, después los documentos, y el dinero al final. Si
algo falla, lo peor que puede quedar es un pedido ajustado sin documento o sin
cobrar — visible y corregible — en vez de dinero movido sin respaldo documental.
Conviene revisarlo si el volumen de ajustes crece.

Si el pedido **aún no está facturado**, los pasos 2 y 3 no emiten nada: las
líneas se añaden o anulan sin más y todo se factura junto al final. Es el caso
más frecuente y el más barato.

---

## 4.3 El dinero no siempre se mueve en el momento

Caso real: la empleada se da cuenta de que ha picado una prenda de más, o el
cliente añade un arreglo de costura. En ambos casos el cliente puede no estar
delante, así que el ajuste **no debe dar por hecho que se cobra o se devuelve en
ese instante**. Por eso el método de liquidación es opcional.

| Situación | Movimiento de caja | Estado |
|---|---|---|
| Picó de más, devuelve el dinero ya | `refund_cash_out` en el arqueo de hoy | Saldado |
| Picó de más, el cliente ya se fue | ninguno | Rectificativa `unpaid`: pendiente de devolver |
| Añade costura y la cobra ya | `sale_cash_in` en el arqueo de hoy | Saldado |
| Añade costura, se cobra al recoger | ninguno | **`order.paid` pasa a `false`** |

Ese último punto es el importante. Sin él, el pedido seguiría marcado como
pagado debiendo dinero, no aparecería en ninguna lista de pendientes y **el
suplemento no se cobraría nunca**. Al marcarlo como no pagado, vuelve al
circuito normal de cobro del TPV.

La devolución pendiente queda registrada de otra forma: la rectificativa nace
`unpaid` y aparece en `/api/invoices/unpaid` con importe negativo. Conviene
decidir cómo se presenta eso en pantalla, porque una factura negativa en una
lista titulada "pendientes de cobro" significa en realidad *pendiente de
devolver*.

## 5. Flujo en el TPV

En la ficha de un pedido cobrado, un botón **«Ajustar pedido»**:

1. Modal con las líneas actuales; cada una con opción de anular.
2. Selector de productos para añadir (el mismo del POS: la costura es un
   producto más del catálogo).
3. Cabecera viva con el resultado: **A cobrar 14,54 €** o **A devolver 8,20 €**.
4. Motivo obligatorio.
5. Al confirmar: cobra o devuelve, e imprime ticket de ajuste y rectificativa.

Conviene restringirlo por rol (`admin`, quizá `cashier`): mueve dinero y emite
documentos fiscales.

---

## 6. Impacto en caja e informes

- **Arqueo:** ya funcionaba (`cash.js` resta `refund_cash_out`); el ajuste genera
  ahora el movimiento automáticamente.
- **Informe de ingresos** (`/api/cash/income-report`): mide dinero real, a partir
  de los `Payment`. Como las devoluciones son pagos negativos con estado
  `completed`, ya restan solas.

  El riesgo estaba en otro sitio: el bloque que detecta "facturas huérfanas"
  (emitidas sin pago registrado) habría contado también las rectificativas,
  **restando su importe dos veces**. Se excluyen explícitamente: una
  rectificativa no es una factura cobrada fuera del sistema, es lo contrario.
- **Informe de facturas** (`/api/invoices/report`): incluye las rectificativas
  con su importe negativo, el tipo y el número de la factura que corrigen.
- **Exportación para gestoría:** columnas `Tipo` y `Rectifica a`, y en pantalla
  las rectificativas van marcadas en rojo para no confundirlas.

La separación es deliberada: emitir una rectificativa **sin** devolver aún el
dinero aparece en el informe de facturas (documento fiscal emitido) pero no
altera el de ingresos (no ha habido movimiento). Verificado.

---

## 7. Criterios de facturación

### Decididos y ya implementados

1. **Serie propia para las rectificativas** (`REC/2026/0001`), no correlativa con
   las facturas. → `invoices.js`, constante `RECTIFYING_SERIES`.
2. **Rectificación por diferencias**: la rectificativa recoge sólo lo corregido,
   en negativo. No sustituye a la factura entera. → `crearRectificativa()`.
3. **La rectificativa hereda el tipo de la original**: una simplificada se
   rectifica con una simplificada. Es lo coherente con el mostrador — la
   simplificada es el "ticket" de toda la vida, y corregirlo no debería obligar
   al cliente a dar NIF y dirección. → `type: original.type`.

### Pendientes de consultar

4. **¿Plazo máximo para rectificar una factura ya emitida?** Hoy no hay ninguno:
   se puede rectificar una factura de cualquier antigüedad. Si existe un límite
   legal, es una validación corta en `crearRectificativa()`.
5. **Confirmar que añadir un producto o servicio a un pedido ya facturado es una
   operación nueva**, con su propia factura y su propia fecha de devengo, y no
   una corrección de la anterior. Es la base del diseño (§2.2); si la gestoría lo
   viera como corrección, el paso 3 del ajuste tendría que emitir rectificativa
   en vez de factura nueva. El resto del diseño no cambiaría.

### Dato de contexto para la consulta

Las simplificadas emitidas hasta hoy: **881 facturas, importe medio 27,11 €,
máximo 162 €**. Ninguna supera los 400 €, así que el límite de importe para poder
emitir simplificadas no supone hoy ningún problema — conviene confirmar de todos
modos cuál aplica a la actividad.

---

## 8. Orden sugerido

| # | Paso | Dependencias | Estado |
|---|---|---|---|
| 1 | Reparar `POST /invoices/rectificativa` | — | **hecho** |
| 2 | Migración `sql/009` + schema + adaptar accesos 1:1 → 1:N | — | **hecho** |
| 3 | Adaptar `crearFactura()` a "facturar sólo líneas pendientes" | 2 | **hecho** |
| 4 | `POST /orders/:id/adjustments` | 1, 2, 3 | **hecho** |
| 5 | Modal de ajuste en el TPV | 4 | **hecho** |
| 6 | Rectificativas y facturas de ajuste en informes y exportación | 1, 3 | **hecho** |

Pendiente menor heredado del paso 1: la rectificativa no se vincula al pedido vía
`invoiceTickets` (se relaciona sólo por `rectifiesInvoiceId`), porque cuando se
implementó aún existía el índice único. Ahora que el paso 2 lo ha levantado, ya
puede vincularse; conviene hacerlo al abordar el paso 3.

Los pasos 1 y 2 son independientes y verificables por separado contra la copia
local de producción.

El **paso 3 es el de más riesgo**: `crearFactura()` hoy asume que un pedido se
factura entero y de una vez, y rechaza cualquier pedido que ya tenga factura.
Pasar a "facturar las líneas pendientes" toca el camino por el que han salido
las 917 facturas existentes, así que conviene cubrirlo con pruebas sobre la copia
local antes de tocar producción.
