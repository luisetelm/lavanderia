import React, { useEffect, useState } from 'react';
import { fetchCashClosures, fetchClosureMovements, reconcilePayment, downloadClosuresReport } from '../api.js';
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

const cardMethodLabels = {
    card_pos: 'Tarjeta (TPV)',
    card: 'Tarjeta',
    stripe: 'Stripe',
    transfer: 'Transferencia',
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
    const [downloadingPdf, setDownloadingPdf] = useState(false);

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

    // Marca/desmarca un pago como conciliado y actualiza el detalle en memoria
    const handleToggleReconcile = async (closureId, payment) => {
        const next = !payment.reconciled;
        try {
            const res = await reconcilePayment(token, payment.id, next);
            setMovements(prev => {
                const detail = prev[closureId];
                if (!detail) return prev;
                const cardPayments = (detail.cardPayments || []).map(p =>
                    p.id === payment.id ? { ...p, reconciled: res.reconciled, reconciledAt: res.reconciledAt } : p
                );
                const cardTotal = Number(detail.cardTotal || 0);
                const reconciledTotal = Number(
                    cardPayments.filter(p => p.reconciled).reduce((a, p) => a + Number(p.amount || 0), 0).toFixed(2)
                );
                return {
                    ...prev,
                    [closureId]: {
                        ...detail,
                        cardPayments,
                        reconciledTotal,
                        pendingTotal: Number((cardTotal - reconciledTotal).toFixed(2)),
                    },
                };
            });
        } catch (e) {
            console.error('Error conciliando pago:', e);
        }
    };

    // Exporta un informe CSV con el detalle y descuadres de un cierre
    const handleExportClosure = (closure, detail) => {
        const esc = (v) => {
            const s = v == null ? '' : String(v);
            return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const fmt = (n) => Number(n || 0).toFixed(2).replace('.', ',');
        const rows = [];
        rows.push(['INFORME DE CIERRE DE CAJA']);
        rows.push(['Fecha', new Date(closure.closedat).toLocaleString('es-ES')]);
        rows.push(['Cajero', closure.user ? `${closure.user.firstName} ${closure.user.lastName}` : '-']);
        rows.push([]);
        rows.push(['Resumen efectivo']);
        rows.push(['Apertura', fmt(closure.openingamount)]);
        rows.push(['Esperado', fmt(closure.expectedamount)]);
        rows.push(['Contado', fmt(closure.countedamount)]);
        rows.push(['Descuadre', fmt(closure.diff)]);
        rows.push([]);

        rows.push(['Movimientos en efectivo']);
        rows.push(['Hora', 'Tipo', 'Importe', 'Pedido', 'Persona', 'Nota']);
        (detail?.movements || []).forEach(m => {
            const neg = isNegativeType(m.type);
            rows.push([
                new Date(m.movementat).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
                typeLabels[m.type] || m.type,
                `${neg ? '-' : ''}${fmt(m.amount)}`,
                m.order ? `#${m.order.orderNum}` : '',
                m.personUser ? `${m.personUser.firstName} ${m.personUser.lastName}` : '',
                m.note || '',
            ]);
        });
        rows.push([]);

        rows.push(['Pagos no en efectivo (TPV / transferencia / Stripe)']);
        rows.push(['Hora', 'Método', 'Importe', 'Pedido', 'Cliente', 'Conciliado', 'Fecha conciliación', 'Nota']);
        (detail?.cardPayments || []).forEach(p => {
            rows.push([
                new Date(p.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
                cardMethodLabels[p.method] || p.method,
                fmt(p.amount),
                p.order ? `#${p.order.orderNum}` : '',
                p.client ? `${p.client.firstName} ${p.client.lastName}` : '',
                p.reconciled ? 'Sí' : 'No',
                p.reconciledAt ? new Date(p.reconciledAt).toLocaleString('es-ES') : '',
                p.note || '',
            ]);
        });
        rows.push([]);
        rows.push(['Total no efectivo', fmt(detail?.cardTotal)]);
        rows.push(['Conciliado', fmt(detail?.reconciledTotal)]);
        rows.push(['Pendiente de conciliar', fmt(detail?.pendingTotal)]);

        const csv = '\uFEFF' + rows.map(r => r.map(esc).join(';')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cierre_${new Date(closure.closedat).toISOString().slice(0, 10)}_${closure.id}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const totalDiff = closures.reduce((sum, c) => sum + Number(c.diff || 0), 0);
    const totalNonCash = closures.reduce((sum, c) => sum + Number(c.cardTotal || 0), 0);
    const totalReconciled = closures.reduce((sum, c) => sum + Number(c.reconciledTotal || 0), 0);
    const totalPendingNonCash = Number((totalNonCash - totalReconciled).toFixed(2));
    // Descuadre total: descuadre de efectivo + lo no conciliado del no-efectivo
    const totalGlobalDiff = Number((totalDiff + totalPendingNonCash).toFixed(2));

    const handleDownloadPdf = async () => {
        setDownloadingPdf(true);
        try {
            await downloadClosuresReport(token, dateRange);
        } catch (e) {
            console.error('Error descargando informe PDF:', e);
        } finally {
            setDownloadingPdf(false);
        }
    };

    return (
        <div>
            <PageToolbar
                title="Auditoría de caja"
                actions={
                    <button
                        type="button"
                        className="uk-button uk-button-primary uk-button-small"
                        onClick={handleDownloadPdf}
                        disabled={downloadingPdf || closures.length === 0}
                    >
                        <span uk-icon="icon: download; ratio: 0.8" style={{ marginRight: 4 }}></span>
                        {downloadingPdf ? 'Generando…' : 'Informe PDF'}
                    </button>
                }
            />

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
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Descuadre efectivo</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 2, color: Math.abs(totalDiff) > 0.01 ? '#ef4444' : '#10b981' }}>
                        {formatEUR(totalDiff)}
                    </div>
                </div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center" style={{ padding: '14px 10px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>No efectivo (TPV/transf.)</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 2, color: '#2563eb' }}>{formatEUR(totalNonCash)}</div>
                </div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center" style={{ padding: '14px 10px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Conciliado</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 2, color: '#16a34a' }}>{formatEUR(totalReconciled)}</div>
                    {totalPendingNonCash > 0.01 && (
                        <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: 2 }}>
                            Pendiente: {formatEUR(totalPendingNonCash)}
                        </div>
                    )}
                </div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center"
                     style={{ padding: '14px 10px', borderTop: Math.abs(totalGlobalDiff) > 0.01 ? '3px solid #ef4444' : '3px solid #10b981' }}
                     title="Descuadre de efectivo + importe no conciliado del no efectivo">
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Descuadre total</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 2, color: Math.abs(totalGlobalDiff) > 0.01 ? '#ef4444' : '#10b981' }}>
                        {formatEUR(totalGlobalDiff)}
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
                                                            ) : (
                                                                <>
                                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                                                                        <button
                                                                            type="button"
                                                                            className="uk-button uk-button-default uk-button-small"
                                                                            onClick={() => handleExportClosure(c, closureMovs)}
                                                                        >
                                                                            <span uk-icon="icon: download; ratio: 0.8" style={{ marginRight: 4 }}></span>
                                                                            Exportar informe (CSV)
                                                                        </button>
                                                                    </div>
                                                                    {/* Movimientos de efectivo */}
                                                                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>
                                                                        Movimientos en efectivo
                                                                    </div>
                                                                    {closureMovs?.movements?.length === 0 ? (
                                                                        <div style={{ textAlign: 'center', padding: 8, color: '#94a3b8', fontSize: '0.85rem' }}>Sin movimientos</div>
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

                                                                    {/* Pagos no en efectivo: conciliación a posteriori (banco/TPV) */}
                                                                    {(() => {
                                                                        const cardPayments = closureMovs?.cardPayments || [];
                                                                        const cardTotal = Number(closureMovs?.cardTotal || 0);
                                                                        const reconciledTotal = Number(closureMovs?.reconciledTotal ?? cardPayments.filter(p => p.reconciled).reduce((a, p) => a + Number(p.amount || 0), 0));
                                                                        const pendingTotal = Number((cardTotal - reconciledTotal).toFixed(2));
                                                                        const byMethod = cardPayments.reduce((acc, p) => {
                                                                            const k = p.method || 'card';
                                                                            acc[k] = (acc[k] || 0) + Number(p.amount || 0);
                                                                            return acc;
                                                                        }, {});
                                                                        return (
                                                                            <div style={{ marginTop: 14 }}>
                                                                                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                                                                                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase' }}>
                                                                                        Pagos no en efectivo (conciliación banco/TPV)
                                                                                    </div>
                                                                                    <div style={{ fontSize: '0.85rem', color: '#0f172a' }}>
                                                                                        Total: <strong style={{ color: '#2563eb' }}>{formatEUR(cardTotal)}</strong>
                                                                                        <span style={{ color: '#16a34a', marginLeft: 8 }}>Conciliado: {formatEUR(reconciledTotal)}</span>
                                                                                        <span style={{ color: pendingTotal > 0.01 ? '#ef4444' : '#64748b', marginLeft: 8 }}>Pendiente: {formatEUR(pendingTotal)}</span>
                                                                                        {Object.keys(byMethod).length > 0 && (
                                                                                            <span style={{ color: '#64748b', marginLeft: 8 }}>
                                                                                                ({Object.entries(byMethod).map(([k, v]) =>
                                                                                                    `${cardMethodLabels[k] || k}: ${formatEUR(v)}`
                                                                                                ).join(' · ')})
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                                {cardPayments.length === 0 ? (
                                                                                    <div style={{ textAlign: 'center', padding: 8, color: '#94a3b8', fontSize: '0.85rem' }}>
                                                                                        Sin pagos no en efectivo en este periodo
                                                                                    </div>
                                                                                ) : (
                                                                                    <table className="uk-table uk-table-small uk-table-divider" style={{ margin: 0, fontSize: '0.8rem' }}>
                                                                                        <thead>
                                                                                            <tr>
                                                                                                <th style={{ textAlign: 'center', width: 70 }}>Conciliado</th>
                                                                                                <th>Hora</th>
                                                                                                <th>Método</th>
                                                                                                <th style={{ textAlign: 'right' }}>Importe</th>
                                                                                                <th>Pedido</th>
                                                                                                <th>Cliente</th>
                                                                                                <th>Nota</th>
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody>
                                                                                            {cardPayments.map(p => (
                                                                                                <tr key={p.id} style={{ background: p.reconciled ? '#f0fdf4' : undefined }}>
                                                                                                    <td style={{ textAlign: 'center' }}>
                                                                                                        <input
                                                                                                            type="checkbox"
                                                                                                            className="uk-checkbox"
                                                                                                            checked={!!p.reconciled}
                                                                                                            title={p.reconciled && p.reconciledAt ? `Conciliado el ${new Date(p.reconciledAt).toLocaleString('es-ES')}` : 'Marcar como conciliado en banco/TPV'}
                                                                                                            onChange={() => handleToggleReconcile(c.id, p)}
                                                                                                        />
                                                                                                    </td>
                                                                                                    <td>{new Date(p.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</td>
                                                                                                    <td>
                                                                                                        <span style={{
                                                                                                            fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4,
                                                                                                            background: '#eff6ff', color: '#2563eb',
                                                                                                        }}>
                                                                                                            {cardMethodLabels[p.method] || p.method}
                                                                                                        </span>
                                                                                                    </td>
                                                                                                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#2563eb' }}>
                                                                                                        {formatEUR(Number(p.amount || 0))}
                                                                                                    </td>
                                                                                                    <td>{p.order ? `#${p.order.orderNum}` : '-'}</td>
                                                                                                    <td>{p.client ? `${p.client.firstName} ${p.client.lastName}` : '-'}</td>
                                                                                                    <td style={{ color: '#64748b' }}>{p.note || '-'}</td>
                                                                                                </tr>
                                                                                            ))}
                                                                                        </tbody>
                                                                                    </table>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })()}
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
        </div>
    );
}
