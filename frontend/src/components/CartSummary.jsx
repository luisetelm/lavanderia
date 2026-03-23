import React from 'react';

export default function CartSummary({ cart, products, isbigclient = false, discount = 0, onUpdateQuantity, onRemove }) {

    const getBasePrice = (product) => {
        if (isbigclient && product.bigClientPrice && product.bigClientPrice > 0) {
            return product.bigClientPrice;
        }
        return product.basePrice;
    };

    const getPrice = (product) => {
        let price = getBasePrice(product);
        const d = Number(discount || 0);
        if (!isNaN(d) && d > 0) {
            const factor = Math.max(0, Math.min(100, d));
            price = price * (1 - factor / 100);
        }
        return price;
    };

    // Cálculo del total usando la función getPrice (con descuento aplicado)
    const total = cart.reduce((sum, c) => {
        const p = products.find((prod) => prod.id === c.productId);
        return sum + (p ? getPrice(p) : 0) * c.quantity;
    }, 0);

    const hasDiscount = Number(discount || 0) > 0;

    return (
        <div>
            {cart.map((c, i) => {
                const p = products.find((prod) => prod.id === c.productId);
                const price = getPrice(p);

                return (
                    <div key={i} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '4px 0',
                        borderBottom: '1px solid #eee'
                    }}>
                        <div style={{ flex: 1 }}>{p?.name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                                onClick={() => onUpdateQuantity(c.productId, c.quantity - 1)}
                                style={{
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid #ddd',
                                    background: '#f5f5f5',
                                    cursor: 'pointer',
                                    color: '#1f2956'
                                }}
                            >
                                -
                            </button>
                            <span>{c.quantity}</span>
                            <button
                                onClick={() => onUpdateQuantity(c.productId, c.quantity + 1)}
                                style={{
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid #ddd',
                                    background: '#f5f5f5',
                                    cursor: 'pointer',
                                    color: '#1f2956'
                                }}
                            >
                                +
                            </button>
                            <span style={{ marginLeft: '8px' }}>
                                {hasDiscount && (
                                    <span style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: '0.8em', marginRight: 4 }}>
                                        {((getBasePrice(p) || 0) * c.quantity).toFixed(2)} €
                                    </span>
                                )}
                                {((price || 0) * c.quantity).toFixed(2)} €
                            </span>
                            <button
                                onClick={() => onRemove(c.productId)}
                                style={{
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid #fdd',
                                    background: '#fff5f5',
                                    color: '#dc2626',
                                    cursor: 'pointer',
                                    marginLeft: '8px'
                                }}
                            >
                                ×
                            </button>
                        </div>
                    </div>
                );
            })}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <h3 style={{ margin: 0 }}>Total: {total.toFixed(2)} €</h3>
                {hasDiscount && (
                    <span style={{
                        background: '#10b981', color: '#fff', borderRadius: 6,
                        padding: '2px 8px', fontSize: '0.75rem', fontWeight: 600
                    }}>
                        -{Number(discount)}% dto.
                    </span>
                )}
            </div>
        </div>
    );
}