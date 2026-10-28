import React from 'react';
import {useDraftOrder} from '../../hooks/useDraftOrder.js';
import {formatEUR} from '../../utils/format.js';
import {esTelefonoValido} from '../../utils/telefono.js';
import {telefonoCliente} from '../../utils/pasosTPV.js';

// 'YYYY-MM-DD' en hora local (new Date('2026-11-05') sería medianoche UTC)
const fechaLarga = (s) => {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    const txt = new Date(y, m - 1, d).toLocaleDateString('es-ES', {weekday: 'long', day: 'numeric', month: 'long'});
    return txt.charAt(0).toUpperCase() + txt.slice(1);
};
const capitalizar = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Un bloque del resumen con su «Cambiar»
function Bloque({titulo, paso, falta, onIrA, children}) {
    return (
        <div className={`pos-rev-block ${falta ? 'is-missing' : ''}`}>
            <div className="pos-rev-head">
                <span className="pos-rev-title">{titulo}</span>
                <button type="button" className="uk-button uk-button-link pos-rev-edit" onClick={() => onIrA(paso)}>Cambiar</button>
            </div>
            <div className="pos-rev-body">{children}</div>
        </div>
    );
}

// Paso «Revisar» del TPV por pasos: el pedido entero de un vistazo antes de
// validarlo, con un «Cambiar» en cada bloque que lleva a su paso.
export default function PosRevisar({onIrA}) {
    const draft = useDraftOrder();
    const {cart, selectedUser, clientName, fechaLimite, observaciones, suplementoUrgencia, discount, totalConSuplemento} = draft;
    const telefono = telefonoCliente(draft);
    const telefonoOk = esTelefonoValido(telefono);

    return (
        <section className="uk-card uk-card-default pos-card pos-sec-revisar">
            <h4 className="pos-card-title">
                <span uk-icon="icon: check; ratio: 0.9"></span>
                Revisar el pedido
            </h4>

            <div className="pos-rev">
                <Bloque onIrA={onIrA} titulo="Cliente" paso="cliente" falta={!clientName || !telefonoOk}>
                    {clientName ? (
                        <>
                            <strong>{clientName}</strong>{selectedUser ? '' : ' (cliente nuevo)'}
                            {' · '}
                            {telefono
                                ? <span className={telefonoOk ? '' : 'pos-rev-warn'}>{telefono}{telefonoOk ? '' : ' (no es válido)'}</span>
                                : <span className="pos-rev-warn">sin teléfono</span>}
                        </>
                    ) : <span className="pos-rev-warn">Falta el cliente</span>}
                </Bloque>

                <Bloque onIrA={onIrA} titulo="Prendas" paso="prendas" falta={!cart.length}>
                    {cart.length ? (
                        <ul className="pos-rev-lines">
                            {cart.map(c => (
                                <li key={c.lineId}>
                                    <span>
                                        <strong>{c.quantity}×</strong> {c.name}
                                        {c.color && <span className="pos-rev-meta"> · {capitalizar(c.color)}</span>}
                                        {c.notes && <span className="pos-rev-meta"> · «{c.notes}»</span>}
                                    </span>
                                    <span className="pos-rev-price">{formatEUR(draft.getPriceForItem(c) * c.quantity)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : <span className="pos-rev-warn">Aún no hay prendas</span>}
                </Bloque>

                <Bloque onIrA={onIrA} titulo="Entrega" paso="entrega" falta={!fechaLimite}>
                    {fechaLimite ? <strong>{fechaLarga(fechaLimite)}</strong> : <span className="pos-rev-warn">Sin fecha de entrega</span>}
                    {suplementoUrgencia.adelantada && (
                        <div className="pos-rev-meta">
                            {suplementoUrgencia.aplicado
                                ? `Entrega adelantada: suplemento de urgencia del ${suplementoUrgencia.pct} % (${formatEUR(suplementoUrgencia.importe)})`
                                : 'Entrega adelantada, sin suplemento'}
                        </div>
                    )}
                </Bloque>

                <Bloque onIrA={onIrA} titulo="Observaciones" paso="entrega">
                    {observaciones ? observaciones : <span className="pos-rev-meta">Sin observaciones</span>}
                </Bloque>
            </div>

            <div className="pos-rev-total">
                {discount > 0 && <span className="pos-cart-dto">−{discount}% dto.</span>}
                <span>Total</span>
                <span className="pos-cart-total">{formatEUR(totalConSuplemento)}</span>
            </div>
        </section>
    );
}
