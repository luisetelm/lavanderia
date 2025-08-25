import React from 'react';

export default function CartSummary({ cart, products, isbigclient = false, onUpdateQuantity, onRemove }) {


    console.log(isbigclient);
    const getPrice = (product) => {
        if (isbigclient && product.bigClientPrice && product.bigClientPrice > 0) {
            return product.bigClientPrice;
        }
        return product.basePrice;
    };

    // Cálculo del total usando la función getPrice
    const total = cart.reduce((sum, c) => {
        const p = products.find((prod) => prod.id === c.productId);
        return sum + (p ? getPrice(p) : 0) * c.quantity;
    }, 0);

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
            <h3 style={{ marginTop: 10 }}>Total: {total.toFixed(2)} €</h3>
        </div>
    );
}