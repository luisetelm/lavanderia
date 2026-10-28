import React from 'react';
import DateCarousel from '../DateCarousel.jsx';
import {useDraftOrder} from '../../hooks/useDraftOrder.js';

// Bloque «Entrega» del TPV: fecha de entrega (con la carga de cada día) y
// observaciones del pedido.
export default function PosEntrega({token}) {
    const draft = useDraftOrder();

    return (
        <section className="uk-card uk-card-default pos-card pos-sec-entrega">
            <DateCarousel
                fechaLimite={draft.fechaLimite}
                setFechaLimite={(d) => draft.setFechaLimite(d)}
                token={token}
            />
            <div className="pos-field">
                <label htmlFor="pos-observaciones">Observaciones del pedido</label>
                <textarea
                    id="pos-observaciones"
                    className="uk-textarea"
                    rows="2"
                    placeholder="Instrucciones generales del pedido (ej: cliente recoge el sábado)..."
                    value={draft.observaciones}
                    onChange={(e) => draft.setObservaciones(e.target.value)}
                />
            </div>
        </section>
    );
}
