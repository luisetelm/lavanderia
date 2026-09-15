# Domiciliación SEPA

Cobro de facturas por adeudo directo SEPA con Stripe. El cliente firma una sola
vez la orden de domiciliación y después sus facturas se cargan en su cuenta sin
que tenga que hacer nada.

Código: `backend/src/services/sepa.js` (toda la lógica), rutas en
`backend/src/routes/stripe.js` (`/api/stripe/sepa/...` y el webhook) y
`backend/src/routes/portal.js` (`/api/portal/sepa`). Tablas en `sql/026`.

## Antes de usarlo

1. **Activar el método en Stripe**: Dashboard → Ajustes → Métodos de pago →
   Adeudo directo SEPA. Stripe pide una verificación de identidad adicional.
   Mientras no esté activo, generar un enlace o lanzar un adeudo devuelve el
   error de Stripe tal cual.
2. **Webhook**: el endpoint `/api/stripe/webhook` tiene que recibir también
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `charge.dispute.created` y `mandate.updated` (además del
   `checkout.session.completed` que ya recibía).
3. Aplicar `backend/sql/026_domiciliacion_sepa.sql` y `npx prisma generate`.

Recomendable: configurar un descriptor reconocible (y, si se quiere, un Creditor
ID propio) en Stripe para que el cliente identifique el cargo en su banco.

## Flujo

1. **Firma de la orden**, de dos formas:
   - Ficha del cliente → pestaña *Domiciliación* → *Generar enlace de firma*.
     El enlace (válido 24 h) se copia o se envía por WhatsApp. Al terminar,
     Stripe devuelve al cliente a `/portal/domiciliacion`, página pública.
   - Portal del cliente → *Domiciliar pagos*. Vuelve a `/portal?sepa=ok`.

   Las dos crean una sesión de Checkout en modo `setup` con el Customer de
   Stripe del cliente (`User.stripeCustomerId`, se crea la primera vez). El
   cliente necesita email: Stripe le avisa por email de cada adeudo, como exigen
   las normas SEPA.
2. **Webhook `checkout.session.completed`** (modo setup) → `guardarMandato`:
   guarda la orden en `sepa_mandate` como `active`. Si ya tenía otra (cambio de
   cuenta), la anterior pasa a `replaced` y su cuenta se desvincula en Stripe.
3. **Adeudo** (`cobrarFacturaSepa`):
   - Automático al generar la factura mensual (`services/monthlyInvoicing.js`,
     día 5) si el cliente tiene orden activa.
   - Manual: botón *Cobrar por SEPA* en la pestaña *Domiciliación*, o método
     *Adeudo SEPA* al cobrar una factura en Ventas.

   Crea un PaymentIntent `off_session` contra la cuenta guardada, un `Payment`
   con `method = 'sepa'` y `status = 'pending'`, y deja la factura en
   `paymentStatus = 'sepa_processing'`. La factura se reserva antes de llamar a
   Stripe, así dos clics o el cron y un clic no lanzan dos adeudos.
4. **Resultado** (unos 6 días hábiles después):
   - `payment_intent.succeeded` → `Payment` completado, factura `paid` y sus
     pedidos pagados con `paymentMethod = 'sepa'`.
   - `payment_intent.payment_failed` → `Payment` `failed` con el motivo en la
     nota y factura `sepa_failed`: sigue sin cobrar.
5. **Devolución** (hasta 8 semanas sin dar motivo, 13 meses si alega que no lo
   autorizó): `charge.dispute.created` → `Payment` `disputed`, la factura vuelve
   a sin cobrar (`sepa_failed`) y sus pedidos cobrados por SEPA a no pagados.
6. **Orden cancelada por el banco o el cliente**: `mandate.updated` → la orden
   pasa a `inactive` y ya no se lanzan adeudos.

No hay reintentos automáticos: cada adeudo fallido cuesta 3,50 € y cada
devolución 15 €. Los rechazados o devueltos cuya factura sigue sin cobrar salen
como aviso en el Dashboard (solo admin) y en Administración → Stripe.

Mientras una factura está en `sepa_processing` no se puede cobrar por otra vía
(Ventas, POS, enlace de pago, portal): se cobraría dos veces.

Los adeudos no entran en los cierres de caja (`NON_CASH_METHODS` de
`routes/cash.js`): el dinero llega por las transferencias de Stripe, que se ven
en Administración → Stripe.

## Estados

| Dónde | Valor | Significado |
| --- | --- | --- |
| `invoices.paymentStatus` | `sepa_processing` | Adeudo lanzado, esperando a Stripe |
| | `sepa_failed` | Rechazado o devuelto; sin cobrar |
| `Payment.status` (`method = 'sepa'`) | `pending` → `completed` / `failed` / `disputed` | |
| `sepa_mandate.status` | `active`, `pending`, `inactive`, `replaced`, `revoked` | Sólo una `active` por cliente |

Todos los manejadores del webhook ignoran avisos ya procesados. Si fallan
responden 500 para que Stripe reintente.

## Probar

Con claves de **test** de Stripe (`sk_test_...`) y `stripe listen --forward-to
localhost:4000/api/stripe/webhook`. IBAN de prueba para la página de Stripe:

| IBAN | Resultado |
| --- | --- |
| `ES0700120345030000067890` | Se cobra |
| `ES9121000418450200051332` | Se rechaza |
| `ES1700120345000002222227` | Se rechaza por fondos insuficientes |
| `ES5000120345030000067892` | Se cobra y el cliente lo devuelve al momento |

Lista completa en la documentación de Stripe (*Save SEPA Direct Debit details
for future payments → Test IBANs*).

Tarifas (España, septiembre de 2026): 0,35 € por adeudo, 3,50 € por adeudo
fallido, 15 € por devolución.
