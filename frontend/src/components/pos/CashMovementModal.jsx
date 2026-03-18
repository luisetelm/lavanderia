import React from 'react';

export default function CashMovementModal({
    show,
    onClose,
    cashErr,
    movementForm,
    setMovementForm,
    onSave,
    onOpenUserSelector,
}) {
    if (!show) return null;

    return (
        <div className="uk-modal uk-open" style={{display: 'block'}}>
            <div className="uk-modal-dialog uk-modal-body">
                <h3>Nuevo movimiento de caja</h3>
                {cashErr && <div className="uk-alert-danger" uk-alert="true"><p>{cashErr}</p></div>}

                <div className="uk-grid-small" uk-grid="true">
                    <div className="uk-width-1-2">
                        <label className="uk-form-label">Tipo</label>
                        <select className="uk-select" value={movementForm.type}
                                onChange={(e) => setMovementForm({...movementForm, type: e.target.value})}>
                            <option value="deposit">Entrada de dinero</option>
                            <option value="withdrawal">Retirada de dinero</option>
                        </select>
                    </div>
                    <div className="uk-width-1-2">
                        <label className="uk-form-label">Importe</label>
                        <input className="uk-input" type="number" step="0.01" value={movementForm.amount}
                               onChange={(e) => setMovementForm({...movementForm, amount: e.target.value})}/>
                    </div>
                    <div className="uk-width-1-2">
                        <label className="uk-form-label">Concepto</label>
                        <input className="uk-input" type="text" value={movementForm.concept}
                               onChange={(e) => setMovementForm({...movementForm, concept: e.target.value})}/>
                    </div>
                    <div className="uk-width-1-2">
                        <label className="uk-form-label">Persona</label>
                        <div className="uk-flex uk-flex-middle">
                            <input className="uk-input" type="text" value={movementForm.person}
                                   onChange={(e) => setMovementForm({
                                       ...movementForm, person: e.target.value
                                   })}/>
                            <button
                                className="uk-button uk-button-default uk-button-small uk-margin-small-left"
                                onClick={onOpenUserSelector}
                                type="button"
                            >
                                <span uk-icon="user"></span>
                            </button>
                        </div>
                    </div>
                    <div className="uk-width-1-1">
                        <label className="uk-form-label">Descripcion (opcional)</label>
                        <textarea className="uk-textarea" rows="2" value={movementForm.note}
                                  onChange={(e) => setMovementForm({...movementForm, note: e.target.value})}/>
                    </div>
                </div>

                <div className="uk-margin-top uk-flex uk-flex-right">
                    <button className="uk-button uk-button-default"
                            onClick={onClose}>Cancelar
                    </button>
                    <button className="uk-button uk-button-primary uk-margin-small-left"
                            onClick={onSave}>Guardar
                    </button>
                </div>
            </div>
            <div className="uk-modal-bg" onClick={onClose}></div>
        </div>
    );
}
