import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portalFetchOrders, portalFetchInvoices } from '../../api.js';
import { formatEUR } from '../../utils/format.js';

const statusLabels = {
    pending: 'Pendiente',
    ready: 'Listo',
    collected: 'Recogido',
    cancelled: 'Cancelado',
};

const statusColors = {
    pending: '#f0ad4e',
    ready: '#5cb85c',
    collected: '#048ABF',
    cancelled: '#d9534f',
};

export default function PortalDashboard({ token, user, onLogout }) {
    const [orders, setOrders] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            portalFetchOrders(token).catch(() => []),
            portalFetchInvoices(token).catch(() => []),
        ]).then(([o, i]) => {
            setOrders(o);
            setInvoices(i);
        }).finally(() => setLoading(false));
    }, [token]);

    const unpaidOrders = orders.filter(o => !o.paid && o.status !== 'cancelled');
    const unpaidInvoices = invoices.filter(i => i.paid !== true && i.paymentStatus !== 'paid');
    const totalPending = unpaidOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const recentOrders = orders.slice(0, 5);

    return (
        <div style={{ minHeight: '100vh', background: '#f8f8f8' }}>
            {/* Header */}
            <div style={{
                background: '#fff',
                borderBottom: '1px solid #e5e5e5',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img src="/logo.png" alt="Logo" style={{ height: 32 }} />
                    <span style={{ fontWeight: 600, fontSize: 16 }}>Mi cuenta</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 14, color: '#666' }}>{user?.firstName}</span>
                    <button
                        onClick={onLogout}
                        style={{
                            background: 'none', border: '1px solid #ccc', borderRadius: 4,
                            padding: '4px 12px', cursor: 'pointer', fontSize: 13
                        }}
                    >
                        Salir
                    </button>
                </div>
            </div>

            <div style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}>Cargando...</div>
                ) : (
                    <>
                        {/* Summary cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
                            <div style={{ background: '#fff', borderRadius: 8, padding: 16, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                                <div style={{ fontSize: 24, fontWeight: 700 }}>{orders.length}</div>
                                <div style={{ fontSize: 13, color: '#666' }}>Pedidos</div>
                            </div>
                            <div style={{ background: '#fff', borderRadius: 8, padding: 16, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                                <div style={{ fontSize: 24, fontWeight: 700 }}>{unpaidOrders.length}</div>
                                <div style={{ fontSize: 13, color: '#666' }}>Pendientes</div>
                            </div>
                            <div style={{ background: '#fff', borderRadius: 8, padding: 16, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderTop: totalPending > 0 ? '3px solid #f0506e' : undefined }}>
                                <div style={{ fontSize: 24, fontWeight: 700 }}>{formatEUR(totalPending)}</div>
                                <div style={{ fontSize: 13, color: '#666' }}>Por pagar</div>
                            </div>
                            <div style={{ background: '#fff', borderRadius: 8, padding: 16, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                                <div style={{ fontSize: 24, fontWeight: 700 }}>{invoices.length}</div>
                                <div style={{ fontSize: 13, color: '#666' }}>Facturas</div>
                            </div>
                        </div>

                        {/* Recent orders */}
                        <div style={{ background: '#fff', borderRadius: 8, padding: 16, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <h3 style={{ margin: 0, fontSize: 16 }}>Pedidos recientes</h3>
                                <Link to="/portal/orders" style={{ fontSize: 13, color: '#048ABF' }}>Ver todos</Link>
                            </div>
                            {recentOrders.length === 0 ? (
                                <div style={{ color: '#999', fontSize: 14 }}>No hay pedidos</div>
                            ) : (
                                recentOrders.map(o => (
                                    <Link
                                        key={o.id}
                                        to={`/portal/orders/${o.id}`}
                                        style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: '10px 0', borderBottom: '1px solid #f0f0f0',
                                            textDecoration: 'none', color: 'inherit'
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 14 }}>{o.orderNum}</div>
                                            <div style={{ fontSize: 12, color: '#888' }}>
                                                {new Date(o.createdAt).toLocaleDateString('es-ES')}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontWeight: 600 }}>{formatEUR(o.total)}</div>
                                            <span style={{
                                                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                                                background: statusColors[o.status] || '#ccc', color: '#fff'
                                            }}>
                                                {statusLabels[o.status] || o.status}
                                            </span>
                                        </div>
                                    </Link>
                                ))
                            )}
                        </div>

                        {/* Unpaid invoices */}
                        {unpaidInvoices.length > 0 && (
                            <div style={{
                                background: '#fff', borderRadius: 8, padding: 16,
                                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                                borderLeft: '3px solid #f0506e'
                            }}>
                                <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Facturas pendientes de pago</h3>
                                {unpaidInvoices.map(inv => (
                                    <Link
                                        key={inv.id}
                                        to="/portal/invoices"
                                        style={{
                                            display: 'flex', justifyContent: 'space-between',
                                            padding: '8px 0', borderBottom: '1px solid #f0f0f0',
                                            textDecoration: 'none', color: 'inherit'
                                        }}
                                    >
                                        <span style={{ fontWeight: 500 }}>{inv.number}</span>
                                        <span style={{ fontWeight: 600 }}>{formatEUR(Number(inv.totalGross))}</span>
                                    </Link>
                                ))}
                            </div>
                        )}

                        {/* Nav links */}
                        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                            <Link to="/portal/orders" className="uk-button uk-button-default" style={{ flex: 1, textAlign: 'center' }}>
                                Mis pedidos
                            </Link>
                            <Link to="/portal/invoices" className="uk-button uk-button-default" style={{ flex: 1, textAlign: 'center' }}>
                                Mis facturas
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
