import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { portalFetchInvoices, portalPay } from '../../api.js';
import { formatEUR } from '../../utils/format.js';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export default function PortalInvoices({ token }) {
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [payingId, setPayingId] = useState(null);

    useEffect(() => {
        portalFetchInvoices(token)
            .then(setInvoices)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [token]);

    const handlePay = async (inv) => {
        setPayingId(inv.id);
        try {
            const { url } = await portalPay(token, { type: 'invoice', id: inv.id });
            window.location.href = url;
        } catch (err) {
            alert(err.error || 'Error al iniciar el pago');
            setPayingId(null);
        }
    };

    const handleDownload = async (inv) => {
        const url = `${API_BASE}/portal/invoices/${inv.id}/pdf`;
        try {
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Error descargando');
            const blob = await res.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `factura_${inv.id}.pdf`;
            link.click();
            URL.revokeObjectURL(link.href);
        } catch {
            alert('No se pudo descargar la factura');
        }
    };

    return (
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <Link to="/portal" style={{ color: '#048ABF', fontSize: 14 }}>← Volver</Link>
                <h2 style={{ margin: 0, fontSize: 18 }}>Mis facturas</h2>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: 40 }}>Cargando...</div>
            ) : invoices.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>No tienes facturas</div>
            ) : (
                invoices.map(inv => {
                    const isPaid = inv.paid === true || inv.paymentStatus === 'paid';
                    const isNormal = inv.type === 'n';
                    return (
                        <div key={inv.id} style={{
                            background: '#fff', borderRadius: 8, padding: 16, marginBottom: 8,
                            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                            borderLeft: isPaid ? '3px solid #5cb85c' : '3px solid #f0506e'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontWeight: 600 }}>{inv.number || `Factura #${inv.id}`}</div>
                                    <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                                        {new Date(inv.issuedAt).toLocaleDateString('es-ES', { dateStyle: 'medium' })}
                                        {' · '}{inv.type === 's' ? 'Simplificada' : 'Normal'}
                                    </div>
                                    {inv.invoiceTickets?.length > 0 && (
                                        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                                            Pedidos: {inv.invoiceTickets.map(t => t.order?.orderNum || `#${t.ticketId}`).join(', ')}
                                        </div>
                                    )}
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                                        {formatEUR(Number(inv.totalGross))}
                                    </div>
                                    <span style={{
                                        fontSize: 11, padding: '2px 8px', borderRadius: 10,
                                        background: isPaid ? '#5cb85c' : '#f0506e', color: '#fff',
                                        display: 'inline-block', marginTop: 4
                                    }}>
                                        {isPaid ? 'Pagada' : 'Pendiente'}
                                    </span>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                {isNormal && (
                                    <button
                                        onClick={() => handleDownload(inv)}
                                        className="uk-button uk-button-default uk-button-small"
                                        style={{ fontSize: 13 }}
                                    >
                                        Descargar PDF
                                    </button>
                                )}
                                {!isPaid && (
                                    <button
                                        onClick={() => handlePay(inv)}
                                        disabled={payingId === inv.id}
                                        className="uk-button uk-button-primary uk-button-small"
                                        style={{ fontSize: 13 }}
                                    >
                                        {payingId === inv.id ? 'Redirigiendo...' : 'Pagar con tarjeta'}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );
}
