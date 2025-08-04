import React, { useEffect } from 'react';

const isBusinessDay = (d) => {
    const wd = d.getDay();
    return wd !== 0 && wd !== 6;
};

const getNextBusinessDays = (count = 12) => {
    const days = [];
    let cursor = new Date();
    while (days.length < count) {
        cursor = new Date(cursor);
        cursor.setDate(cursor.getDate() + 1);
        if (isBusinessDay(cursor)) {
            days.push(new Date(cursor));
        }
    }
    return days;
};

const formatDateKey = (d) => d.toISOString().split('T')[0];

export default function DateCarousel({
                                         loadByDay,
                                         fechaLimite,
                                         setFechaLimite,
                                     }) {
    const days = getNextBusinessDays(12);

    return (
        <div style={{ marginBottom: 20 }}>
            <h3>Fecha de entrega</h3>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
                {days.map((d) => {
                    const key = formatDateKey(d);
                    const ordersForDay = loadByDay[key] || [];
                    const bg =
                        ordersForDay.length >= 5
                            ? '#f8d7da'
                            : ordersForDay.length >= 2
                                ? '#fff3cd'
                                : '#d4edda';
                    return (
                        <div
                            key={key}
                            style={{
                                minWidth: 70,
                                padding: 8,
                                borderRadius: 6,
                                background: bg,
                                position: 'relative',
                                cursor: 'pointer',
                                border: fechaLimite === key ? '2px solid #333' : '1px solid #ccc',
                            }}
                            onClick={() => setFechaLimite(key)}
                            title={`Pedidos: ${ordersForDay.length}`}
                        >
                            <div style={{ fontWeight: 'bold' }}>
                                {new Date(key).toLocaleDateString('es-ES', {
                                    weekday: 'short',
                                    day: 'numeric',
                                    month: 'short',
                                })}
                            </div>
                            <div style={{ fontSize: 12 }}>Pedidos: {ordersForDay.length}</div>
                            {/* Tooltip simplificado: podrías reemplazar con hover/portal real */}
                            {ordersForDay.length > 0 && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: '100%',
                                        left: 0,
                                        zIndex: 10,
                                        background: '#fff',
                                        border: '1px solid #ccc',
                                        borderRadius: 4,
                                        padding: 6,
                                        width: 220,
                                        marginTop: 4,
                                        fontSize: 10,
                                    }}
                                >
                                    {ordersForDay.map((o) => (
                                        <div key={o.id} style={{ marginBottom: 4 }}>
                                            <div style={{ fontWeight: 'bold' }}>{o.orderNum}</div>
                                            {o.lines.map((l) => (
                                                <div key={l.id}>
                                                    {l.quantity}x {l.productName || l.product?.name}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
