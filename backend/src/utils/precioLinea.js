// Cálculo del precio de una línea de pedido.
//
// Replica la regla que aplica POST /api/orders al crear un pedido: precio base
// del producto (o el de gran cliente si procede), más el modificador de la
// variante, menos el descuento del cliente.
//
// Se mantiene aquí para que los ajustes sobre pedidos ya cobrados cobren
// exactamente igual que el TPV. Si algún día cambia la regla de precios, hay que
// tocar los dos sitios: este fichero y el bucle de POST /api/orders.
export async function calcularLinea(prisma, {productId, variantId, quantity}, client) {
    const product = await prisma.product.findUnique({where: {id: Number(productId)}});
    if (!product) {
        const e = new Error(`Producto inválido: ${productId}`);
        e.statusCode = 400;
        throw e;
    }

    let unitPrice = product.basePrice;
    if (client?.isbigclient && product.bigClientPrice && product.bigClientPrice > 0) {
        unitPrice = parseFloat(product.bigClientPrice);
    }

    if (variantId) {
        const variant = await prisma.productVariant.findUnique({where: {id: Number(variantId)}});
        if (variant) unitPrice += variant.priceModifier;
    }

    const qty = Number(quantity) || 1;
    if (qty <= 0) {
        const e = new Error('La cantidad debe ser mayor que cero.');
        e.statusCode = 400;
        throw e;
    }

    const userDiscount = client?.discount ? Number(client.discount) : 0;
    const discountPct = (!isNaN(userDiscount) && userDiscount > 0)
        ? Math.min(100, Math.max(0, userDiscount))
        : 0;

    const subtotal = unitPrice * qty;
    const totalPrice = discountPct > 0 ? subtotal * (1 - discountPct / 100) : subtotal;

    return {
        productId: Number(productId),
        variantId: variantId ? Number(variantId) : null,
        quantity: qty,
        unitPrice,
        discount: discountPct,
        totalPrice: +totalPrice.toFixed(2),
        productName: product.name,
    };
}
