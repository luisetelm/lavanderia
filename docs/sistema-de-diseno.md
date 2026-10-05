# Sistema de diseño · Tinte y Burbuja

Un solo sistema para la web pública (`Lavanderaweb`) y la app de gestión (`lavanderia/frontend`).
La fuente de verdad es `src/styles/tokens.css`, **copia idéntica en los dos repos**: se cambia en uno y se copia al otro.

## Color

Los dos colores de marca salen del logo (`favicon.svg`): el anillo es azul petróleo `#0a779b` y las burbujas cian `#00a8cf`.
Hasta ahora ninguno de los dos repos los usaba: la web llevaba `#0D6EAC` y la app `#048ABF`.

| Token | Hex | Uso | Contraste sobre blanco |
|---|---|---|---|
| `--tyb-brand-700` (primario) | `#0a779b` | Botones, enlaces, títulos de sección | 5.1:1 (AA) |
| `--tyb-brand-800` | `#0b5f7c` | Hover del primario | 7.1:1 (AAA) |
| `--tyb-brand-500` (acento) | `#00a8cf` | Iconos, subrayados, burbujas, sobre fondos oscuros. **Nunca texto sobre blanco** | 2.8:1 |
| `--tyb-brand-950` | `#073243` | Sidebar de la app, footer y hero de la web | — |
| `--tyb-brand-50` | `#e9f7fb` | Fondos suaves, chips informativos | — |
| `--tyb-neutral-900` | `#15202a` | Texto | 16.5:1 |
| `--tyb-neutral-500` | `#65788a` | Texto secundario (mínimo legible) | 4.6:1 |
| `--tyb-neutral-200` | `#dde4e8` | Bordes | — |
| `--tyb-neutral-50` | `#f6f9fa` | Fondo de página | — |
| `--tyb-success` / `--tyb-warning` / `--tyb-danger` | `#15805a` / `#9a6508` / `#c53a28` | Estados. Cada uno tiene su `-soft` para fondos | ≥4.5:1 |

Reglas:
- El código usa los tokens **semánticos** (`--tyb-primary`, `--tyb-text`, `--tyb-surface`, `--tyb-border`…), no las escalas.
- Un solo acento. Fuera los pasteles por tarjeta (rosa, morado, verde, ámbar) y los degradados decorativos. Si una sección necesita fondo, `--tyb-surface-muted` o `--tyb-surface-dark`.
- El verde de WhatsApp (`--tyb-whatsapp`) es la única excepción, porque es la marca de otro.
- El cian vive en iconos, detalles y sobre azul oscuro, donde sí contrasta (5.9:1 sobre `neutral-900`).

## Tipografía

Dos familias en los dos sitios, cargadas desde Google Fonts:

- **Bebas Neue** (`--tyb-font-display`): la aproximación libre a la letra del logo. Solo `h1`, `h2` y cifras grandes, siempre en mayúsculas con `letter-spacing: 0.02em`. Nunca en párrafos ni en controles.
- **Inter** (`--tyb-font-sans`): todo lo demás, en 400/500/600/700. Se elige frente a Poppins porque ya está en la app, rinde mejor en tablas y tickets (cifras tabulares con `font-variant-numeric: tabular-nums`) y no compite con Bebas.

Desaparecen Playfair Display y Poppins de la web y Noto Sans de la app.

Escala (rem): 12 · 14 · 16 · 18 · 20 · 24 · 32 · 40 · 52 · 68 (esta última solo en el hero).

## Forma y espacio

- Radio: 4 (chips), 8 (botones e inputs), 12 (tarjetas y modales), 16 (bloques grandes de la web). Nada de `rounded-2xl` en todo.
- Sombras: `--tyb-shadow-sm` en reposo, `--tyb-shadow-md` al elevar, `--tyb-shadow-lg` solo para modales. Fuera `shadow-2xl` y `hover:-translate-y-1`.
- Espaciado en rejilla de 4 px (`--tyb-space-*`). Secciones de la web: `space-20` arriba y abajo.
- Controles de 40 px de alto. Foco visible con `--tyb-focus-ring`.

## Cómo se conecta en cada repo

**Web pública (`Lavanderaweb/src/styles/globals.css`):** importa `tokens.css` y mapea las variables de shadcn (`--primary`, `--border`, `--ring`, `--radius`…) y la escala `--text-*` a los tokens. `h1`/`h2` van en Bebas; la clase `.font-logo` sigue valiendo.
Pendiente: la web no tiene Tailwind instalado; `src/index.css` es una salida precompilada de Tailwind 4.1.3 exportada por Figma Make, así que las reglas `@theme` y `@apply` de `globals.css` no se procesan y **las clases nuevas de Tailwind no funcionan**. Antes de rediseñarla hay que añadir `tailwindcss` + `@tailwindcss/vite` y borrar `index.css`.

**App (`lavanderia/frontend`):** `main.jsx` importa `tokens.css` antes del tema Less. Las variables Less de `uikit-theme.less` repiten los hex de los tokens (Less los necesita en compilación), con el nombre del token al lado. Hay unas 105 apariciones del azul antiguo (`#048ABF`) y de los grises de Tailwind escritos a mano en JSX y CSS; se migran a `var(--tyb-*)` por páginas, empezando por `Login`, `ForgotPassword`, `ResetPassword` y `pages/portal/*`.
