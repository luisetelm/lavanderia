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

**Routing (App.jsx):** `/pos`, `/productos`, `/productos/:id`, `/tareas`, `/usuarios`, `/usuarios/:id`, `/ventas` (admin-only), `/login`. Root redirects to `/pos`.

**Pages (`src/pages/`):**
- `POS.jsx` — Main POS: cart, customer selection, delivery dates, payments, cash register (movements, closures). Largest file (~850 lines).
- `Tasks.jsx` — Order list with status/search/date filters, debounced search (300ms).
- `Ventas.jsx` — Sales dashboard with date range filters, invoice filtering, Excel export. Admin only.
- `Inventory.jsx` — Product catalog: filters and sort persisted in localStorage, activity columns (`GET /api/products/summary`), inline editing, Excel export, and admin-only duplicate, archive, bulk price change (`BulkPriceModal`, preview computed by the backend) and categories (`ProductCategoriesModal`). `GET /api/products` returns only active products unless `?archived=all`, so the POS never shows archived ones.
- `ProductDetail.jsx` — Product page (`/productos/:id`): data, order KPIs vs previous period, charts (`components/ProductCharts.jsx`, hand-made SVG) with price changes marked, orders, top clients, agreed prices, price history (`backend/src/utils/historialPrecios.js`) and admin-only lead times. Times are measured from order creation to each step's completion, never per-step duration (steps are usually completed without being started). See `docs/productos.md`.
- `StripeBalance.jsx` — Stripe balance (`/stripe`, admin only): pending and available balance, payout schedule, payouts to the bank (expandable to the charges, refunds and fees each one includes) and recent balance movements. Read live from Stripe via `GET /api/stripe/balance` and `GET /api/stripe/payouts/:id/transactions`; each movement is matched to its order/invoice/client through `Payment.stripePaymentId` (the payment_intent). Nothing is stored.
- `Users.jsx` — User list with role/search filters, pagination.
- `UserEdit.jsx` — User detail with financial summary and order history.

**Components (`src/components/`):** Reusable UI — `PaymentSection` (card/cash payments, invoice generation, status updates), `CartSummary`, `CustomerSelector`, `DateCarousel`, `CashModal`, `Pagination`, `UserForm`, `VentaRow`, `Ticket`, `OrderValidation`, `AuthRedirect`.

**Hooks:** `useOrder.js` — fetch single order with loading/error states. `useDraftOrder.js` — draft order context (POS cart). `useMessages.js` — shared messaging state.

**Chat flotante (`src/components/chat/`, `src/context/MessagesContext.jsx`):** No hay página de mensajes; el chat es un widget flotante (`ChatWidget`) montado en el layout de `App.jsx` sobre cualquier ruta, sólo para admin/cajero. `MessagesProvider` hace el único polling de conversaciones (15 s), lleva el contador, el sonido, las notificaciones del sistema (permiso pedido desde el clic, no al cargar) y el estado abierto/ancho del panel. `ClientContextPanel` muestra ficha, pedidos y acciones del cliente de la conversación, y permite vincular números desconocidos (`POST /messages/conversations/:id/link-client`).

**Printing (`src/utils/printUtils.js`, `src/qzInit.js`, `src/qzHelper.js`):** QZ Tray integration for thermal printers (ESC/POS). Generates HTML receipts, wash labels, cash reports. Falls back to `window.print()`. Printer names in localStorage.

## Key Conventions

- **Language:** UI text is in Spanish.
- **Currency:** `Intl.NumberFormat('es-ES')` with `€` suffix, 2 decimal places.
- **Auth:** Token and user object stored in `localStorage` (`token`, `user` keys).
- **File naming:** PascalCase for pages/components (`.jsx`), camelCase for utils/hooks (`.js`).
- **Styling:** Mix of UIKit CSS classes, MUI components, and some Tailwind utilities. Theme customized in `src/styles/uikit-theme.less` (primary: `#048ABF`, font: Noto Sans).
- **Modals/offcanvas:** UIKit modal and offcanvas patterns (triggered via `UIkit.modal()`, `UIkit.offcanvas()`).
- **API calls:** Always use functions from `src/api.js`; don't create standalone fetch calls.
- **SEPA direct debit:** A client signs a Stripe SEPA mandate once (link from the "Domiciliación" tab of the client page, `components/ClientSepaTab.jsx`, or from the portal); then invoices are debited automatically when the monthly invoice is generated, or manually ("Cobrar por SEPA", or "Adeudo SEPA" when collecting in Ventas). While `invoices.paymentStatus` is `sepa_processing` the invoice must not be collected any other way; `sepa_failed` means rejected or returned and still unpaid. Labels in `utils/sepa.js`, logic in `backend/src/services/sepa.js`. See `docs/domiciliacion-sepa.md`.
- **Facturas proforma:** el presupuesto que el cliente presenta ante un tercero (una aseguradora). No es una factura: vive en sus propias tablas con serie `PRO/`, no toca `invoices` ni marca el pedido como facturado, y **se puede borrar sin dejar rastro** si no la aceptan. Se emite desde la fila de Ventas (`components/ProformaModal.jsx`); con una en vigor desaparecen los botones de factura normal, porque la factura se emite desde la proforma para que quede ligada a ella. Backend en `backend/src/routes/proformas.js`. Ver `docs/factura-proforma.md`.
- **Teléfonos de cliente:** se guardan normalizados: español con 9 dígitos sin prefijo (`612345678`); extranjero en E.164 con el más (`+33612345678`). `utils/telefono.js` (`normalizarTelefono`, `esTelefonoValido`, `TELEFONO_AYUDA`) replica la regla de `backend/src/utils/validatePhone.js`, que es la que vale. Un número tecleado a mano sólo es extranjero si empieza por `+` o `00`; sin prefijo tiene que ser español. Los avisos (WhatsApp/SMS) añaden el 34 sólo a los españoles.
- **Pedido en curso (`DraftOrderContext`):** se persiste en `localStorage` (clave `draftOrder`) para sobrevivir al cierre del navegador; un solo borrador por equipo. Los fallos al validar (`DraftOrderBanner`) se muestran en la barra y como notificación, con el motivo y un botón que lleva al campo a corregir (ids `pos-cliente`, `pos-cliente-buscar`, `pos-cliente-nombre`, `pos-cliente-apellidos`, `pos-cliente-telefono`, `pos-prendas`).
- **Client pricing:** A line's unit price is, in order: the client's agreed price for that product if one is in force (`client_product_price`, managed in the "Precios pactados" tab of the client page), else `bigClientPrice` for users flagged `isbigclient`, else `basePrice`. The client's % discount is not applied on agreed prices. The backend (`backend/src/utils/precioLinea.js`) is authoritative; `DraftOrderContext.getPriceForItem` only mirrors it for display. See `docs/precios-pactados.md`.
