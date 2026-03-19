import React, { useState, useEffect, useCallback } from 'react';
import { fetchUnpaidInvoices, collectInvoice } from '../../api.js';
import { formatEUR } from '../../utils/format.js';

export default function PendingInvoicesPanel({ show, onClose, token, onCollected }) {
    const [query, setQuery] = useState('');
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Per-invoice collect state
    const [collectingId, setCollectingId] = useState(null);
    const [collectMethod, setCollectMethod] = useState('cash');

    const loadInvoices = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetchUnpaidInvoices(token, { q: query });
            setInvoices(res?.data || []);
        } catch (e) {
            console.error('Error cargando facturas pendientes:', e);
            setError(e.message || 'Error cargando facturas');
            setInvoices([]);
        } finally {
            setLoading(false);
        }
    }, [token, query]);

    // Debounce search
    useEffect(() => {
        if (!show) return;
        const timer = setTimeout(() => loadInvoices(), 300);
        return () => clearTimeout(timer);
    }, [show, loadInvoices]);

    const handleCollect = async (invoice) => {
        if (!window.confirm(`¿Cobrar factura ${invoice.number} por ${formatEUR(Number(invoice.totalGross))}?`)) return;
        setCollectingId(invoice.id);
        setError('');
        try {
            await collectInvoice(token, invoice.id, { method: collectMethod });
            // Remove from list
            setInvoices(prev => prev.filter(i => i.id !== invoice.id));
            setCollectingId(null);
            onCollected?.();
        } catch (e) {
            console.error('Error cobrando factura:', e);
            setError(e.error || e.message || 'Error al cobrar la factura');
            setCollectingId(null);
        }
    };

    if (!show) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: '440px',
            maxWidth: '100vw',
            background: '#fff',
            boxShadow: '-2px 0 8px rgba(0,0,0,.2)',
            zIndex: 1000,
            padding: '16px',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
        }}>
            <div className="uk-flex uk-flex-between uk-flex-middle" style={{ marginBottom: 12 }}>
                <h3 className="uk-margin-remove">Facturas pendientes</h3>
                <button className="uk-button uk-button-text" onClick={onClose}>✕</button>
            </div>

            {/* Búsqueda */}
            <div style={{ marginBottom: 12 }}>
                <input
                    className="uk-input"
                    type="text"
                    placeholder="Buscar por nombre, teléfono..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    autoFocus
                />
            </div>

            {/* Método de cobro global */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 12,
                padding: '8px 10px',
                background: '#f8fafc',
                borderRadius: 6,
                fontSize: '0.85rem',
            }}>
                <strong style={{ whiteSpace: 'nowrap' }}>Método:</strong>
                {[
                    { value: 'cash', label: 'Efectivo' },
                    { value: 'card_pos', label: 'Tarjeta' },
                    { value: 'transfer', label: 'Transferencia' },
                ].map(opt => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                        <input
                            type="radio"
                            name="pending-collect-method"
                            value={opt.value}
                            checked={collectMethod === opt.value}
                            onChange={() => setCollectMethod(opt.value)}
                        />
                        {opt.label}
                    </label>
                ))}
            </div>

            {error && (
                <div className="uk-alert-danger" style={{ padding: '8px 12px', marginBottom: 8, borderRadius: 4 }}>
                    {error}
                </div>
            )}

            {/* Lista */}
            <div style={{ flex: 1, overflow: 'auto' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>Cargando...</div>
                ) : invoices.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>
                        {query ? 'Sin resultados' : 'No hay facturas pendientes de cobro'}
                    </div>
                ) : (
                    <ul className="uk-list uk-list-divider" style={{ margin: 0 }}>
                        {invoices.map(inv => {
                            const client = inv.User;
                            const clientName = client?.denominacionsocial
                                || [client?.firstName, client?.lastName].filter(Boolean).join(' ')
                                || 'Sin cliente';
                            const orders = (inv.invoiceTickets || [])
                                .map(t => t.order?.orderNum)
                                .filter(Boolean);
                            const isCollecting = collectingId === inv.id;

                            return (
                                <li key={inv.id} style={{ padding: '10px 0' }}>
                                    <div className="uk-flex uk-flex-between uk-flex-middle">
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                                {inv.number}
                                                <span style={{
                                                    fontSize: '0.75rem',
                                                    color: '#64748b',
                                                    marginLeft: 8,
                                                }}>
                                                    {new Date(inv.issuedAt).toLocaleDateString('es-ES', { dateStyle: 'medium' })}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '0.82rem', color: '#334155' }}>
                                                {clientName}
                                                {client?.phone && (
                                                    <span style={{ color: '#94a3b8', marginLeft: 6 }}>{client.phone}</span>
                                                )}
                                            </div>
                                            {orders.length > 0 && (
                                                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                                    Pedidos: {orders.map(n => `#${n}`).join(', ')}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ textAlign: 'right', marginLeft: 12 }}>
                                            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 4 }}>
                                                {formatEUR(Number(inv.totalGross))}
                                            </div>
                                            <button
                                                className="uk-button uk-button-primary uk-button-small"
                                                onClick={() => handleCollect(inv)}
                                                disabled={isCollecting}
                                                type="button"
                                            >
                                                {isCollecting ? 'Cobrando...' : 'Cobrar'}
                                            </button>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}

