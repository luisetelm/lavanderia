import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Crea una sesión de Stripe Checkout para cobrar un pedido o factura.
 * @param {object} params
 * @param {number} params.amount - Importe en euros (decimal, p.ej. 25.50)
 * @param {string} params.description - Descripción para el cliente
 * @param {object} params.metadata - { type: 'order'|'invoice', id: number }
 * @param {string} params.successUrl - URL tras pago exitoso
 * @param {string} params.cancelUrl - URL si cancela
 * @param {string} [params.customerEmail] - Email del cliente (opcional)
 */
export async function createCheckoutSession({ amount, description, metadata, successUrl, cancelUrl, customerEmail }) {
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{
            price_data: {
                currency: 'eur',
                product_data: {
                    name: description || 'Pago Tinte y Burbuja',
                },
                unit_amount: Math.round(amount * 100), // Stripe usa céntimos
            },
            quantity: 1,
        }],
        metadata: {
            type: metadata.type,
            id: String(metadata.id),
        },
        customer_email: customerEmail || undefined,
        success_url: successUrl,
        cancel_url: cancelUrl,
    });

    return session;
}

/**
 * Construye un evento de Stripe verificando la firma del webhook.
 */
export function constructWebhookEvent(rawBody, signature) {
    return stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
    );
}

export default stripe;
