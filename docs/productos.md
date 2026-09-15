# Productos

## Quién puede hacer qué

- **Consultar** el catálogo y la ficha de cada producto: cualquier empleado.
- **Crear, editar e importar** productos: sólo administración. La API responde
  403 al resto y la interfaz no les muestra los botones.

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

## API

| Método | Ruta | Quién |
|---|---|---|
| GET | `/api/products` | empleados |
| GET | `/api/products/:id` | empleados |
| GET | `/api/products/:id/stats?from&to` | empleados |
| GET | `/api/products/:id/lines?from&to&page&size` | empleados |
| GET | `/api/products/:id/agreed-prices` | empleados |
| POST | `/api/products` | admin |
| PUT | `/api/products/:id` | admin |
| POST | `/api/products/import` | admin |

## Despliegue

1. Ejecutar `backend/sql/023_indices_estadisticas_productos.sql` (índices; sin él
   la ficha funciona, pero recorre las tablas enteras).
2. Desplegar backend y frontend.
