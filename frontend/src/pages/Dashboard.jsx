import React, { useEffect, useState, useCallback } from 'react';
import { fetchDashboard, updateOrder, fetchTrackingBoard } from '../api.js';
import { formatEUR } from '../utils/format.js';
import { useNavigate } from 'react-router-dom';
import StatusChangeModal from '../components/StatusChangeModal.jsx';


const STATUS_COLORS = {
    pending: '#f59e0b',
    ready: '#22c55e',
    collected: '#3b82f6',
    cancelled: '#ef4444',
};

function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `hace ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `hace ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `hace ${days}d`;
}

function isUrgent(fechaLimite) {
    if (!fechaLimite) return false;
    const limit = new Date(fechaLimite);
    const now = new Date();
    return limit <= new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
}

function isPast(fechaLimite) {
    if (!fechaLimite) return false;
    return new Date(fechaLimite) < new Date();
}

export default function Dashboard({ token, user }) {
    const [data, setData] = useState(null);
    const [trackingData, setTrackingData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionLoading, setActionLoading] = useState(null);
    const navigate = useNavigate();

    // Modal de confirmación de estado + notificación
    const [confirmModal, setConfirmModal] = useState(null); // { orderId, newStatus, clientChannel }

    const loadData = useCallback(async () => {
        try {
            setError(null);
            const [result, tracking] = await Promise.all([
                fetchDashboard(token),
                fetchTrackingBoard(token).catch(() => null),
            ]);
            setData(result);
            setTrackingData(tracking);
        } catch (err) {
            console.error('Error cargando dashboard:', err);
            setError(err?.error || err?.message || 'No se pudo conectar con el servidor');
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 60000);
        return () => clearInterval(interval);
    }, [loadData]);

    const askStatusChange = (orderId, newStatus, clientChannel) => {
        setConfirmModal({ orderId, newStatus, clientChannel: clientChannel || null });
    };

    const executeStatusChange = async (sendSMS = false) => {
        if (!confirmModal) return;
        const { orderId, newStatus } = confirmModal;
        setConfirmModal(null);
        setActionLoading(orderId);
        try {
            await updateOrder(token, orderId, { status: newStatus, sendSMS });
            await loadData();
        } catch (err) {
            console.error('Error actualizando estado:', err);
        } finally {
            setActionLoading(null);
        }
    };

    if (loading && !data) {
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <p style={{ color: '#64748b' }}>Cargando dashboard...</p>
            </div>
        );
    }

    if (error && !data) {
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <p style={{ color: '#ef4444', marginBottom: 8 }}>Error al cargar el dashboard</p>
                <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: 12 }}>{error}</p>
                <button className="uk-button uk-button-default uk-button-small" onClick={loadData}>
                    Reintentar
                </button>
            </div>
        );
    }

    if (!data) return null;

    const { todayStats, ordersByStatus, pendingOrders, readyOrders, cashStatus, recentActivity } = data;

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700 }}>Dashboard</h2>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.82rem', textTransform: 'capitalize' }}>
                        {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                </div>
                <button className="uk-button uk-button-default uk-button-small" onClick={loadData} style={{ fontSize: '0.78rem' }}>
                    ↻ Actualizar
                </button>
            </div>

            {/* KPIs del día */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
                <KpiCard label="Pedidos hoy" value={todayStats.ordersCount} icon="cart" />
                <KpiCard label="Ingresos hoy" value={formatEUR(todayStats.totalRevenue)} icon="credit-card" accent />
                <KpiCard label="Cobrado" value={formatEUR(todayStats.paidRevenue)} icon="check" color="#22c55e" />
                <KpiCard label="Caja actual" value={formatEUR(cashStatus.currentBalance)} icon="database" sub={`${cashStatus.movementsCount} mov.`} />
            </div>

            {/* Estado de pedidos - pills */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                <StatusPill label="Pendientes" count={ordersByStatus.pending} color={STATUS_COLORS.pending} onClick={() => navigate('/tareas')} />
                <StatusPill label="Listos" count={ordersByStatus.ready} color={STATUS_COLORS.ready} onClick={() => navigate('/tareas')} />
                <StatusPill label="Recogidos hoy" count={ordersByStatus.collectedToday} color={STATUS_COLORS.collected} />
            </div>

            {/* Tracking resumen */}
            {trackingData?.board && trackingData.board.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <strong style={{ fontSize: '0.9rem' }}>Proceso de prendas</strong>
                        <button
                            className="uk-button uk-button-text"
                            style={{ fontSize: '0.75rem' }}
                            onClick={() => navigate('/tracking')}
                        >
                            Ver tablero →
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {trackingData.board.map(col => (
                            <div
                                key={col.stepKey}
                                onClick={() => navigate('/tracking')}
                                style={{
                                    padding: '8px 14px', borderRadius: 10,
                                    background: col.items.some(i => i.status === 'in_progress') ? '#fef3c7' : '#f1f5f9',
                                    border: `1px solid ${col.items.some(i => i.status === 'in_progress') ? '#f59e0b40' : '#e2e8f0'}`,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                                }}
                            >
                                <span style={{
                                    width: 24, height: 24, borderRadius: '50%',
                                    background: col.items.some(i => i.status === 'in_progress') ? '#f59e0b' : '#3b82f6',
                                    color: '#fff', fontWeight: 700, fontSize: '0.75rem',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    {col.items.length}
                                </span>
                                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151' }}>
                                    {col.stepLabel}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Dos columnas: Pendientes y Listos */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 20 }}>
                {/* Pendientes de hacer */}
                <div className="uk-card uk-card-default" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS.pending, display: 'inline-block' }}></span>
                        <strong style={{ fontSize: '0.9rem' }}>Pendientes de hacer</strong>
                        <span className="uk-badge" style={{ marginLeft: 'auto', background: STATUS_COLORS.pending }}>{ordersByStatus.pending}</span>
                    </div>
                    <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                        {pendingOrders.length === 0 ? (
                            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                                🎉 No hay pedidos pendientes
                            </div>
                        ) : (
                            pendingOrders.map(o => (
                                <div key={o.id} style={{
                                    padding: '10px 16px',
                                    borderBottom: '1px solid #f1f5f9',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    background: isPast(o.fechaLimite) ? '#fef2f2' : isUrgent(o.fechaLimite) ? '#fffbeb' : 'transparent',
                                    cursor: 'pointer',
                                }}
                                    onClick={() => navigate('/tareas', { state: { filterOrderId: o.id, orderNumber: o.orderNum || o.id } })}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                                            #{o.orderNum}
                                            <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 6 }}>
                                                {o.client ? `${o.client.firstName} ${o.client.lastName || ''}` : '—'}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
                                            {o.linesSummary || `${o.linesCount} artículos`}
                                        </div>
                                        {o.fechaLimite && (
                                            <div style={{
                                                fontSize: '0.72rem',
                                                marginTop: 2,
                                                color: isPast(o.fechaLimite) ? '#ef4444' : isUrgent(o.fechaLimite) ? '#f59e0b' : '#64748b',
                                                fontWeight: isPast(o.fechaLimite) ? 600 : 400,
                                            }}>
                                                {isPast(o.fechaLimite) ? '⚠️ ' : ''}
                                                Entrega: {new Date(o.fechaLimite).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{formatEUR(o.total)}</div>
                                    </div>
                                    <button
                                        className="uk-button uk-button-primary uk-button-small"
                                        style={{
                                            fontSize: '0.7rem', padding: '2px 10px', flexShrink: 0,
                                            ...(o.hasTracking && !o.allStepsDone ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                                        }}
                                        onClick={(e) => { e.stopPropagation(); askStatusChange(o.id, 'ready', o.client?.notifyChannel); }}
                                        disabled={actionLoading === o.id || (o.hasTracking && !o.allStepsDone)}
                                        title={o.hasTracking && !o.allStepsDone ? 'Tracking en curso — completa todos los pasos primero' : ''}
                                    >
                                        {actionLoading === o.id ? '...' : o.hasTracking && !o.allStepsDone ? '🔒 En proceso' : '✓ Listo'}
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Listos para recoger */}
                <div className="uk-card uk-card-default" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS.ready, display: 'inline-block' }}></span>
                        <strong style={{ fontSize: '0.9rem' }}>Listos para recoger</strong>
                        <span className="uk-badge" style={{ marginLeft: 'auto', background: STATUS_COLORS.ready }}>{ordersByStatus.ready}</span>
                    </div>
                    <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                        {readyOrders.length === 0 ? (
                            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                                No hay pedidos listos
                            </div>
                        ) : (
                            readyOrders.map(o => (
                                <div key={o.id} style={{
                                    padding: '10px 16px',
                                    borderBottom: '1px solid #f1f5f9',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    cursor: 'pointer',
                                }}
                                    onClick={() => navigate('/tareas', { state: { filterOrderId: o.id, orderNumber: o.orderNum || o.id } })}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                                            #{o.orderNum}
                                            <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 6 }}>
                                                {o.client ? `${o.client.firstName} ${o.client.lastName || ''}` : '—'}
                                            </span>
                                        </div>
                                        {o.client?.phone && (
                                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>
                                                📱 {o.client.phone}
                                            </div>
                                        )}
                                        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 1 }}>
                                            Listo {timeAgo(o.updatedAt)}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{formatEUR(o.total)}</div>
                                        {!o.paid && (
                                            <span style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: 600 }}>Sin cobrar</span>
                                        )}
                                        {o.paid && (
                                            <span style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 600 }}>Cobrado</span>
                                        )}
                                    </div>
                                    <button
                                        className="uk-button uk-button-default uk-button-small"
                                        style={{ fontSize: '0.7rem', padding: '2px 10px', flexShrink: 0 }}
                                        onClick={(e) => { e.stopPropagation(); askStatusChange(o.id, 'collected', o.client?.notifyChannel); }}
                                        disabled={actionLoading === o.id}
                                    >
                                        {actionLoading === o.id ? '...' : '📦 Recogido'}
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Actividad reciente */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 20 }}>
                <div className="uk-card uk-card-default" style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb' }}>
                        <strong style={{ fontSize: '0.9rem' }}>🕐 Actividad reciente</strong>
                    </div>
                    <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {recentActivity.map(o => (
                            <div key={o.id} style={{
                                padding: '8px 16px',
                                borderBottom: '1px solid #f8fafc',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                            }}
                                onClick={() => navigate('/tareas', { state: { filterOrderId: o.id, orderNumber: o.orderNum || o.id } })}
                            >
                                <span style={{
                                    width: 8, height: 8, borderRadius: '50%',
                                    background: STATUS_COLORS[o.status] || '#94a3b8',
                                    flexShrink: 0,
                                }}></span>
                                <span style={{ fontWeight: 600 }}>#{o.orderNum}</span>
                                <span style={{ color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {o.client ? `${o.client.firstName} ${o.client.lastName || ''}` : '—'}
                                </span>
                                <span style={{ color: '#94a3b8', fontSize: '0.7rem', flexShrink: 0 }}>
                                    {timeAgo(o.updatedAt)}
                                </span>
                                <span style={{ fontWeight: 600, flexShrink: 0 }}>{formatEUR(o.total)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Caja */}
            {cashStatus && (
                <div className="uk-card uk-card-default uk-card-body" style={{ padding: '14px 18px', marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.9rem' }}>🏦 Estado de caja</strong>
                        <div style={{ display: 'flex', gap: 16, marginLeft: 'auto', fontSize: '0.8rem', color: '#64748b', flexWrap: 'wrap' }}>
                            <span>Apertura: <strong>{formatEUR(cashStatus.openingAmount)}</strong></span>
                            <span>Saldo: <strong style={{ color: '#1e293b' }}>{formatEUR(cashStatus.currentBalance)}</strong></span>
                            <span>{cashStatus.movementsCount} movimientos</span>
                            {cashStatus.lastClosureAt && (
                                <span>Último cierre: {new Date(cashStatus.lastClosureAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    {cashStatus.lastClosureBy && ` por ${cashStatus.lastClosureBy}`}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de confirmación de cambio de estado */}
            <StatusChangeModal
                action={confirmModal?.newStatus || null}
                clientChannel={confirmModal?.clientChannel || null}
                onConfirm={(sendSMS) => executeStatusChange(sendSMS)}
                onCancel={() => setConfirmModal(null)}
            />
        </div>
    );
}

// --- Subcomponentes ---

function KpiCard({ label, value, icon, color, accent, sub }) {
    return (
        <div className="uk-card uk-card-default uk-card-body uk-text-center" style={{
            padding: '14px 10px',
            borderTop: accent ? '3px solid #048ABF' : color ? `3px solid ${color}` : undefined,
        }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                {icon && <span uk-icon={`icon: ${icon}; ratio: 0.65`}></span>}
                {label}
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: 4, color: color || '#1e293b' }}>{value}</div>
            {sub && <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
        </div>
    );
}

function StatusPill({ label, count, color, onClick }) {
    return (
        <div
            onClick={onClick}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 20,
                background: `${color}15`,
                border: `1px solid ${color}40`,
                cursor: onClick ? 'pointer' : 'default',
                transition: 'transform 0.1s',
            }}
            onMouseEnter={(e) => onClick && (e.currentTarget.style.transform = 'scale(1.02)')}
            onMouseLeave={(e) => onClick && (e.currentTarget.style.transform = 'scale(1)')}
        >
            <span style={{
                width: 28, height: 28, borderRadius: '50%', background: color,
                color: '#fff', fontWeight: 700, fontSize: '0.85rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                {count}
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color }}>{label}</span>
        </div>
    );
}

