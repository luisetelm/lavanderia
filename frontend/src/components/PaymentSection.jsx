import React from 'react';

export default function PaymentSection({
                                           isValidated,
                                           order,
                                           paymentMethod,
                                           setPaymentMethod,
                                           onCardPay,
                                           onCashClick,
                                       }) {
    if (!isValidated || !order) return null;

    return (
        <div style={{ marginTop: 20, borderTop: '1px solid #ccc', paddingTop: 12 }}>
            <h3>Pago</h3>
            <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={() => setPaymentMethod('cash')}>Efectivo</button>
                <button onClick={() => setPaymentMethod('card')}>Tarjeta</button>
            </div>
            <div style={{ marginTop: 8 }}>
                Método seleccionado: {paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}
            </div>

            {paymentMethod === 'cash' && (
                <div style={{ marginTop: 12 }}>
                    <button onClick={onCashClick}>Cobrar en efectivo</button>
                </div>
            )}

            {paymentMethod === 'card' && (
                <div style={{ marginTop: 12 }}>
                    <button onClick={onCardPay}>Confirmar tarjeta</button>
                </div>
            )}
        </div>
    );
}
