# Productos

## Quién puede hacer qué

- **Consultar, filtrar y exportar** el catálogo y ver la ficha de cada producto:
  cualquier empleado.
- **Crear, editar, duplicar, archivar, importar, cambiar precios en bloque y
  gestionar categorías**: sólo administración. La API responde 403 al resto y la
  interfaz no les muestra los botones.

## Catálogo

`/productos`. Búsqueda (nombre, SKU, categoría o descripción), filtros y orden se
recuerdan en cada navegador.

- **Filtros**: estado (activos, archivados o todos), tipo, actividad (con pedidos
  en los últimos 30 días, o sin pedidos en 90 días), categoría e itinerario.
- **Columnas de actividad**: unidades pedidas en los últimos 30 días, una línea
  con las unidades de las últimas 12 semanas y la fecha del último pedido. Mismo
  criterio que la ficha (sin cancelados ni anuladas).
- **Selección** (administración): marcando productos aparece la barra de acciones
  en bloque: cambiar precios, archivar o restaurar y exportar la selección.
- **Exportar a Excel**: los productos seleccionados o, si no hay selección, los
  que se ven con los filtros actuales.

### Archivar

Para productos que ya no se ofrecen. Un producto archivado:

- deja de salir en el TPV, en los ajustes de pedidos y al pactar precios con un
  cliente;
- conserva su ficha, sus pedidos, sus estadísticas y sus precios pactados;
- se puede restaurar en cualquier momento.

Los productos no se borran: las líneas de pedido y las facturas los referencian.
Un pedido en curso que ya tuviera el producto en el carrito se puede terminar.

### Duplicar

Abre el formulario con los datos del producto, el nombre con «(copia)» y sin
SKU, que se genera al guardar. Útil para dar de alta variantes.

### Cambiar precios en bloque

Sobre los productos seleccionados: precio, tarifa de gran cliente o los dos; en
porcentaje o en importe fijo (en negativo para bajar); con redondeo al céntimo,
a 5 o 10 céntimos, a 50 céntimos, al euro o sin redondear. Los precios llevan el
IVA incluido.

- Antes de aplicar se ve la tabla con el precio actual y el nuevo. La calcula el
  backend con la misma fórmula que guarda, así que coincide exactamente.
- Un precio a 0 (p. ej. un producto sin tarifa de gran cliente) se deja igual.
- No se aplica si algún precio quedaría negativo.
- No cambian los precios pactados con clientes ni los pedidos ya hechos.

### Categorías

Se crean desde el botón «Categorías» del catálogo o directamente en el
formulario del producto («Nueva»). El nombre no se puede repetir. Borrar una
categoría deja sus productos sin categoría.

## Ficha de producto

`/productos/:id`. Se abre pinchando en el nombre del producto en el catálogo.

Arriba, los datos del producto y el selector de fechas (por defecto, los últimos
3 meses; se recuerda la última elección). Todo lo que hay debajo usa ese rango.

### Indicadores

| Indicador | Qué es |
|---|---|
| Unidades | Suma de cantidades pedidas |
| Pedidos | Pedidos distintos que lo incluyen, y cuántos clientes distintos |
| Importe | Lo cobrado por el producto, ya con descuentos; con y sin IVA |
| Precio medio cobrado | Importe / unidades, frente al precio de catálogo |
| Peso en el importe total | Importe del producto / importe de todos los productos del periodo |

Unidades, pedidos e importe se comparan con el periodo anterior de la misma
duración. El rango no pasa de hoy, para no comparar un periodo a medias con uno
completo.

### Qué cuenta

- **No cuentan** los pedidos cancelados ni las líneas anuladas al ajustar un
  pedido ya cobrado (ver `ajustes-pedidos-facturados.md`).
- La fecha es la de creación del pedido, en hora local del servidor.
- Los importes salen de `OrderLine.totalPrice`, que ya lleva aplicados el precio
  pactado, la tarifa de gran cliente o el descuento que tocara. El IVA es el 21 %
  incluido, como en el catálogo.

### Pestañas

- **Estadísticas.** Evolución de unidades o importe (por día hasta 31 días, por
  semana hasta 6 meses, por mes a partir de ahí), unidades por día de la semana y
  los 5 productos que más se piden junto a este.
- **Pedidos.** Todas las líneas del producto en el rango, las más recientes
  primero. Aquí sí aparecen las anuladas (tachadas) y los pedidos cancelados.
  Pinchar una abre el pedido en Tareas.
- **Clientes.** Los 10 que más unidades han pedido en el rango.
- **Precios pactados.** Clientes con precio acordado para el producto. Sólo
  lectura: se gestionan desde la ficha del cliente (ver `precios-pactados.md`).
- **Historial de precios.** Cada cambio del precio o de la tarifa de gran
  cliente: fecha, antes, después, variación, desde dónde se hizo y quién.
- **Tiempos** (sólo administración). Ver más abajo.

### Historial de precios

Se registra en todos los sitios que cambian precios: alta del producto, edición
(formulario y edición rápida), cambio en bloque (con el cambio aplicado, p. ej.
«+5 %, redondeo 0,05 €») e importación CSV. Empieza a registrar cuando se
ejecuta `sql/025`; no hay datos de antes.

En la gráfica de evolución de «Estadísticas», cada cambio de precio del periodo
aparece como una línea vertical al inicio de la columna en que ocurrió, y el
detalle sale al pasar por esa columna. Así se ve el efecto de una subida en las
unidades.

El registro nunca impide guardar un precio: si falla (p. ej. falta la tabla),
el precio se guarda y el log del backend lo avisa.

### Tiempos

Para las prendas del producto en pedidos del periodo que pasan por el taller:

| Dato | Qué es |
|---|---|
| Tiempo hasta terminar | Mediana desde el alta del pedido hasta completar el último paso; y en cuánto se terminan 9 de cada 10 |
| Plazo dado al cliente | Mediana desde el alta hasta la fecha de entrega |
| Terminadas a tiempo | Terminadas el día de entrega o antes, sobre las que tienen fecha |
| En curso | Sin terminar en pedidos no recogidos, y cuántas tienen ya la fecha pasada |
| Por paso | Mediana desde el alta hasta completar cada paso del itinerario |

**Por qué no se mide cuánto dura cada paso.** En el taller los pasos se marcan
casi siempre al terminarlos, sin pulsar antes «Iniciar», y muchas veces varios a
la vez. Con los datos de 2026, de 3.815 pasos terminados sólo 16 duraban más de
un minuto: la duración de cada paso saldría a cero. Contar desde el alta del
pedido sí es fiable.

**Por qué «a tiempo» compara días.** La fecha de entrega se guarda a las 00:00
del día, así que comparar con la hora exacta daría por tarde todo lo terminado
ese mismo día.

## API

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/products` (activos; `?archived=all` o `only`) | empleados |
| GET | `/api/products/summary` | empleados |
| GET | `/api/products/categories` | empleados |
| POST, PUT, DELETE | `/api/products/categories[/:id]` | admin |
| POST | `/api/products/bulk-prices` (`aplicar: false` = vista previa) | admin |
| POST | `/api/products/bulk-archive` (`archived: false` = restaurar) | admin |
| GET | `/api/products/:id` | empleados |
| GET | `/api/products/:id/stats?from&to` | empleados |
| GET | `/api/products/:id/lines?from&to&page&size` | empleados |
| GET | `/api/products/:id/agreed-prices` | empleados |
| GET | `/api/products/:id/price-history` | empleados |
| GET | `/api/products/:id/times?from&to` | admin |
| POST | `/api/products` | admin |
| PUT | `/api/products/:id` | admin |
| POST | `/api/products/import` | admin |

## Despliegue

1. Ejecutar `backend/sql/023_indices_estadisticas_productos.sql` (índices; sin él
   la ficha funciona, pero recorre las tablas enteras).
2. Ejecutar `backend/sql/024_productos_archivados_categorias.sql` **antes** de
   desplegar el backend: sin la columna `archived_at` el TPV no carga productos.
   Si falla el índice único de categorías, hay nombres repetidos que unificar
   primero (la consulta está en el propio fichero).
3. Ejecutar `backend/sql/025_historial_precios_productos.sql`. Puede ir antes o
   después del backend, pero los cambios de precio no se registran hasta que
   exista la tabla.
4. Desplegar backend (incluye `npx prisma generate`) y frontend.
