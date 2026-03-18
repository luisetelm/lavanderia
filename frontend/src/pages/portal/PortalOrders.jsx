import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portalFetchOrders } from '../../api.js';
import { formatEUR } from '../../utils/format.js';

const statusLabels = { pending: 'Pendiente', ready: 'Listo para recoger', collected: 'Recogido', cancelled: 'Cancelado' };
const statusColors = { pending: '#f0ad4e', ready: '#5cb85c', collected: '#048ABF', cancelled: '#d9534f' };

export default function PortalOrders({ token }) {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        portalFetchOrders(token)
            .then(setOrders)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [token]);

    return (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <Link to="/portal" style={{ color: '#048ABF', fontSize: 14 }}>← Volver</Link>
                <h2 style={{ margin: 0, fontSize: 18 }}>Mis pedidos</h2>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 40 }}>Cargando...</div>
            ) : orders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>No tienes pedidos</div>
            ) : (
                orders.map(o => (
                    <Link
                        key={o.id}
                        to={`/portal/orders/${o.id}`}
                        style={{
                            display: 'block', background: '#fff', borderRadius: 8,
                            padding: 16, marginBottom: 8, textDecoration: 'none', color: 'inherit',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontWeight: 600 }}>{o.orderNum}</div>
                                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                                    {new Date(o.createdAt).toLocaleDateString('es-ES', { dateStyle: 'medium' })}
                                    {o.fechaLimite && (
                                        <span> · Entrega: {new Date(o.fechaLimite).toLocaleDateString('es-ES', { dateStyle: 'medium' })}</span>
                                    )}
                                </div>
                                <div style={{ fontSize: 12, marginTop: 4 }}>
                                    {(o.lines || []).length} producto{(o.lines || []).length !== 1 ? 's' : ''}
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontWeight: 700, fontSize: 16 }}>{formatEUR(o.total)}</div>
                                <span style={{
                                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                                    background: statusColors[o.status] || '#ccc', color: '#fff',
                                    display: 'inline-block', marginTop: 4
                                }}>
                                    {statusLabels[o.status] || o.status}
                                </span>
                                {o.paid && (
                                    <div style={{ fontSize: 11, color: '#5cb85c', marginTop: 2 }}>Pagado</div>
                                )}
                                {!o.paid && o.status !== 'cancelled' && (
                                    <div style={{ fontSize: 11, color: '#f0506e', marginTop: 2 }}>Pendiente pago</div>
                                )}
                            </div>
                        </div>
                    </Link>
                ))
            )}
        </div>
    );
}
