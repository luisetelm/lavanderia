import React, { useState, useEffect, useCallback } from 'react';
import { fetchUnpaidInvoices, collectInvoice } from '../../api.js';
import { formatEUR } from '../../utils/format.js';

const METHODS = [
    { value: 'cash', label: 'Efectivo', icon: '💵' },
    { value: 'card_pos', label: 'Tarjeta', icon: '💳' },
    { value: 'transfer', label: 'Transferencia', icon: '🏦' },
];

export default function PendingInvoicesPanel({ show, onClose, token, onCollected }) {
    const [query, setQuery] = useState('');
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Id de la factura cuyo selector de método está abierto
    const [selectingId, setSelectingId] = useState(null);
    const [collectingId, setCollectingId] = useState(null);

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

    // Cerrar selector si se cierra el panel
    useEffect(() => {
        if (!show) setSelectingId(null);
    }, [show]);

    const handleCollect = async (invoice, method) => {
        setCollectingId(invoice.id);
        setError('');
        try {
            await collectInvoice(token, invoice.id, { method });
            setInvoices(prev => prev.filter(i => i.id !== invoice.id));
            setCollectingId(null);
            setSelectingId(null);
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
                            const isSelecting = selectingId === inv.id;
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
                                            {!isSelecting ? (
                                                <button
                                                    className="uk-button uk-button-primary uk-button-small"
                                                    onClick={() => setSelectingId(inv.id)}
                                                    disabled={isCollecting}
                                                    type="button"
                                                >
                                                    Cobrar
                                                </button>
                                            ) : (
                                                <button
                                                    className="uk-button uk-button-default uk-button-small"
                                                    onClick={() => setSelectingId(null)}
                                                    type="button"
                                                    style={{ fontSize: '0.75rem' }}
                                                >
                                                    Cancelar
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Selector de método de pago inline */}
                                    {isSelecting && (
                                        <div style={{
                                            marginTop: 8,
                                            padding: '8px 10px',
                                            background: '#f0f9ff',
                                            borderRadius: 6,
                                            border: '1px solid #bae6fd',
                                            display: 'flex',
                                            gap: 6,
                                            justifyContent: 'center',
                                            flexWrap: 'wrap',
                                        }}>
                                            {METHODS.map(m => (
                                                <button
                                                    key={m.value}
                                                    className="uk-button uk-button-small"
                                                    disabled={isCollecting}
                                                    type="button"
                                                    style={{
                                                        background: '#fff',
                                                        border: '1px solid #cbd5e1',
                                                        borderRadius: 6,
                                                        fontSize: '0.8rem',
                                                        padding: '4px 12px',
                                                        cursor: isCollecting ? 'wait' : 'pointer',
                                                    }}
                                                    onClick={() => handleCollect(inv, m.value)}
                                                >
                                                    {isCollecting ? '...' : `${m.icon} ${m.label}`}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}

