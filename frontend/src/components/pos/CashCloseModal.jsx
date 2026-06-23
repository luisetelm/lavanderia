import React from 'react';

const typeLabel = {
    sale_cash_in: 'Venta (efectivo)',
    withdrawal: 'Retirada',
    deposit: 'Ingreso',
    refund_cash_out: 'Devolucion (efectivo)',
    opening: 'Apertura',
    correction: 'Correccion',
};
const signed = (t, a) => (['withdrawal', 'refund_cash_out'].includes(t) ? -Math.abs(a) : Math.abs(a));
const eur = (n) => `${Number(n || 0).toFixed(2)} €`;

// Píldora de estado: verde si cuadra, rojo si hay descuadre, gris si está pendiente
function StatusBadge({ state, label }) {
    const palette = {
        ok: { bg: '#dcfce7', color: '#15803d' },
        bad: { bg: '#fee2e2', color: '#b91c1c' },
        idle: { bg: '#f1f5f9', color: '#64748b' },
    }[state] || { bg: '#f1f5f9', color: '#64748b' };
    return (
        <span style={{
            fontSize: '0.72rem', fontWeight: 700, padding: '2px 10px', borderRadius: 999,
            background: palette.bg, color: palette.color, textTransform: 'uppercase', letterSpacing: '.02em',
        }}>
            {label}
        </span>
    );
}

// Dato calculado compacto (solo lectura) para las mini-estadísticas
function MiniStat({ label, value, strong }) {
    return (
        <div style={{ flex: 1, minWidth: 90 }}>
            <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: strong ? '1.05rem' : '0.95rem', fontWeight: strong ? 700 : 500, color: '#0f172a' }}>{value}</div>
        </div>
    );
}

export default function CashCloseModal({
    show,
    onClose,
    cashErr,
    openingAmount,
    sumMoves,
    expectedAmount,
    countedAmount,
    setCountedAmount,
    diffAmount,
    closeNotes,
    setCloseNotes,
    unclosedMoves,
    tpvPayments = [],
    tpvTotal = 0,
    tpvMarkedTotal = 0,
    onToggleTpv,
    onToggleAllTpv,
    onCloseCash,
}) {
    if (!show) return null;

    // Estado del efectivo
    const cashCountedTouched = countedAmount !== '' && countedAmount !== null && countedAmount !== undefined;
    const cashOk = cashCountedTouched && Math.abs(Number(diffAmount || 0)) < 0.01;
    const cashState = !cashCountedTouched ? 'idle' : (cashOk ? 'ok' : 'bad');
    const cashBadge = !cashCountedTouched ? 'Pendiente' : (cashOk ? 'Cuadra' : `Descuadre ${eur(diffAmount)}`);

    // Estado del TPV: solo importa que cada cobro quede conciliado (marcado)
    const hasTpv = tpvPayments.length > 0;
    const tpvAllMarked = hasTpv && tpvPayments.every(p => p.reconciled);
    const tpvPendingCount = tpvPayments.filter(p => !p.reconciled).length;
    let tpvState, tpvBadge;
    if (!hasTpv) {
        tpvState = 'idle';
        tpvBadge = 'Sin tarjeta';
    } else if (tpvAllMarked) {
        tpvState = 'ok';
        tpvBadge = 'Conciliado';
    } else {
        tpvState = 'bad';
        tpvBadge = `${tpvPendingCount} sin conciliar`;
    }

    const cardStyle = { borderRadius: 10 };
    const headerRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 };
    const headerTitle = { margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' };

    return (
        <div className="uk-modal uk-open" style={{ display: 'block' }}>
            <div className="uk-modal-dialog uk-modal-body" style={{ width: 680, maxWidth: '95vw' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <h3 style={{ margin: 0 }}>Cierre de caja</h3>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Arqueo de efectivo y conciliación de tarjeta</span>
                </div>
                {cashErr && <div className="uk-alert-danger uk-margin-small-top" uk-alert="true"><p>{cashErr}</p></div>}

                {/* ── EFECTIVO ── */}
                <div className="uk-card uk-card-default uk-card-body uk-margin-small-top" style={cardStyle}>
                    <div style={headerRow}>
                        <h4 style={headerTitle}>💶 Efectivo</h4>
                        <StatusBadge state={cashState} label={cashBadge} />
                    </div>

                    <div style={{ display: 'flex', gap: 8, padding: '6px 0 12px', borderBottom: '1px dashed #e2e8f0' }}>
                        <MiniStat label="Apertura" value={eur(openingAmount)} />
                        <MiniStat label="Movimientos" value={eur(sumMoves)} />
                        <MiniStat label="Esperado" value={eur(expectedAmount)} strong />
                    </div>

                    <div className="uk-grid-small uk-flex-middle uk-margin-small-top" uk-grid="true">
                        <div className="uk-width-1-2@s">
                            <label className="uk-form-label" style={{ fontWeight: 600 }}>Efectivo contado</label>
                            <input className="uk-input" type="number" step="0.01" placeholder="0,00"
                                   style={{ fontSize: '1.1rem', fontWeight: 600 }}
                                   value={countedAmount}
                                   onChange={(e) => setCountedAmount(e.target.value)} autoFocus />
                        </div>
                        <div className="uk-width-1-2@s">
                            <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>Descuadre</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: !cashCountedTouched ? '#94a3b8' : (cashOk ? '#16a34a' : '#dc2626') }}>
                                {cashCountedTouched ? eur(diffAmount) : '—'}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── TARJETA / TPV ── */}
                <div className="uk-card uk-card-default uk-card-body uk-margin-small-top" style={cardStyle}>
                    <div style={headerRow}>
                        <h4 style={headerTitle}>💳 Tarjeta / TPV</h4>
                        <StatusBadge state={tpvState} label={tpvBadge} />
                    </div>

                    {!hasTpv ? (
                        <div style={{ textAlign: 'center', padding: '10px 0', color: '#94a3b8', fontSize: '0.9rem' }}>
                            No hay cobros con tarjeta en este periodo.
                        </div>
                    ) : (
                        <>
                            <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 10px' }}>
                                Marca cada cobro con tarjeta a medida que lo confirmas. Los que queden
                                <strong> sin marcar</strong> son los que faltan por conciliar.
                            </p>

                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', paddingBottom: 12, borderBottom: '1px dashed #e2e8f0' }}>
                                <MiniStat label="Registrado" value={eur(tpvTotal)} />
                                <MiniStat label="Conciliado" value={eur(tpvMarkedTotal)} strong />
                                <div style={{ flex: 1, minWidth: 90 }}>
                                    <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>Pendiente</div>
                                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: tpvPendingCount > 0 ? '#dc2626' : '#16a34a' }}>
                                        {eur(Number((tpvTotal - tpvMarkedTotal).toFixed(2)))}
                                    </div>
                                </div>
                            </div>

                            <div className="uk-flex uk-flex-between uk-flex-middle uk-margin-small-top" style={{ flexWrap: 'wrap', gap: 6 }}>
                                <span style={{ fontSize: '0.8rem', color: '#475569' }}>
                                    {tpvPayments.length} cobro(s) · {tpvPendingCount > 0
                                        ? <strong style={{ color: '#dc2626' }}>{tpvPendingCount} sin conciliar</strong>
                                        : <strong style={{ color: '#16a34a' }}>todos conciliados</strong>}
                                </span>
                                <button className="uk-button uk-button-small uk-button-default" type="button"
                                        onClick={() => onToggleAllTpv(!tpvAllMarked)}>
                                    {tpvAllMarked ? 'Desmarcar todos' : 'Marcar todos'}
                                </button>
                            </div>

                            <table className="uk-table uk-table-small uk-table-divider" style={{ margin: '4px 0 0', fontSize: '0.8rem' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'center', width: 50 }}>OK</th>
                                        <th>Hora</th>
                                        <th style={{ textAlign: 'right' }}>Importe</th>
                                        <th>Pedido</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tpvPayments.map(p => (
                                        <tr key={p.id} style={{ background: p.reconciled ? '#f0fdf4' : undefined }}>
                                            <td style={{ textAlign: 'center' }}>
                                                <input type="checkbox" className="uk-checkbox"
                                                       checked={!!p.reconciled}
                                                       onChange={() => onToggleTpv(p)} />
                                            </td>
                                            <td>{new Date(p.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: '#2563eb' }}>{eur(p.amount)}</td>
                                            <td>{p.order ? `#${p.order.orderNum}` : '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>
                    )}
                </div>

                {/* ── RESUMEN (incluye notas) ── */}
                <div className="uk-card uk-card-default uk-card-body uk-margin-small-top" style={cardStyle}>
                    <h4 style={{ ...headerTitle, marginBottom: 12 }}>🧾 Resumen del periodo</h4>
                    <div className="uk-grid-small uk-child-width-1-2@s" uk-grid="true" style={{ fontSize: '0.88rem' }}>
                        <div className="uk-flex uk-flex-between"><span>Ventas (efectivo)</span><strong>{eur(unclosedMoves.filter(m => m.type === 'sale_cash_in').reduce((a, m) => a + Number(m.amount), 0))}</strong></div>
                        <div className="uk-flex uk-flex-between"><span>Retiros</span><strong>{eur(unclosedMoves.filter(m => m.type === 'withdrawal').reduce((a, m) => a + Number(m.amount), 0))}</strong></div>
                        <div className="uk-flex uk-flex-between"><span>Ingresos</span><strong>{eur(unclosedMoves.filter(m => m.type === 'deposit').reduce((a, m) => a + Number(m.amount), 0))}</strong></div>
                        <div className="uk-flex uk-flex-between"><span>Devoluciones</span><strong>{eur(unclosedMoves.filter(m => m.type === 'refund_cash_out').reduce((a, m) => a + Number(m.amount), 0))}</strong></div>
                    </div>

                    <hr style={{ margin: '12px 0' }} />
                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>Movimientos en el periodo</div>
                    <ul className="uk-list uk-list-divider" style={{ maxHeight: 150, overflow: 'auto', margin: 0, fontSize: '0.85rem' }}>
                        {unclosedMoves.map(m => (
                            <li key={m.id} className="uk-flex uk-flex-between">
                                <span>{typeLabel[m.type]} {m.note ? `- ${m.note}` : ''}</span>
                                <span>{eur(signed(m.type, Number(m.amount)))}</span>
                            </li>
                        ))}
                        {!unclosedMoves.length && <li style={{ color: '#94a3b8' }}>Sin movimientos</li>}
                    </ul>

                    <hr style={{ margin: '12px 0' }} />
                    <label className="uk-form-label" style={{ fontWeight: 600 }}>Notas del cierre</label>
                    <textarea className="uk-textarea uk-margin-small-top" rows="2" placeholder="Observaciones (opcional)"
                              value={closeNotes}
                              onChange={(e) => setCloseNotes(e.target.value)} />
                </div>

                {/* ── PIE ── */}
                <div className="uk-margin-top uk-flex uk-flex-between uk-flex-middle" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.82rem', color: '#475569' }}>
                        <span>Efectivo:</span> <StatusBadge state={cashState} label={cashBadge} />
                        {hasTpv && (<><span style={{ marginLeft: 6 }}>Tarjeta:</span> <StatusBadge state={tpvState} label={tpvBadge} /></>)}
                    </div>
                    <div>
                        <button className="uk-button uk-button-default" onClick={onClose}>Cancelar</button>
                        <button className="uk-button uk-button-primary uk-margin-small-left" onClick={onCloseCash}>Cerrar caja</button>
                    </div>
                </div>
            </div>
            <div className="uk-modal-bg" onClick={onClose}></div>
        </div>
    );
}
