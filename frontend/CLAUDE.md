# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Laundry management system frontend (Tinte y Burbuja) — POS, orders, inventory, users, invoicing, and cash register management. Built with React 19 + Vite 5, using JavaScript (no TypeScript).

## Commands

```bash
npm run dev        # Start dev server (Vite HMR)
npm run build      # Production build
npm run lint       # ESLint
npm run preview    # Preview production build
```

No test framework is configured.

## Architecture

**Stack:** React 19, React Router DOM 7, Vite 5, UIKit 3 + MUI 7, Tailwind CSS 4, LESS for theme, dayjs, SheetJS (xlsx export), QZ Tray (thermal printing).

**API layer:** `src/api.js` — centralized fetch wrapper using Bearer token auth. Base URL from `VITE_API_BASE` env var (defaults to `/api`). Vite proxy forwards `/api` to `http://localhost:4000`. On 401, dispatches a custom `unauthorized` window event caught by `AuthRedirect` component.

**State management:** Plain React hooks (useState/useCallback). No Redux/Context. State flows from `App.jsx` down as props (token, user, setToken, setUser).

**Routing (App.jsx):** `/pos`, `/productos`, `/productos/:id`, `/pedidos` (order list; `/tareas` redirects here keeping the query string), `/pedidos/:id`, `/entregas`, `/clientes`, `/personal` (admin-only; `/usuarios` redirects to `/clientes`), `/usuarios/:id` (ficha), `/ventas` (admin-only), `/login`. Root redirects to `/pos`.

**Navegación a pedidos y clientes:** siempre con `rutaPedido(order)` y `rutaCliente(client)` de `src/utils/rutas.js`, nunca con rutas escritas a mano. Un pedido se abre en `/pedidos/:id` (`pages/OrderDetail.jsx`); `/pedidos?pedido=NUM` (o la antigua `/tareas?pedido=NUM`) sigue valiendo como filtro para enlaces antiguos.

**Pages (`src/pages/`):**
- `POS.jsx` — Main POS: cart, customer selection, delivery dates, payments, cash register (movements, closures). Largest file (~850 lines).
- `Tasks.jsx` — Order list (`/pedidos`, shown as "Pedidos") with status/search/date filters, debounced search (300ms). Filters live in the URL (`?q=&estado=&trabajador=&orden=&dir=&pagina=`). Each row is the full `PaymentSection` card; its order number links to `OrderDetail.jsx` to see that order alone.
- `OrderDetail.jsx` — Order page (`/pedidos/:id`): header with back button, client link, phone, "Nuevo pedido" for that client and portal link, over `PaymentSection` (payments, status, lines, tracking, history, invoices).
- `Deliveries.jsx` — Entregas (`/entregas?dia=YYYY-MM-DD`): what has to be delivered one day, overdue orders on top, grouped by status, with big "Listo" / "Entregar" buttons for the workshop tablet. Uses `GET /orders?deliveryFrom&deliveryTo` (delivery date, not creation) and `status` with comma-separated values; auto-refreshes every minute.
- `Ventas.jsx` — Sales dashboard with date range filters, invoice filtering, Excel export. Admin only.
- `Inventory.jsx` — Product catalog: filters and sort persisted in localStorage, activity columns (`GET /api/products/summary`), inline editing, Excel export, and admin-only duplicate, archive, bulk price change (`BulkPriceModal`, preview computed by the backend) and categories (`ProductCategoriesModal`). `GET /api/products` returns only active products unless `?archived=all`, so the POS never shows archived ones.
- `ProductDetail.jsx` — Product page (`/productos/:id`): data, order KPIs vs previous period, charts (`components/ProductCharts.jsx`, hand-made SVG) with price changes marked, orders, top clients, agreed prices, price history (`backend/src/utils/historialPrecios.js`) and admin-only lead times. Times are measured from order creation to each step's completion, never per-step duration (steps are usually completed without being started). See `docs/productos.md`.
- `StripeBalance.jsx` — Stripe balance (`/stripe`, admin only): pending and available balance, payout schedule, payouts to the bank (expandable to the charges, refunds and fees each one includes) and recent balance movements. Read live from Stripe via `GET /api/stripe/balance` and `GET /api/stripe/payouts/:id/transactions`; each movement is matched to its order/invoice/client through `Payment.stripePaymentId` (the payment_intent). Nothing is stored.
- `Users.jsx` — One list, two entries: `/clientes` (`modo="clientes"`, only role customer, Propiedad filter) and `/personal` (`modo="personal"`, admin only, staff roles with a Rol filter). Search, filters and page live in the URL. Clients and staff share the `User` table, distinguished by `role`.
- `UserEdit.jsx` — User detail with financial summary and order history; for clients also "Nuevo pedido" (loads the client into the draft order and opens the POS), "Chat" when a conversation exists, and the delivery date of each order (overdue in red).

**Components (`src/components/`):** Reusable UI — `PaymentSection` (card/cash payments, invoice generation, status updates), `CartSummary`, `CustomerSelector`, `DateCarousel`, `CashModal`, `Pagination`, `UserForm`, `VentaRow`, `Ticket`, `OrderValidation`, `AuthRedirect`.

**Hooks:** `useOrder.js` — fetch single order with loading/error states. `useDraftOrder.js` — draft order context (POS cart). `useMessages.js` — shared messaging state.

**Chat flotante (`src/components/chat/`, `src/context/MessagesContext.jsx`):** No hay página de mensajes; el chat es un widget flotante (`ChatWidget`) montado en el layout de `App.jsx` sobre cualquier ruta, sólo para admin/cajero. `MessagesProvider` hace el único polling de conversaciones (15 s), lleva el contador, el sonido, las notificaciones del sistema (permiso pedido desde el clic, no al cargar) y el estado abierto/ancho del panel. `ClientContextPanel` muestra ficha, pedidos y acciones del cliente de la conversación, y permite vincular números desconocidos (`POST /messages/conversations/:id/link-client`). El botón ✨ del compositor (`ChatThread.jsx`, `suggestReply` → `POST /messages/conversations/:id/suggest`) pide al asistente (`backend/src/services/asistente.js`, Claude con las herramientas de lectura del conector MCP) un borrador de respuesta que se deja en el compositor sin enviar; si ya hay texto escrito se usa como indicación. Ver `docs/conector-mcp.md`.

**Printing (`src/utils/printUtils.js`, `src/qzInit.js`, `src/qzHelper.js`):** QZ Tray integration for thermal printers (ESC/POS). Generates HTML receipts, wash labels, cash reports. Falls back to `window.print()`. Printer names in localStorage.

## Key Conventions

- **Language:** UI text is in Spanish.
- **Currency:** `Intl.NumberFormat('es-ES')` with `€` suffix, 2 decimal places.
- **Auth:** Token and user object stored in `localStorage` (`token`, `user` keys).
- **File naming:** PascalCase for pages/components (`.jsx`), camelCase for utils/hooks (`.js`).
- **Styling:** Mix of UIKit CSS classes, MUI components, and some Tailwind utilities. Design tokens in `src/styles/tokens.css` (`--tyb-*`, shared verbatim with the public site repo `Lavanderaweb`; see `docs/sistema-de-diseno.md`). Theme in `src/styles/uikit-theme.less` mirrors them (primary: `#0a779b`, font: Inter; Bebas Neue only for display headings). New styles use `var(--tyb-*)`, never hardcoded hex.
- **Modals/offcanvas:** UIKit modal and offcanvas patterns (triggered via `UIkit.modal()`, `UIkit.offcanvas()`).
- **API calls:** Always use functions from `src/api.js`; don't create standalone fetch calls.
- **SEPA direct debit:** A client signs a Stripe SEPA mandate once (link from the "Domiciliación" tab of the client page, `components/ClientSepaTab.jsx`, or from the portal); then invoices are debited automatically when the monthly invoice is generated, or manually ("Cobrar por SEPA", or "Adeudo SEPA" when collecting in Ventas). While `invoices.paymentStatus` is `sepa_processing` the invoice must not be collected any other way; `sepa_failed` means rejected or returned and still unpaid. Labels in `utils/sepa.js`, logic in `backend/src/services/sepa.js`. See `docs/domiciliacion-sepa.md`.
- **Facturas proforma:** el presupuesto que el cliente presenta ante un tercero (una aseguradora). No es una factura: vive en sus propias tablas con serie `PRO/`, no toca `invoices` ni marca el pedido como facturado, y **se puede borrar sin dejar rastro** si no la aceptan. Se emite desde la fila de Ventas (`components/ProformaModal.jsx`); con una en vigor desaparecen los botones de factura normal, porque la factura se emite desde la proforma para que quede ligada a ella. Backend en `backend/src/routes/proformas.js`. Ver `docs/factura-proforma.md`.
- **Teléfonos de cliente:** se guardan normalizados: español con 9 dígitos sin prefijo (`612345678`); extranjero en E.164 con el más (`+33612345678`). `utils/telefono.js` (`normalizarTelefono`, `esTelefonoValido`, `TELEFONO_AYUDA`) replica la regla de `backend/src/utils/validatePhone.js`, que es la que vale. Un número tecleado a mano sólo es extranjero si empieza por `+` o `00`; sin prefijo tiene que ser español. Los avisos (WhatsApp/SMS) añaden el 34 sólo a los españoles.
- **Pedido en curso (`DraftOrderContext`):** se persiste en `localStorage` (clave `draftOrder`) para sobrevivir al cierre del navegador; un solo borrador por equipo. Los fallos al validar (`DraftOrderBanner`) se muestran en la barra y como notificación, con el motivo y un botón que lleva al campo a corregir (ids `pos-cliente`, `pos-cliente-buscar`, `pos-cliente-nombre`, `pos-cliente-apellidos`, `pos-cliente-telefono`, `pos-prendas`).
- **Recogida sin cobrar:** un pedido no cobrado no se marca como recogido, salvo que el cliente sea gran cliente (`isbigclient`) o tenga facturación automática mensual (`autoMonthlyInvoice`): se lo lleva y se le cobra en el momento o después (el botón Cobrar sigue disponible). La regla está en `PATCH /orders/:id` y en `POST /orders/bulk-status`; el frontend la replica en `utils/pedidos.js` (`sePuedeRecoger`, `cobroAplazado`) para pintar los botones.
- **Pedido facturado sin cobrar:** cuando un pedido entra en una factura normal (`type 'n'`) que sigue sin cobrar, lo pendiente es la factura y no el pedido. `POST /orders/:id/pay` y los enlaces de Stripe del pedido lo rechazan; la tarjeta del pedido (`PaymentSection`) cambia el botón Cobrar por "Cobrar factura", que cobra la factura entera (`POST /invoices/:id/collect`) y deja cobrados todos sus pedidos. Las simplificadas no cuentan: se siguen cobrando desde el pedido, sin emitir otra factura. La regla está en `backend/src/utils/facturaDe.js` (`facturaPendienteDe`) y el frontend la replica en `utils/pedidos.js` (`facturaPendiente`).
- **Justificante de cobro:** al cobrar una factura normal por cualquier vía (efectivo, tarjeta o transferencia desde Ventas o la ficha del pedido, cobro en lote, enlace de Stripe, adeudo SEPA confirmado) se regenera su PDF con "Pagada", la fecha y la forma de cobro, y se envía al cliente por correo con copia a hola@tinteyburbuja.com. Va en segundo plano y nunca rompe el cobro: `enviarJustificanteCobro()` en `backend/src/routes/invoices.js`. Las simplificadas no tienen PDF ni justificante. Como el correo de emisión, se apaga con `EMAIL_DISABLED=1`.
- **Datos del cliente para facturar:** la factura normal exige nombre (o razón social), email, dirección, C.P. y localidad (`backend/src/utils/datosFactura.js`), pero la ficha no los pide al dar de alta. Si faltan, el backend responde `code: 'DATOS_FACTURA'` con `clientId` y `missing`; toda emisión de factura normal desde el frontend va envuelta en `conDatosFactura(token, () => ...)` (`utils/datosFactura.js`), que abre `DatosFacturaHost` (montado en App) para completarlos, los guarda con `PATCH /users/:id/datos-factura` (sólo campos fiscales) y repite la emisión.
- **Cantidad de las líneas del pedido en curso:** en `DraftLines` la cantidad se puede escribir (además de − y +); se aplica al salir del campo o con Intro, vacío o 0 vuelve al valor anterior y el máximo es 9999. Desglosar más de 20 unidades pide confirmación.
- **Cobro mixto:** un pedido se puede cobrar con una parte en efectivo y el resto con tarjeta (`method: 'mixed'` con `cashAmount` en `POST /orders/:id/pay`): crea un `Payment` por cada parte, el efectivo entra en caja y `Order.paymentMethod` queda en `mixed`. Siempre liquida el total; no hay pagos a cuenta.
- **Cambio de estado en lote:** en la pestaña Pedidos de la ficha del cliente (`UserEdit.jsx`) se marcan pedidos con casillas y se pasan todos a cualquier estado (`components/BulkStatusModal.jsx` → `POST /orders/bulk-status`). No es todo o nada: los que no cumplen la regla (sin cobrar al entregar, cobrados al cancelar, ya en ese estado) se omiten y el resto cambia; el aviso al cliente (SMS/WhatsApp) es uno por pedido y opcional.
- **Precios en la web pública:** cada producto puede publicarse en la tarifa de tinteyburbuja.com con `webSection` (`lavado` | `tintoreria` | `hosteleria`, null = no), `webName` y `webOrder` (bloque "Web pública" de `ProductModal.jsx`). Sólo sale `basePrice`; en hostelería sin precio. Endpoints sin token en `backend/src/routes/public.js`: `GET /api/public/prices` y `POST /api/public/price-request` (petición de precio desde la web: manda la plantilla `precio_web` con el precio si es un producto de la tarifa, y siempre entra en el chat como mensaje del canal `web`). Ver `docs/precios-web.md`.
- **Client pricing:** A line's unit price is, in order: the client's agreed price for that product if one is in force (`client_product_price`, managed in the "Precios pactados" tab of the client page), else `bigClientPrice` for users flagged `isbigclient`, else `basePrice`. The client's % discount is not applied on agreed prices. The backend (`backend/src/utils/precioLinea.js`) is authoritative; `DraftOrderContext.getPriceForItem` only mirrors it for display. See `docs/precios-pactados.md`.
