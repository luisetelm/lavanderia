import stripe from './stripe.js';

// Domiciliación SEPA con Stripe (docs/domiciliacion-sepa.md).
//
// El cliente firma una sola vez la orden de domiciliación en una página de
// Stripe (Checkout en modo setup) y queda guardada en sepa_mandate. Después cada
// factura se carga contra esa orden sin que el cliente intervenga.
//
// Un adeudo no se confirma al momento: tarda unos 6 días hábiles y el cliente
// puede devolverlo durante 8 semanas. Por eso la factura pasa por
// paymentStatus 'sepa_processing' y sólo queda cobrada cuando Stripe avisa con
// payment_intent.succeeded. Si se rechaza o se devuelve queda en 'sepa_failed',
// sin cobrar y sin reintentos automáticos (cada fallo cuesta 3,50 €).

export const SEPA_EN_CURSO = 'sepa_processing';
export const SEPA_FALLIDO = 'sepa_failed';

const baseUrl = () => process.env.APP_URL || 'https://app.tinteyburbuja.com';
const aFecha = (segundos) => (segundos ? new Date(segundos * 1000) : null);

function httpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

export function mandatoActivo(prisma, clientId) {
    return prisma.sepaMandate.findFirst({
        where: {clientId, status: 'active'},
        orderBy: {acceptedAt: 'desc'},
    });
}

// Stripe guarda la orden asociada a un Customer: se crea la primera vez y se reutiliza
async function customerDe(prisma, cliente) {
    if (cliente.stripeCustomerId) return cliente.stripeCustomerId;
    const customer = await stripe.customers.create({
        name: cliente.denominacionsocial || `${cliente.firstName} ${cliente.lastName}`.trim(),
        email: cliente.email,
        phone: cliente.phone || undefined,
        metadata: {clientId: String(cliente.id)},
    });
    await prisma.user.update({where: {id: cliente.id}, data: {stripeCustomerId: customer.id}});
    return customer.id;
}

/**
 * Enlace a la página de Stripe donde el cliente mete su IBAN y acepta la orden.
 * Caduca a las 24 h, lo que dura una sesión de Checkout.
 */
export async function crearEnlaceMandato(prisma, clientId, {successUrl, cancelUrl} = {}) {
    const cliente = await prisma.user.findUnique({
        where: {id: clientId},
        select: {
            id: true, firstName: true, lastName: true, denominacionsocial: true,
            email: true, phone: true, stripeCustomerId: true,
        },
    });
    if (!cliente) throw httpError(404, 'Cliente no encontrado');
    // Las normas SEPA obligan a avisar de cada adeudo y Stripe lo hace por email
    if (!cliente.email) throw httpError(400, 'El cliente necesita email: Stripe le avisa por email de cada adeudo');

    const session = await stripe.checkout.sessions.create({
        mode: 'setup',
        payment_method_types: ['sepa_debit'],
        customer: await customerDe(prisma, cliente),
        locale: 'es',
        metadata: {type: 'sepa_mandate', clientId: String(cliente.id)},
        success_url: successUrl || `${baseUrl()}/portal/domiciliacion?estado=ok`,
        cancel_url: cancelUrl || `${baseUrl()}/portal/domiciliacion?estado=cancelado`,
    });
    return {url: session.url, expiresAt: aFecha(session.expires_at)};
}

async function desvincularCuenta(paymentMethodId) {
    try {
        await stripe.paymentMethods.detach(paymentMethodId);
    } catch (err) {
        // Ya desvinculada (p. ej. desde el Dashboard de Stripe): no es un error
        if (err.code === 'resource_missing' || /not attached/i.test(err.message || '')) return;
        throw err;
    }
}

/**
 * Webhook checkout.session.completed de una sesión en modo setup: guarda la
 * orden firmada y sustituye a la que hubiera activa.
 */
export async function guardarMandato(prisma, session) {
    const clientId = Number(session.metadata?.clientId);
    if (session.metadata?.type !== 'sepa_mandate' || !clientId || !session.setup_intent) return;

    const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent, {
        expand: ['payment_method', 'mandate'],
    });
    const {payment_method: cuenta, mandate: orden} = setupIntent;
    if (!cuenta || !orden) {
        console.warn(`[SEPA] La sesión ${session.id} no dejó orden firmada (setup intent ${setupIntent.status})`);
        return;
    }
    // Stripe puede repetir el aviso
    if (await prisma.sepaMandate.findUnique({where: {stripeMandateId: orden.id}})) return;

    const anteriores = await prisma.sepaMandate.findMany({where: {clientId, status: 'active'}});
    await prisma.$transaction([
        prisma.sepaMandate.updateMany({
            where: {clientId, status: 'active'},
            data: {status: 'replaced', revokedAt: new Date()},
        }),
        prisma.sepaMandate.create({
            data: {
                clientId,
                stripeCustomerId: typeof setupIntent.customer === 'string' ? setupIntent.customer : setupIntent.customer?.id,
                stripePaymentMethodId: cuenta.id,
                stripeMandateId: orden.id,
                reference: orden.payment_method_details?.sepa_debit?.reference || null,
                ibanLast4: cuenta.sepa_debit?.last4 || null,
                bankCode: cuenta.sepa_debit?.bank_code || null,
                country: cuenta.sepa_debit?.country || null,
                status: orden.status,
                acceptedAt: aFecha(orden.customer_acceptance?.accepted_at) || new Date(),
            },
        }),
    ]);

    // La cuenta anterior deja de usarse: se quita del Customer y su orden queda cancelada
    for (const anterior of anteriores) {
        if (anterior.stripePaymentMethodId === cuenta.id) continue;
        await desvincularCuenta(anterior.stripePaymentMethodId)
            .catch(err => console.warn(`[SEPA] No se pudo desvincular ${anterior.stripePaymentMethodId}:`, err.message));
    }
    console.log(`[SEPA] Orden ${orden.id} firmada por el cliente ${clientId}`);
}

// Cancelación desde la ficha del cliente
export async function cancelarMandato(prisma, clientId) {
    const mandato = await mandatoActivo(prisma, clientId);
    if (!mandato) throw httpError(404, 'El cliente no tiene una domiciliación activa');
    // Al desvincular la cuenta del Customer, Stripe da la orden por cancelada
    await desvincularCuenta(mandato.stripePaymentMethodId);
    await prisma.sepaMandate.update({
        where: {id: mandato.id},
        data: {status: 'revoked', revokedAt: new Date()},
    });
}

/**
 * Lanza el adeudo de una factura contra la orden activa del cliente. La factura
 * queda en 'sepa_processing' hasta que llega el webhook con el resultado.
 */
export async function cobrarFacturaSepa(prisma, invoiceId, {recordedBy = null} = {}) {
    const invoice = await prisma.invoices.findUnique({
        where: {id: BigInt(invoiceId)},
        select: {id: true, number: true, totalGross: true, paid: true, paymentStatus: true, clientId: true},
    });
    if (!invoice) throw httpError(404, 'Factura no encontrada');
    if (invoice.paid === true || invoice.paymentStatus === 'paid') throw httpError(400, 'La factura ya está cobrada');
    if (invoice.paymentStatus === SEPA_EN_CURSO) throw httpError(400, 'Ya hay un adeudo SEPA en curso para esta factura');
    const importe = Number(invoice.totalGross);
    if (!(importe > 0)) throw httpError(400, 'La factura no tiene importe que cobrar');
    if (!invoice.clientId) throw httpError(400, 'La factura no tiene cliente');

    const mandato = await mandatoActivo(prisma, invoice.clientId);
    if (!mandato) throw httpError(400, 'El cliente no tiene una domiciliación SEPA activa');

    // Se reserva la factura antes de llamar a Stripe: dos clics seguidos, o el
    // cron y un clic a la vez, no pueden lanzar dos adeudos
    const reservada = await prisma.invoices.updateMany({
        where: {id: invoice.id, paymentStatus: invoice.paymentStatus, OR: [{paid: null}, {paid: false}]},
        data: {paymentStatus: SEPA_EN_CURSO},
    });
    if (reservada.count === 0) throw httpError(409, 'La factura ha cambiado mientras tanto: vuelve a cargarla');

    let intent;
    try {
        intent = await stripe.paymentIntents.create({
            amount: Math.round(importe * 100),
            currency: 'eur',
            customer: mandato.stripeCustomerId,
            payment_method: mandato.stripePaymentMethodId,
            payment_method_types: ['sepa_debit'],
            confirm: true,
            off_session: true,
            description: `Factura ${invoice.number}`,
            metadata: {type: 'sepa_invoice', invoiceId: String(invoice.id), clientId: String(invoice.clientId)},
        });
    } catch (err) {
        await prisma.invoices.update({where: {id: invoice.id}, data: {paymentStatus: invoice.paymentStatus}});
        throw httpError(err.statusCode && err.statusCode < 500 ? 400 : 502, `Stripe no aceptó el adeudo: ${err.message}`);
    }

    await prisma.payment.create({
        data: {
            amount: invoice.totalGross,
            method: 'sepa',
            status: 'pending',
            stripePaymentId: intent.id,
            invoiceId: invoice.id,
            clientId: invoice.clientId,
            recordedBy,
            note: `Adeudo SEPA factura ${invoice.number} (cuenta ···· ${mandato.ibanLast4 || '?'})`,
        },
    });
    console.log(`[SEPA] Adeudo ${intent.id} lanzado: factura ${invoice.number}, ${importe.toFixed(2)} €`);
    return intent;
}

const incluirFactura = {invoice: {include: {invoiceTickets: {include: {order: true}}}}};

// Payment de un adeudo. Si el adeudo se lanzó pero el Payment no llegó a
// guardarse, se reconstruye con los metadatos para que la factura no se quede
// en curso para siempre.
async function pagoDeAdeudo(prisma, intent) {
    const pago = await prisma.payment.findUnique({where: {stripePaymentId: intent.id}, include: incluirFactura});
    if (pago || intent.metadata?.type !== 'sepa_invoice') return pago;
    return prisma.payment.create({
        data: {
            amount: (intent.amount || 0) / 100,
            method: 'sepa',
            status: 'pending',
            stripePaymentId: intent.id,
            invoiceId: BigInt(intent.metadata.invoiceId),
            clientId: Number(intent.metadata.clientId) || null,
            note: `Adeudo SEPA ${intent.description ? intent.description.toLowerCase() : ''}`.trim(),
        },
        include: incluirFactura,
    });
}

// Webhook payment_intent.succeeded: el banco ha pagado
export async function adeudoCobrado(prisma, intent) {
    const pago = await pagoDeAdeudo(prisma, intent);
    if (!pago || pago.status === 'completed') return;

    await prisma.$transaction(async (tx) => {
        await tx.payment.update({where: {id: pago.id}, data: {status: 'completed'}});
        if (!pago.invoice) return;
        if (pago.invoice.paid === true) {
            console.warn(`[SEPA] La factura ${pago.invoice.number} ya estaba cobrada y el adeudo ${intent.id} también se ha cobrado`);
            return;
        }
        await tx.invoices.update({where: {id: pago.invoiceId}, data: {paid: true, paymentStatus: 'paid'}});
        for (const ticket of pago.invoice.invoiceTickets || []) {
            if (ticket.order && !ticket.order.paid) {
                await tx.order.update({where: {id: ticket.ticketId}, data: {paid: true, paymentMethod: 'sepa'}});
            }
        }
    });
    console.log(`[SEPA] Adeudo ${intent.id} cobrado`);
}

// Webhook payment_intent.payment_failed: el banco lo ha rechazado
export async function adeudoRechazado(prisma, intent) {
    const pago = await pagoDeAdeudo(prisma, intent);
    if (!pago || pago.status === 'failed') return;

    const error = intent.last_payment_error;
    const motivo = error?.message || error?.decline_code || error?.code || 'sin motivo';
    await prisma.$transaction(async (tx) => {
        await tx.payment.update({
            where: {id: pago.id},
            data: {status: 'failed', note: `${pago.note || 'Adeudo SEPA'} · Rechazado: ${motivo}`},
        });
        if (pago.invoice?.paymentStatus === SEPA_EN_CURSO) {
            await tx.invoices.update({where: {id: pago.invoiceId}, data: {paymentStatus: SEPA_FALLIDO}});
        }
    });
    console.warn(`[SEPA] Adeudo ${intent.id} rechazado: ${motivo}`);
}

// Webhook charge.dispute.created: el cliente ha devuelto un adeudo ya cobrado
export async function adeudoDevuelto(prisma, disputa) {
    if (!disputa.payment_intent) return;
    const pago = await prisma.payment.findUnique({
        where: {stripePaymentId: disputa.payment_intent},
        include: incluirFactura,
    });
    // Las disputas de pagos con tarjeta no son de esta integración
    if (!pago || pago.method !== 'sepa' || pago.status === 'disputed') return;

    await prisma.$transaction(async (tx) => {
        await tx.payment.update({
            where: {id: pago.id},
            data: {status: 'disputed', note: `${pago.note || 'Adeudo SEPA'} · Devuelto por el cliente (${disputa.reason})`},
        });
        if (!pago.invoice) return;
        await tx.invoices.update({where: {id: pago.invoiceId}, data: {paid: false, paymentStatus: SEPA_FALLIDO}});
        for (const ticket of pago.invoice.invoiceTickets || []) {
            if (ticket.order?.paid && ticket.order.paymentMethod === 'sepa') {
                await tx.order.update({where: {id: ticket.ticketId}, data: {paid: false}});
            }
        }
    });
    console.warn(`[SEPA] Adeudo ${disputa.payment_intent} devuelto por el cliente: ${disputa.reason}`);
}

// Webhook mandate.updated: el banco o el cliente han cancelado la orden
export async function mandatoActualizado(prisma, orden) {
    const local = await prisma.sepaMandate.findUnique({where: {stripeMandateId: orden.id}});
    if (!local || local.status === orden.status || ['replaced', 'revoked'].includes(local.status)) return;
    await prisma.sepaMandate.update({
        where: {id: local.id},
        data: {status: orden.status, revokedAt: orden.status === 'inactive' ? new Date() : local.revokedAt},
    });
    console.log(`[SEPA] Orden ${orden.id} del cliente ${local.clientId}: ${local.status} -> ${orden.status}`);
}

/**
 * Adeudos SEPA recientes. Con atencion = true, sólo los rechazados o devueltos
 * cuya factura sigue sin cobrar: lo que necesita que alguien hable con el cliente.
 */
export function listarAdeudos(prisma, {clientId = null, atencion = false, limite = 50} = {}) {
    return prisma.payment.findMany({
        where: {
            method: 'sepa',
            ...(clientId ? {clientId} : {}),
            ...(atencion ? {status: {in: ['failed', 'disputed']}, invoice: {paymentStatus: SEPA_FALLIDO}} : {}),
        },
        orderBy: {createdAt: 'desc'},
        take: limite,
        select: {
            id: true, amount: true, status: true, note: true, createdAt: true,
            invoice: {select: {id: true, number: true, paymentStatus: true}},
            client: {select: {id: true, firstName: true, lastName: true, denominacionsocial: true}},
        },
    });
}
