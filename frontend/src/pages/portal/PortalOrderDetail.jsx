import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { portalFetchOrder, portalPay } from '../../api.js';
import { formatEUR } from '../../utils/format.js';

const statusLabels = { pending: 'Pendiente', ready: 'Listo para recoger', collected: 'Recogido', cancelled: 'Cancelado' };
const statusColors = { pending: '#f0ad4e', ready: '#5cb85c', collected: '#048ABF', cancelled: '#d9534f' };

export default function PortalOrderDetail({ token }) {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [paying, setPaying] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        portalFetchOrder(token, id)
            .then(setOrder)
            .catch(() => setError('No se pudo cargar el pedido'))
            .finally(() => setLoading(false));
    }, [token, id]);

    const handlePay = async () => {
        setPaying(true);
        setError('');
        try {
            const { url } = await portalPay(token, { type: 'order', id: order.id });
            window.location.href = url;
        } catch (err) {
            setError(err.error || 'Error al iniciar el pago');
            setPaying(false);
        }
    };

    if (loading) return <div style={{ textAlign: 'center', padding: 40 }}>Cargando...</div>;
    if (error && !order) return (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
            <Link to="/portal/orders" style={{ color: '#048ABF', fontSize: 14 }}>← Volver</Link>
            <div style={{ color: '#d32f2f', marginTop: 16 }}>{error}</div>
        </div>
    );
    if (!order) return null;

    return (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <Link to="/portal/orders" style={{ color: '#048ABF', fontSize: 14 }}>← Volver</Link>
                <h2 style={{ margin: 0, fontSize: 18 }}>Pedido {order.orderNum}</h2>
            </div>

            <div style={{ background: '#fff', borderRadius: 8, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                {/* Status bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span style={{
                        fontSize: 13, padding: '4px 12px', borderRadius: 10,
                        background: statusColors[order.status] || '#ccc', color: '#fff', fontWeight: 600
                    }}>
                        {statusLabels[order.status] || order.status}
                    </span>
                    <span style={{ fontSize: 13, color: order.paid ? '#5cb85c' : '#f0506e', fontWeight: 600 }}>
                        {order.paid ? 'Pagado' : 'Pendiente de pago'}
                    </span>
                </div>

                {/* Dates */}
                <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
                    <div>Fecha: {new Date(order.createdAt).toLocaleDateString('es-ES', { dateStyle: 'long' })}</div>
                    {order.fechaLimite && (
                        <div>Entrega prevista: {new Date(order.fechaLimite).toLocaleDateString('es-ES', { dateStyle: 'long' })}</div>
                    )}
                </div>

                {/* Lines */}
                <div style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
                    {(order.lines || []).map(l => {
                        const subtotal = Number(l.unitPrice) * Number(l.quantity);
                        const discountAmt = subtotal * ((l.discount || 0) / 100);
                        const lineTotal = subtotal - discountAmt;
                        return (
                            <div key={l.id} style={{
                                display: 'flex', flexDirection: 'column',
                                padding: '8px 0', borderBottom: '1px solid #f5f5f5'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <div>
                                        <div style={{ fontWeight: 500 }}>{l.product?.name || `Producto #${l.productId}`}</div>
                                        <div style={{ fontSize: 12, color: '#888' }}>
                                            {l.quantity} x {formatEUR(l.unitPrice)}
                                            {l.discount > 0 && (
                                                <span style={{ color: '#f0506e' }}> (-{l.discount}%)</span>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ fontWeight: 600 }}>{formatEUR(lineTotal)}</div>
                                </div>
                                {(() => {
                                    const annotations = Array.isArray(l.annotations) ? l.annotations : [];
                                    const notes = annotations.filter(a => a.type === 'note');
                                    const photos = annotations.filter(a => a.type === 'photo');
                                    return (<>
                                        {notes.map((a, i) => (
                                            <div key={`n${i}`} style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
                                                {a.text}
                                            </div>
                                        ))}
                                        {photos.length > 0 && (
                                            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                                                {photos.map((a, i) => (
                                                    <a key={`p${i}`} href={`/uploads/line-photos/${a.file}`} target="_blank" rel="noopener noreferrer">
                                                        <img src={`/uploads/line-photos/${a.file}`} alt={`Foto ${i + 1}`}
                                                             style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e7eb' }} />
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </>);
                                })()}
                            </div>
                        );
                    })}
                </div>

                {/* Total */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    paddingTop: 12, marginTop: 8, borderTop: '2px solid #333',
                    fontWeight: 700, fontSize: 18
                }}>
                    <span>Total</span>
                    <span>{formatEUR(order.total)}</span>
                </div>

                {order.observaciones && (
                    <div style={{ marginTop: 12, fontSize: 13, color: '#666' }}>
                        <strong>Observaciones:</strong> {order.observaciones}
                    </div>
                )}

                {/* Pay button */}
                {!order.paid && order.status !== 'cancelled' && (
                    <div style={{ marginTop: 20 }}>
                        {error && <div style={{ color: '#d32f2f', fontSize: 13, marginBottom: 8 }}>{error}</div>}
                        <button
                            onClick={handlePay}
                            disabled={paying}
                            className="uk-button uk-button-primary uk-width-1-1"
                            style={{ padding: '12px', fontSize: 16 }}
                        >
                            {paying ? 'Redirigiendo al pago...' : `Pagar ${formatEUR(order.total)}`}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
