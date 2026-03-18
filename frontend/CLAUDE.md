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

**Routing (App.jsx):** `/pos`, `/productos`, `/tareas`, `/usuarios`, `/usuarios/:id`, `/ventas` (admin-only), `/login`. Root redirects to `/pos`.

**Pages (`src/pages/`):**
- `POS.jsx` — Main POS: cart, customer selection, delivery dates, payments, cash register (movements, closures). Largest file (~850 lines).
- `Tasks.jsx` — Order list with status/search/date filters, debounced search (300ms).
- `Ventas.jsx` — Sales dashboard with date range filters, invoice filtering, Excel export. Admin only.
- `Inventory.jsx` — Product CRUD + CSV bulk import.
- `Users.jsx` — User list with role/search filters, pagination.
- `UserEdit.jsx` — User detail with financial summary and order history.

**Components (`src/components/`):** Reusable UI — `PaymentSection` (card/cash payments, invoice generation, status updates), `CartSummary`, `CustomerSelector`, `DateCarousel`, `CashModal`, `Pagination`, `UserForm`, `VentaRow`, `Ticket`, `OrderValidation`, `AuthRedirect`.

**Hooks:** `useOrder.js` — fetch single order with loading/error states.

**Printing (`src/utils/printUtils.js`, `src/qzInit.js`, `src/qzHelper.js`):** QZ Tray integration for thermal printers (ESC/POS). Generates HTML receipts, wash labels, cash reports. Falls back to `window.print()`. Printer names in localStorage.

## Key Conventions

- **Language:** UI text is in Spanish.
- **Currency:** `Intl.NumberFormat('es-ES')` with `€` suffix, 2 decimal places.
- **Auth:** Token and user object stored in `localStorage` (`token`, `user` keys).
- **File naming:** PascalCase for pages/components (`.jsx`), camelCase for utils/hooks (`.js`).
- **Styling:** Mix of UIKit CSS classes, MUI components, and some Tailwind utilities. Theme customized in `src/styles/uikit-theme.less` (primary: `#048ABF`, font: Noto Sans).
- **Modals/offcanvas:** UIKit modal and offcanvas patterns (triggered via `UIkit.modal()`, `UIkit.offcanvas()`).
- **API calls:** Always use functions from `src/api.js`; don't create standalone fetch calls.
- **Client pricing:** Products have `basePrice` and `bigClientPrice`; users flagged with `isbigclient` get the alternate price.
