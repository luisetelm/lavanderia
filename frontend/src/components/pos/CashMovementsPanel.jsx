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

export default function CashMovementsPanel({
    show,
    onClose,
    cashErr,
    unclosedMoves,
    editingId,
    editingForm,
    setEditingForm,
    onStartEdit,
    onSaveEdit,
    onCancelEdit,
    onRemove,
}) {
    if (!show) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: '420px',
            background: '#fff',
            boxShadow: '-2px 0 8px rgba(0,0,0,.2)',
            zIndex: 1000,
            padding: '16px',
            overflow: 'auto'
        }}>
            <div className="uk-flex uk-flex-between uk-flex-middle">
                <h3 className="uk-margin-remove">Movimientos de caja</h3>
                <button className="uk-button uk-button-text" onClick={onClose}>Cerrar
                    {'\u2715'}
                </button>
            </div>
            {cashErr && <div className="uk-alert-danger" uk-alert="true"><p>{cashErr}</p></div>}

            <ul className="uk-list uk-list-divider">
                {(unclosedMoves || []).map(m => (<li key={m.id}>
                    {console.log(m)}
                    {editingId === m.id ? (<div className="uk-grid-small" uk-grid="true">
                        <div className="uk-width-1-2">
                            <label className="uk-form-label">Tipo</label>
                            <select className="uk-select" value={editingForm.type}
                                    onChange={(e) => setEditingForm({
                                        ...editingForm, type: e.target.value
                                    })}>
                                <option value="deposit">Ingreso</option>
                                <option value="withdrawal">Retirada</option>
                                <option value="refund_cash_out">Devolucion</option>
                                <option value="sale_cash_in">Venta efectivo</option>
                            </select>
                        </div>
                        <div className="uk-width-1-2">
                            <label className="uk-form-label">Importe</label>
                            <input className="uk-input" type="number" step="0.01"
                                   value={editingForm.amount}
                                   onChange={(e) => setEditingForm({
                                       ...editingForm, amount: e.target.value
                                   })}/>
                        </div>
                        <div className="uk-width-1-2">
                            <label className="uk-form-label">Persona</label>
                            <input className="uk-input" type="text" value={editingForm.person}
                                   onChange={(e) => setEditingForm({
                                       ...editingForm, person: e.target.value
                                   })}/>
                        </div>
                        <div className="uk-width-1-1">
                            <label className="uk-form-label">Nota</label>
                            <input className="uk-input" type="text" value={editingForm.note}
                                   onChange={(e) => setEditingForm({
                                       ...editingForm, note: e.target.value
                                   })}/>
                        </div>
                        <div className="uk-width-1-1 uk-text-right">
                            <button className="uk-button uk-button-default"
                                    onClick={onCancelEdit}>Cancelar
                            </button>
                            <button className="uk-button uk-button-primary uk-margin-small-left"
                                    onClick={onSaveEdit}>Guardar
                            </button>
                        </div>
                    </div>) : (<div className="uk-flex uk-flex-between uk-flex-middle">
                        <div>
                            <div className="uk-text-bold">{typeLabel[m.type]} <span
                                className="uk-text-muted">#{m.id}</span></div>
                            <div
                                className="uk-text-small uk-text-muted">{m.note || 'Sin nota'}{m.person ? ` \u2022 ${m.person}` : ''}</div>
                        </div>
                        <div>
                                        <span
                                            className="uk-margin-small-right">{signed(m.type, Number(m.amount)).toFixed(2)} €</span>
                            <button className="uk-button uk-button-small"
                                    onClick={() => onStartEdit(m)} uk-icon="pencil">Editar
                            </button>
                            <button
                                className="uk-button uk-button-danger uk-button-small uk-margin-small-left"
                                onClick={() => onRemove(m.id)}>Borrar
                            </button>
                        </div>
                    </div>)}
                </li>))}
                {(!unclosedMoves || !unclosedMoves.length) && <li>No hay movimientos pendientes.</li>}
            </ul>
        </div>
    );
}
