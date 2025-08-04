import React from 'react';

export default function CashModal({
                                      order,
                                      receivedAmount,
                                      setReceivedAmount,
                                      change,
                                      onConfirm,
                                      onClose,
                                  }) {
    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0,0,0,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
            }}
        >
            <div style={{ background: '#fff', padding: 20, borderRadius: 6, width: 320 }}>
                <h4>Pago en efectivo</h4>
                <div>Total a pagar: {order.total.toFixed(2)} €</div>
                <div style={{ marginTop: 8 }}>
                    <label>Recibido:</label>
                    <input
                        type="number"
                        value={receivedAmount}
                        onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setReceivedAmount(e.target.value);
                        }}
                        style={{ width: '100%' }}
                    />
                </div>
                <div style={{ marginTop: 8 }}>
                    <strong>Vuelta: </strong>{' '}
                    {parseFloat(receivedAmount || 0) - order.total >= 0
                        ? (parseFloat(receivedAmount || 0) - order.total).toFixed(2)
                        : 'Cantidad insuficiente'}{' '}
                    €
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                    <button
                        disabled={parseFloat(receivedAmount || 0) < order.total}
                        onClick={onConfirm}
                    >
                        Confirmar
                    </button>
                    <button onClick={onClose}>Cancelar</button>
                </div>
            </div>
        </div>
    );
}
