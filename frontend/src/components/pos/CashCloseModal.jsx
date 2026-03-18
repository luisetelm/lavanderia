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
    onCloseCash,
}) {
    if (!show) return null;

    return (
        <div className="uk-modal uk-open" style={{display: 'block'}}>
            <div className="uk-modal-dialog uk-modal-body">
                <h3>Cierre de caja</h3>
                {cashErr && <div className="uk-alert-danger" uk-alert="true"><p>{cashErr}</p></div>}

                <div className="uk-grid-small" uk-grid="true">
                    <div className="uk-width-1-2">
                        <div className="uk-form-stacked">
                            <label className="uk-form-label">Apertura</label>
                            <input className="uk-input" type="text" readOnly
                                   value={openingAmount.toFixed(2) + ' \u20ac'}/>
                        </div>
                    </div>
                    <div className="uk-width-1-2">
                        <div className="uk-form-stacked">
                            <label className="uk-form-label">Movimientos</label>
                            <input className="uk-input" type="text" readOnly value={sumMoves.toFixed(2) + ' \u20ac'}/>
                        </div>
                    </div>
                    <div className="uk-width-1-2">
                        <div className="uk-form-stacked">
                            <label className="uk-form-label">Esperado</label>
                            <input className="uk-input" type="text" readOnly
                                   value={expectedAmount.toFixed(2) + ' \u20ac'}/>
                        </div>
                    </div>
                    <div className="uk-width-1-2">
                        <div className="uk-form-stacked">
                            <label className="uk-form-label">Contado</label>
                            <input className="uk-input" type="number" step="0.01" value={countedAmount}
                                   onChange={(e) => setCountedAmount(e.target.value)}/>
                        </div>
                    </div>
                    <div className="uk-width-1-2">
                        <div className="uk-form-stacked">
                            <label className="uk-form-label">Descuadre</label>
                            <input className="uk-input" type="text" readOnly value={diffAmount.toFixed(2) + ' \u20ac'}/>
                        </div>
                    </div>
                    <div className="uk-width-1-1">
                        <label className="uk-form-label">Notas del cierre</label>
                        <textarea className="uk-textarea" rows="2" value={closeNotes}
                                  onChange={(e) => setCloseNotes(e.target.value)}/>
                    </div>
                </div>

                <div className="uk-margin uk-card uk-card-default uk-card-body">
                    <h4 className="uk-margin-small">Resumen</h4>
                    <div className="uk-grid-small" uk-grid="true">
                        <div className="uk-width-1-2">Ventas
                            (efectivo): {(unclosedMoves.filter(m => m.type === 'sale_cash_in')
                                .reduce((a, m) => a + Number(m.amount), 0)).toFixed(2)} \u20ac
                        </div>
                        <div className="uk-width-1-2">Retiros: {(unclosedMoves.filter(m => m.type === 'withdrawal')
                            .reduce((a, m) => a + Number(m.amount), 0)).toFixed(2)} \u20ac
                        </div>
                        <div className="uk-width-1-2">Ingresos: {(unclosedMoves.filter(m => m.type === 'deposit')
                            .reduce((a, m) => a + Number(m.amount), 0)).toFixed(2)} \u20ac
                        </div>
                        <div
                            className="uk-width-1-2">Devoluciones: {(unclosedMoves.filter(m => m.type === 'refund_cash_out')
                            .reduce((a, m) => a + Number(m.amount), 0)).toFixed(2)} \u20ac
                        </div>
                    </div>
                    <hr/>
                    <h5>Movimientos en periodo</h5>
                    <ul className="uk-list uk-list-divider" style={{maxHeight: 160, overflow: 'auto'}}>
                        {unclosedMoves.map(m => (<li key={m.id} className="uk-flex uk-flex-between">
                            <span>{typeLabel[m.type]} {m.note ? `- ${m.note}` : ''}</span>
                            <span>{signed(m.type, Number(m.amount)).toFixed(2)} \u20ac</span>
                        </li>))}
                        {!unclosedMoves.length && <li>Sin movimientos</li>}
                    </ul>
                </div>

                <div className="uk-margin-top uk-flex uk-flex-right">
                    <button className="uk-button uk-button-default"
                            onClick={onClose}>Cancelar
                    </button>
                    <button className="uk-button uk-button-primary uk-margin-small-left"
                            onClick={onCloseCash}>Cerrar caja
                    </button>
                </div>
            </div>
            <div className="uk-modal-bg" onClick={onClose}></div>
        </div>
    );
}
