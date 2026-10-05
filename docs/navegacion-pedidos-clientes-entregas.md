# Navegación entre pedidos, clientes y entregas: diagnóstico y plan

Punto de partida (octubre 2026), lo que se ha observado usando la app:

1. La lista de pedidos que hay que entregar hoy sólo se ve en el TPV, pasando el
   ratón por encima de un día del calendario. Para el personal de la lavandería
   esa información es la más práctica del día y está escondida.
2. Al hacer clic en un pedido de ese desplegable se abre la vista de todos los
   pedidos, no el pedido en concreto.
3. Las vistas no están conectadas: el nombre del cliente no lleva a su ficha,
   y en general cada pantalla es un callejón sin salida.

Este documento recoge lo que se ha encontrado al revisar el código a raíz de
esos tres puntos y propone un plan en fases. No se ha cambiado código todavía.

---

## 1. Diagnóstico

### 1.1 Por qué el clic en el calendario del TPV abre "todos los pedidos"

`DateCarousel.jsx` monta el desplegable de cada día con
`uk-dropdown="... container: true"`. Esa opción hace que UIkit **saque el
desplegable del árbol de React y lo cuelgue de `<body>`** (se puso así para que
no lo recorte la columna del pedido, que tiene `overflow-y: auto`).

Consecuencia: React 17+ escucha los eventos en el nodo raíz de la aplicación.
Un elemento que vive fuera de ese nodo no le llega a React, así que el `onClick`
del `<Link to="/tareas" state={...}>` nunca se ejecuta. El navegador hace lo que
haría con cualquier `<a href="/tareas">`: **una carga completa de la página**.
Al recargar se pierde el `location.state` que llevaba el pedido, y `Tareas`
arranca sin filtro, enseñando todos los pedidos.

Es un fallo de mecánica (el enlace nunca funcionó), no de datos: el
`orderNum` sí viaja en la respuesta de `/orders/delivery-dates`.

### 1.2 No existe una vista de detalle de pedido

Hoy "abrir un pedido" significa navegar a `/tareas` pasando
`{filterOrderId, orderNumber}` en el `state` de la ruta. `Tareas` copia el
número al buscador y la lista queda filtrada por texto. Lo hacen **nueve sitios**:

| Dónde | Archivo |
|---|---|
| Calendario del TPV | `components/DateCarousel.jsx` |
| Banner de pedido en curso (al crear) | `components/DraftOrderBanner.jsx` |
| Panel de cliente del chat (2 veces) | `components/chat/ClientContextPanel.jsx` |
| Dashboard (3 listas) | `pages/Dashboard.jsx` |
| Ficha de cliente, pestaña Pedidos | `pages/UserEdit.jsx` |
| Ficha de producto | `pages/ProductDetail.jsx` |
| Tracking (supervisión) | `pages/TrackingBoard.jsx` |
| Ventas, botón "Ver pedido" | `pages/Ventas.jsx` |
| Aterrizaje del QR del ticket | `pages/OrderLookup.jsx` |

Problemas de este diseño:

- **Se pierde al recargar, al abrir en otra pestaña y al compartir el enlace.**
  La URL siempre es `/tareas`; el estado va en memoria.
- **No es un detalle, es una búsqueda.** El filtro `q` del backend hace
  `contains` sobre `orderNum`, nombre, email y teléfono. Cuando falta
  `orderNum` y se usa el `id` (varios sitios hacen `o.orderNum || o.id`), un
  "163" encuentra `TPV/2026/0163`, `TPV/2025/1630` y cualquier teléfono que
  contenga 163.
- **Pesado.** Cada fila de `Tareas` es un `PaymentSection` completo (1.200
  líneas: cobros, cambio de estado, notificaciones, Stripe...). Para ver un
  pedido se montan hasta veinte.
- El QR del ticket (`/buscar-pedido`) aterriza en la misma lista.

### 1.3 Falta de interconexión

- **Nombre del cliente sin enlace** en la tarjeta de pedido
  (`PaymentSection`), en Tareas, en las tres listas del Dashboard, en Ventas
  (`VentaRow`) y en el taller (`TrackingWorkshop`, `TrackingBoard`).
  La ficha existe (`/usuarios/:id`, con pestañas Pedidos, Facturas, Precios,
  SEPA, Notificaciones) pero sólo se llega desde el selector de cliente del
  TPV, el chat, Stripe, la ficha de producto y los accesos.
- **Los clientes viven en "Usuarios"** junto a cajeros y administración. El
  menú lateral no dice "Clientes" en ningún sitio; hay que entrar en Usuarios
  y filtrar por rol.
- Las píldoras "Pendientes" y "Listos" del Dashboard llevan a `/tareas` **sin
  aplicar el filtro de estado**.
- Los filtros de Tareas (estado, trabajador, orden, búsqueda, página) no
  están en la URL: al volver atrás desde cualquier sitio se pierden.
- Desde la ficha de cliente no se puede empezar un pedido para ese cliente
  (el borrador ya admite `setSelectedUser`, lo usa el chat).

### 1.4 Las entregas del día no tienen vista propia

- El desplegable del calendario es **sólo por hover**: en la tablet del taller
  no se puede abrir (no hay hover en táctil), y hay que estar en el TPV, es
  decir, en medio de crear un pedido.
- `GET /orders` filtra por fecha de **creación** (`startDate`/`endDate` sobre
  `createdAt`). No hay forma de pedir "los pedidos que se entregan tal día".
  La única consulta por `fechaLimite` es `pedidosPorDia()` en
  `utils/cargaTrabajo.js`, pensada para calcular carga, que devuelve pedidos
  completos sin paginar.
- El Dashboard muestra "Pendientes de hacer" ordenados por fecha de entrega,
  pero son los 15 primeros y sin agrupar por día; los atrasados y los de hoy
  se mezclan con los de la semana que viene.
- Tareas permite ordenar por entrega, pero no filtrar por ella.

### 1.5 Otros hallazgos menores

- `GET /api/tasks` devuelve 500 (`prisma.task` no existe; ya documentado en
  `ajustes-pedidos-facturados.md`). No lo llama nadie, pero la ruta y el
  menú siguen hablando de "Tareas" cuando son pedidos.
- El frontend no tiene tests ni comprobación de tipos; sólo `eslint`. Cualquier
  refactor de navegación hay que validarlo a mano.

---

## 2. Principios para el plan

1. **Cada cosa tiene una URL.** Un pedido es `/pedidos/:id`; un cliente,
   `/clientes/:id`; las entregas de un día, `/entregas?dia=2026-10-05`. Si se
   puede recargar, compartir y abrir en otra pestaña, funciona.
2. **Un solo helper de navegación** para ir a un pedido o a un cliente, en vez
   de repetir el `navigate('/tareas', {state})` en nueve sitios. Cuando se
   cambie el destino, se cambia en un sitio.
3. **Todo nombre es un enlace.** Donde aparezca un pedido o un cliente, se
   puede pulsar.
4. **Pensado para la tablet.** Lo que use la gente de la lavandería tiene que
   funcionar con el dedo: nada que dependa de hover.
5. **Cambios de backend mínimos y aditivos.** Nuevos parámetros opcionales en
   rutas existentes; nada de migraciones (ver aviso sobre Prisma en
   `ajustes-pedidos-facturados.md`).

---

## 3. Plan por fases

Cada fase es un conjunto desplegable por sí solo. El orden responde al
beneficio por esfuerzo: primero se arregla lo roto, después se construye.

### Fase 1 — Arreglar el enlace del calendario y hacer robusto el "ir a pedido"

Esfuerzo: medio día. Sin backend.

1. **`Tareas` lee el pedido de la URL.** Admite `/tareas?pedido=TPV/2026/0163`
   además del `state` actual (que se mantiene por compatibilidad). Así el
   filtro sobrevive a una recarga.
2. **Helper `rutaPedido(order)`** en `utils/` que devuelve esa URL, y
   sustitución en los nueve sitios de la tabla de 1.2. Tras la fase 2 el
   helper pasará a devolver `/pedidos/:id` sin tocar nada más.
3. **Desplegable del calendario en React.** Sustituir el `uk-dropdown` con
   `container: true` por un popover propio con `createPortal` a `<body>`
   (mantiene la solución al recorte por `overflow`, pero los eventos siguen
   siendo de React). Se abre con hover en escritorio **y con un toque en
   táctil**, y se cierra al tocar fuera.
4. Dentro del popover, cada pedido enlaza con `rutaPedido`, y el nombre del
   cliente con su ficha.

Resultado: el clic del punto 2 del usuario funciona, y ningún enlace a pedido
vuelve a perderse al recargar.

### Fase 2 — Página de detalle de pedido

Esfuerzo: 2 días. Backend: ninguno (`GET /orders/:id`, `/history`,
`/portal-link` y tracking ya existen).

Nueva ruta `/pedidos/:id` (`pages/OrderDetail.jsx`) que reúne lo que hoy está
repartido:

- Cabecera: número, estado, cliente **enlazado a su ficha**, teléfono con
  acceso directo al chat, fechas de creación y entrega (editable, como ahora),
  aviso de atrasado.
- Cuerpo: `PaymentSection` tal cual (cobro, estado, trabajador,
  notificaciones) y, en pestañas o acordeón, el historial (`OrderHistory`), el
  tracking por prenda y las facturas del pedido.
- Acciones: reimprimir ticket y etiquetas, enlace del portal del cliente,
  ajustar pedido, "Nuevo pedido para este cliente".
- "Volver" que respeta de dónde se vino (Tareas, Dashboard, Ventas...).

`rutaPedido` pasa a apuntar aquí. `OrderLookup` (QR) aterriza aquí. En `Tareas`
cada fila se compacta: una tarjeta ligera (cliente, número, estado, entrega,
importe, botón de cobro rápido) que abre el detalle. La lista deja de montar
veinte `PaymentSection`.

### Fase 3 — Vista "Entregas" para la lavandería

Esfuerzo: 2 días. Backend: un parámetro nuevo.

1. **Backend.** `GET /orders` admite `deliveryFrom` / `deliveryTo` (filtro sobre
   `fechaLimite`, formato `YYYY-MM-DD`, mismo tratamiento de día completo que
   hoy tiene `startDate`/`endDate`). Aditivo, sin romper a nadie.
2. **Página `/entregas`** (`pages/Deliveries.jsx`), en el menú principal, con
   acceso para trabajadores:
   - Selector de día con "Hoy", anterior y siguiente, y calendario para saltar.
     El día va en la URL (`?dia=2026-10-05`).
   - Bloque fijo arriba con los **atrasados** (fecha de entrega pasada y no
     recogidos), porque son los que hay que resolver antes.
   - Lista del día agrupada por estado (pendiente, en proceso, listo,
     recogido) con contador; cada fila: cliente (enlace), número (enlace),
     prendas resumidas, carga, si está pagado.
   - Botones grandes: "Marcar listo" y "Entregar / recogido", que ya existen
     en `StatusChangeModal`. Diseñado para dedo.
   - Filtro de texto por cliente o número.
3. **Enlaces de entrada.** En el Dashboard, una tarjeta "Entregas hoy: N
   (M atrasados)" que lleva a `/entregas`. En el popover del calendario del
   TPV, un pie "Ver el día completo" que lleva a `/entregas?dia=...`.

Con esto el punto 1 del usuario deja de ser un hover escondido en el TPV: es una
pantalla propia que se puede dejar abierta en la tablet.

### Fase 4 — Interconexión general

Esfuerzo: 1,5 días. Sin backend.

1. **Helper `rutaCliente(client)`** y nombre de cliente enlazado en:
   `PaymentSection`, tarjeta de Tareas, las tres listas del Dashboard,
   `VentaRow`, `TrackingWorkshop`, `TrackingBoard`, panel de pendientes de
   facturar del TPV.
2. **Entrada "Clientes" en el menú lateral**, que es `/usuarios?rol=customer`
   (o una ruta `/clientes` que reutiliza `Users` con el filtro fijado). Los
   filtros de Usuarios pasan a la URL de paso.
3. **Ficha de cliente**: botón "Nuevo pedido" (carga el cliente en el borrador
   y abre el TPV), botón "Chat" si tiene conversación, y en la pestaña Pedidos
   columna de fecha de entrega con los atrasados marcados.
4. **Dashboard**: las píldoras "Pendientes" y "Listos" llevan a
   `/tareas?estado=pending` y `/tareas?estado=ready`. Para eso, Tareas lleva
   **todos sus filtros a la URL** (estado, trabajador, orden, búsqueda,
   página), lo que de paso arregla el "volver atrás pierde los filtros".
5. **Taller**: la tarjeta de cada prenda enlaza al detalle del pedido
   (`/pedidos/:id`), que hoy no se puede abrir desde allí.

### Fase 5 — Limpieza

Esfuerzo: medio día, repartido.

- Renombrar en el menú "Tareas" por "Pedidos" (la ruta `/tareas` se mantiene
  con redirección para no romper QR impresos ni marcadores).
- Retirar `GET /api/tasks` o restaurar el modelo, según se decida en el
  documento de ajustes.
- Quitar el uso de `state` en la navegación una vez que todos los sitios
  pasen por los helpers.

---

## 4. Resumen de cambios de backend

| Cambio | Ruta | Fase | Riesgo |
|---|---|---|---|
| Parámetros `deliveryFrom`, `deliveryTo` (filtro por `fechaLimite`) | `GET /orders` | 3 | Bajo, aditivo |
| Contador de entregas de hoy y atrasados | `GET /dashboard` | 3 | Bajo, aditivo |

Todo lo demás es frontend. No hay cambios de esquema.

## 5. Cómo validar

No hay tests de frontend, así que cada fase se comprueba a mano con esta lista:

- Recargar la página en `/pedidos/:id`, `/entregas?dia=...` y
  `/tareas?pedido=...`: se mantiene lo que se veía.
- Abrir un pedido desde los nueve orígenes de la tabla de 1.2 y desde el QR de
  un ticket: siempre se llega al mismo detalle.
- En una tablet (o con el modo táctil del navegador): abrir el popover del
  calendario con un toque, pulsar un pedido, pulsar un cliente.
- Botón atrás del navegador desde el detalle: vuelve a la lista con los mismos
  filtros.
- `npm run lint` en `frontend/` limpio.
