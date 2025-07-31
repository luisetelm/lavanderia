export function randomSku(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let sku = '';
    for (let i = 0; i < length; i++) {
        sku += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return sku;
}

// intenta generar uno único verificando en la base
export async function generateUniqueSku(prisma, attempts = 5) {
    for (let i = 0; i < attempts; i++) {
        const candidate = randomSku();
        const existing = await prisma.product.findUnique({ where: { sku: candidate }});
        if (!existing) return candidate;
    }
    // como fallback, añade timestamp
    return `SKU-${Date.now()}`;
}
