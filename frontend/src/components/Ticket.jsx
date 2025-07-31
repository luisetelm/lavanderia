import React from 'react';

export default function Ticket({ order }) {
    return (
        <div style={{
            border: '1px dashed #333',
            padding: 10,
            width: 280,
            fontSize: 12,
            background: '#fff'
        }}>
            <h3 style={{ margin: 0 }}>Lavandería</h3>
            <div><strong>Pedido:</strong> {order.orderNum}</div>
            <div><strong>Cliente:</strong> {order.clientName}</div>
            <div><strong>Tel:</strong> {order.clientPhone}</div>
            <hr />
            <div>
                {order.lines.map(l => (
                    <div key={l.id}>
                        {l.productId ? (
                            <>
                                Producto ID {l.productId} x{l.quantity} → {l.totalPrice.toFixed(2)}€
                            </>
                        ) : null}
                    </div>
                ))}
            </div>
            <hr />
            <div><strong>Total:</strong> {order.total.toFixed(2)}€</div>
            <div style={{ fontSize: 10, marginTop: 8 }}>Gracias por su confianza</div>
        </div>
    );
}
