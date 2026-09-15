import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchStripeBalance, fetchStripePayoutTransactions } from '../api.js';
import { formatEUR } from '../utils/format.js';
import PageToolbar from '../components/PageToolbar.jsx';

// Saldo de Stripe. Todo se lee en vivo de Stripe: el dinero cobrado pasa unos días
// como "pendiente", luego queda "disponible" y entra en la siguiente transferencia
// automática al banco.

const payoutStatus = {
    paid: { label: 'Pagada', color: '#16a34a', bg: '#f0fdf4' },
    pending: { label: 'Pendiente', color: '#d97706', bg: '#fffbeb' },
    in_transit: { label: 'En camino', color: '#2563eb', bg: '#eff6ff' },
    canceled: { label: 'Cancelada', color: '#64748b', bg: '#f1f5f9' },
    failed: { label: 'Fallida', color: '#dc2626', bg: '#fef2f2' },
};

const txTypeLabels = {
    charge: 'Cobro',
    payment: 'Cobro',
    refund: 'Devolución',
    payment_refund: 'Devolución',
    payout: 'Transferencia al banco',
    payout_failure: 'Transferencia fallida',
    payout_cancel: 'Transferencia cancelada',
    stripe_fee: 'Comisión Stripe',
    adjustment: 'Ajuste / disputa',
};

const weekdayLabels = {
    monday: 'los lunes', tuesday: 'los martes', wednesday: 'los miércoles', thursday: 'los jueves',
    friday: 'los viernes', saturday: 'los sábados', sunday: 'los domingos',
};

function describeSchedule(s) {
    if (!s?.interval) return '-';
    if (s.interval === 'daily') return 'Diaria';
    if (s.interval === 'weekly') return `Semanal, ${weekdayLabels[s.weeklyAnchor] || s.weeklyAnchor}`;
    if (s.interval === 'monthly') return `Mensual, el día ${s.monthlyAnchor}`;
    return 'Manual';
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-ES', { dateStyle: 'medium' }) : '-');

const headerStyle = { fontSize: '0.78rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', marginBottom: 8 };

function Badge({ label, color, bg }) {
    return (
        <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4, background: bg, color, whiteSpace: 'nowrap' }}>
            {label}
        </span>
    );
}

function Kpi({ label, value, sub, color }) {
    return (
        <div className="uk-card uk-card-default uk-card-body uk-text-center" style={{ padding: '14px 10px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 2, color }}>{value}</div>
            {sub && <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
        </div>
    );
}

function TransactionsTable({ transactions, showStatus = true }) {
    if (transactions.length === 0) {
        return <div style={{ textAlign: 'center', padding: 12, color: '#94a3b8', fontSize: '0.85rem' }}>Sin movimientos</div>;
    }
    return (
        <div className="uk-overflow-auto">
            <table className="uk-table uk-table-small uk-table-divider" style={{ margin: 0, fontSize: '0.8rem', minWidth: 720 }}>
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Pedido / cliente</th>
                        <th style={{ textAlign: 'right' }}>Importe</th>
                        <th style={{ textAlign: 'right' }}>Comisión</th>
                        <th style={{ textAlign: 'right' }}>Neto</th>
                        {showStatus && <th>Estado</th>}
                    </tr>
                </thead>
                <tbody>
                    {transactions.map(t => (
                        <tr key={t.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.created)}</td>
                            <td>{txTypeLabels[t.type] || t.type}</td>
                            <td>
                                {t.order && <span style={{ fontWeight: 500 }}>#{t.order.orderNum}</span>}
                                {t.invoice && <span style={{ fontWeight: 500 }}>Factura {t.invoice.number}</span>}
                                {t.client && (
                                    <Link to={`/usuarios/${t.client.id}`} style={{ marginLeft: (t.order || t.invoice) ? 6 : 0 }}>
                                        {t.client.firstName} {t.client.lastName}
                                    </Link>
                                )}
                                {!t.order && !t.invoice && !t.client && (
                                    <span style={{ color: '#94a3b8' }}>{t.description || '-'}</span>
                                )}
                            </td>
                            <td style={{ textAlign: 'right', color: t.amount < 0 ? '#dc2626' : undefined }}>{formatEUR(t.amount)}</td>
                            <td style={{ textAlign: 'right', color: '#64748b' }}>{t.fee ? `-${formatEUR(t.fee)}` : '-'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: t.net < 0 ? '#dc2626' : '#16a34a' }}>{formatEUR(t.net)}</td>
                            {showStatus && (
                                <td>
                                    {t.status === 'pending'
                                        ? <Badge label={`Disponible el ${fmtDate(t.availableOn)}`} color="#d97706" bg="#fffbeb" />
                                        : <Badge label="Disponible" color="#16a34a" bg="#f0fdf4" />}
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function StripeBalance({ token }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedId, setExpandedId] = useState(null);
    const [payoutDetails, setPayoutDetails] = useState({});
    const [detailLoading, setDetailLoading] = useState(null);

    const load = () => {
        setLoading(true);
        setError(null);
        fetchStripeBalance(token)
            .then(setData)
            .catch(e => setError(e.error || 'No se pudo consultar Stripe'))
            .finally(() => setLoading(false));
    };

    useEffect(load, [token]);

    const handleExpand = async (payoutId) => {
        if (expandedId === payoutId) {
            setExpandedId(null);
            return;
        }
        setExpandedId(payoutId);
        if (payoutDetails[payoutId]) return;
        setDetailLoading(payoutId);
        try {
            const txs = await fetchStripePayoutTransactions(token, payoutId);
            setPayoutDetails(prev => ({ ...prev, [payoutId]: { transactions: txs } }));
        } catch (e) {
            setPayoutDetails(prev => ({ ...prev, [payoutId]: { error: e.error || 'No se pudo cargar el detalle' } }));
        } finally {
            setDetailLoading(null);
        }
    };

    const payouts = data?.payouts || [];
    // Transferencias ya creadas que todavía no han llegado al banco
    const upcoming = payouts
        .filter(p => ['pending', 'in_transit'].includes(p.status))
        .sort((a, b) => new Date(a.arrivalDate) - new Date(b.arrivalDate));
    const upcomingTotal = upcoming.reduce((sum, p) => sum + p.amount, 0);
    const delayDays = data?.schedule?.delayDays;

    return (
        <div>
            <PageToolbar
                title="Saldo de Stripe"
                actions={
                    <>
                        <a
                            className="uk-button uk-button-default uk-button-small"
                            href="https://dashboard.stripe.com/payouts"
                            target="_blank"
                            rel="noreferrer"
                        >
                            <span uk-icon="icon: link-external; ratio: 0.8" style={{ marginRight: 4 }}></span>
                            Abrir Stripe
                        </a>
                        <button
                            type="button"
                            className="uk-button uk-button-primary uk-button-small"
                            onClick={load}
                            disabled={loading}
                        >
                            <span uk-icon="icon: refresh; ratio: 0.8" style={{ marginRight: 4 }}></span>
                            {loading ? 'Actualizando…' : 'Actualizar'}
                        </button>
                    </>
                }
            />

            {error && (
                <div className="uk-alert-danger" uk-alert="" style={{ marginBottom: 16 }}>
                    <p>{error}</p>
                </div>
            )}

            {data && !data.livemode && (
                <div className="uk-alert-warning" uk-alert="" style={{ marginBottom: 16 }}>
                    <p>Stripe está en modo de pruebas: estos importes no son dinero real.</p>
                </div>
            )}

            {loading && !data ? (
                <div className="uk-card uk-card-default uk-card-body" style={{ textAlign: 'center', padding: 20 }}>Consultando Stripe...</div>
            ) : data && (
                <>
                    {/* KPIs */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 8 }}>
                        <Kpi label="Pendiente" value={formatEUR(data.pending)} color="#d97706"
                             sub={delayDays != null ? `Cobrado, retenido ${delayDays} días` : 'Cobrado, aún retenido'} />
                        <Kpi label="Disponible" value={formatEUR(data.available)} color="#16a34a"
                             sub="Entra en la próxima transferencia" />
                        <Kpi label="En camino al banco" value={formatEUR(upcomingTotal)} color="#2563eb"
                             sub={upcoming.length > 0 ? `Llega el ${fmtDate(upcoming[0].arrivalDate)}` : 'Ninguna transferencia en curso'} />
                        <Kpi label="Transferencias" value={describeSchedule(data.schedule)} color="#0f172a"
                             sub={delayDays != null ? `${delayDays} días de retención` : null} />
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 16 }}>
                        Lo cobrado por Stripe queda <strong>pendiente</strong> durante los días de retención, pasa a <strong>disponible</strong> y
                        sale en la siguiente transferencia automática al banco.
                    </div>

                    {/* Transferencias al banco */}
                    <div className="uk-card uk-card-default uk-card-body" style={{ marginBottom: 16 }}>
                        <div style={headerStyle}>Transferencias al banco</div>
                        {payouts.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 12, color: '#94a3b8' }}>Todavía no hay transferencias</div>
                        ) : (
                            <div className="uk-overflow-auto">
                                <table className="uk-table uk-table-divider uk-table-small uk-table-hover" style={{ margin: 0, minWidth: 640 }}>
                                    <thead>
                                        <tr>
                                            <th>Llegada al banco</th>
                                            <th style={{ textAlign: 'right' }}>Importe</th>
                                            <th>Estado</th>
                                            <th>Cuenta</th>
                                            <th>Tipo</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {payouts.map(p => {
                                            const status = payoutStatus[p.status] || { label: p.status, color: '#64748b', bg: '#f1f5f9' };
                                            const isExpanded = expandedId === p.id;
                                            const detail = payoutDetails[p.id];
                                            return (
                                                <React.Fragment key={p.id}>
                                                    <tr style={{ cursor: 'pointer', background: isExpanded ? '#f8fafc' : undefined }}
                                                        onClick={() => handleExpand(p.id)}>
                                                        <td style={{ fontWeight: 500 }}>{fmtDate(p.arrivalDate)}</td>
                                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatEUR(p.amount)}</td>
                                                        <td>
                                                            <Badge {...status} />
                                                            {p.failureMessage && (
                                                                <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: 2 }}>{p.failureMessage}</div>
                                                            )}
                                                        </td>
                                                        <td style={{ color: '#64748b' }}>
                                                            {p.last4 ? `${p.bankName || 'Cuenta'} ···· ${p.last4}` : '-'}
                                                        </td>
                                                        <td style={{ color: '#64748b' }}>{p.automatic ? 'Automática' : 'Manual'}</td>
                                                        <td><span uk-icon={`icon: chevron-${isExpanded ? 'up' : 'down'}; ratio: 0.8`}></span></td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr>
                                                            <td colSpan="6" style={{ padding: 0 }}>
                                                                <div style={{ background: '#f8fafc', padding: '12px 20px', borderTop: '1px solid #e2e8f0' }}>
                                                                    {detailLoading === p.id ? (
                                                                        <div style={{ textAlign: 'center', padding: 12, color: '#94a3b8' }}>Cargando detalle...</div>
                                                                    ) : detail?.error ? (
                                                                        <div style={{ color: '#dc2626', fontSize: '0.85rem' }}>{detail.error}</div>
                                                                    ) : detail && (
                                                                        <>
                                                                            <div style={headerStyle}>Qué incluye esta transferencia</div>
                                                                            <TransactionsTable transactions={detail.transactions} showStatus={false} />
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Últimos movimientos del saldo */}
                    <div className="uk-card uk-card-default uk-card-body">
                        <div style={headerStyle}>Últimos movimientos</div>
                        <TransactionsTable transactions={data.transactions} />
                    </div>
                </>
            )}
        </div>
    );
}
