import React, { useEffect, useState } from 'react';
import { fetchCashClosures, fetchClosureMovements } from '../api.js';
import { formatEUR } from '../utils/format.js';
import PageToolbar from '../components/PageToolbar.jsx';
import DateRangeSelector from '../components/DateRangeSelector.jsx';
import { getDateRange } from '../utils/dates.js';

const typeLabels = {
    sale_cash_in: 'Venta (efectivo)',
    withdrawal: 'Retirada',
    deposit: 'Ingreso',
    refund_cash_out: 'Devolución',
    opening: 'Apertura',
    correction: 'Corrección',
};

function isNegativeType(type) {
    return ['withdrawal', 'refund_cash_out'].includes(type);
}

export default function CashAudit({ token }) {
    const [closures, setClosures] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);
    const [movements, setMovements] = useState({});
    const [movLoading, setMovLoading] = useState(null);

    const [dateRange, setDateRange] = useState(() => {
        const [from, to] = getDateRange('last_3');
        return { from, to };
    });

    useEffect(() => {
        setLoading(true);
        fetchCashClosures(token, dateRange)
            .then(setClosures)
            .catch(() => setClosures([]))
            .finally(() => setLoading(false));
    }, [token, dateRange.from, dateRange.to]);

    const handleExpand = async (closureId) => {
        if (expandedId === closureId) {
            setExpandedId(null);
            return;
        }
        setExpandedId(closureId);
        if (!movements[closureId]) {
            setMovLoading(closureId);
            try {
                const data = await fetchClosureMovements(token, closureId);
                setMovements(prev => ({ ...prev, [closureId]: data }));
            } catch {
                setMovements(prev => ({ ...prev, [closureId]: { movements: [] } }));
            } finally {
                setMovLoading(null);
            }
        }
    };

    const totalDiff = closures.reduce((sum, c) => sum + Number(c.diff || 0), 0);

    return (
        <div>
            <PageToolbar title="Auditoría de caja" />

            <div className="uk-card uk-card-default uk-card-body" style={{ marginBottom: 16 }}>
                <DateRangeSelector
                    from={dateRange.from}
                    to={dateRange.to}
                    onChange={({ from, to }) => setDateRange({ from, to })}
                />
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
                <div className="uk-card uk-card-default uk-card-body uk-text-center" style={{ padding: '14px 10px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Cierres</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 2 }}>{closures.length}</div>
                </div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center"
                     style={{ padding: '14px 10px', borderTop: Math.abs(totalDiff) > 0.01 ? '3px solid #ef4444' : '3px solid #10b981' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Descuadre total</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 2, color: Math.abs(totalDiff) > 0.01 ? '#ef4444' : '#10b981' }}>
                        {formatEUR(totalDiff)}
                    </div>
                </div>
            </div>

            {/* Lista de cierres */}
            <div className="uk-card uk-card-default uk-card-body">
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 20 }}>Cargando cierres...</div>
                ) : closures.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>No hay cierres en este periodo</div>
                ) : (
                    <div className="uk-overflow-auto">
                        <table className="uk-table uk-table-divider uk-table-small uk-table-hover" style={{ minWidth: 600 }}>
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Cajero</th>
                                    <th style={{ textAlign: 'right' }}>Apertura</th>
                                    <th style={{ textAlign: 'right' }}>Esperado</th>
                                    <th style={{ textAlign: 'right' }}>Contado</th>
                                    <th style={{ textAlign: 'right' }}>Descuadre</th>
                                    <th>Notas</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {closures.map(c => {
                                    const diff = Number(c.diff || 0);
                                    const hasDiff = Math.abs(diff) > 0.01;
                                    const isExpanded = expandedId === c.id;
                                    const closureMovs = movements[c.id];

                                    return (
                                        <React.Fragment key={c.id}>
                                            <tr
                                                style={{ cursor: 'pointer', background: isExpanded ? '#f8fafc' : undefined }}
                                                onClick={() => handleExpand(c.id)}
                                            >
                                                <td>
                                                    <div style={{ fontWeight: 500 }}>
                                                        {new Date(c.closedat).toLocaleDateString('es-ES', { dateStyle: 'medium' })}
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                                        {new Date(c.closedat).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </td>
                                                <td>{c.user ? `${c.user.firstName} ${c.user.lastName}` : '-'}</td>
                                                <td style={{ textAlign: 'right' }}>{formatEUR(Number(c.openingamount))}</td>
                                                <td style={{ textAlign: 'right' }}>{formatEUR(Number(c.expectedamount))}</td>
                                                <td style={{ textAlign: 'right' }}>{formatEUR(Number(c.countedamount))}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 600, color: hasDiff ? '#ef4444' : '#10b981' }}>
                                                    {diff > 0 ? '+' : ''}{formatEUR(diff)}
                                                </td>
                                                <td style={{ fontSize: '0.8rem', color: '#64748b', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {c.notes || '-'}
                                                </td>
                                                <td>
                                                    <span uk-icon={`icon: chevron-${isExpanded ? 'up' : 'down'}; ratio: 0.8`}></span>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr>
                                                    <td colSpan="8" style={{ padding: 0 }}>
                                                        <div style={{ background: '#f8fafc', padding: '12px 20px', borderTop: '1px solid #e2e8f0' }}>
                                                            {movLoading === c.id ? (
                                                                <div style={{ textAlign: 'center', padding: 12, color: '#94a3b8' }}>Cargando movimientos...</div>
                                                            ) : closureMovs?.movements?.length === 0 ? (
                                                                <div style={{ textAlign: 'center', padding: 12, color: '#94a3b8' }}>Sin movimientos</div>
                                                            ) : (
                                                                <table className="uk-table uk-table-small uk-table-divider" style={{ margin: 0, fontSize: '0.8rem' }}>
                                                                    <thead>
                                                                        <tr>
                                                                            <th>Hora</th>
                                                                            <th>Tipo</th>
                                                                            <th style={{ textAlign: 'right' }}>Importe</th>
                                                                            <th>Pedido</th>
                                                                            <th>Persona</th>
                                                                            <th>Nota</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {(closureMovs?.movements || []).map(m => {
                                                                            const amount = Number(m.amount || 0);
                                                                            const neg = isNegativeType(m.type);
                                                                            return (
                                                                                <tr key={m.id}>
                                                                                    <td>{new Date(m.movementat).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</td>
                                                                                    <td>
                                                                                        <span style={{
                                                                                            fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4,
                                                                                            background: neg ? '#fef2f2' : '#f0fdf4',
                                                                                            color: neg ? '#dc2626' : '#16a34a',
                                                                                        }}>
                                                                                            {typeLabels[m.type] || m.type}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td style={{ textAlign: 'right', fontWeight: 600, color: neg ? '#dc2626' : '#16a34a' }}>
                                                                                        {neg ? '-' : '+'}{formatEUR(amount)}
                                                                                    </td>
                                                                                    <td>{m.order ? `#${m.order.orderNum}` : '-'}</td>
                                                                                    <td>{m.personUser ? `${m.personUser.firstName} ${m.personUser.lastName}` : '-'}</td>
                                                                                    <td style={{ color: '#64748b' }}>{m.note || '-'}</td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
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
        </div>
    );
}
