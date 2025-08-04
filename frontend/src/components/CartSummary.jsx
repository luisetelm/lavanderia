import React from 'react';

export default function CartSummary({ cart, products }) {
    const total = cart.reduce((sum, c) => {
        const p = products.find((prod) => prod.id === c.productId);
        return sum + (p?.basePrice || 0) * c.quantity;
    }, 0);

    return (
        <div>
            {cart.map((c, i) => {
                const p = products.find((prod) => prod.id === c.productId);
                return (
                    <div key={i}>
                        {p?.name} x{c.quantity} — {((p?.basePrice || 0) * c.quantity).toFixed(2)} €
                    </div>
                );
            })}
            <h3 style={{ marginTop: 10 }}>Total: {total.toFixed(2)} €</h3>
        </div>
    );
}
