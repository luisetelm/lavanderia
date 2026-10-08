import React, {useState} from 'react';
import {ESTADOS_LOTE} from '../utils/pedidos.js';

/**
 * Confirmación de un cambio de estado en lote.
 *
 * Props:
 *  - pedidos: pedidos seleccionados (id, orderNum, status, paid, total)
 *  - status: estado de destino
 *  - cobroAplazado: el cliente puede llevarse pedidos sin cobrar (gran cliente / factura mensual)
 *  - clientChannel: canal preferido del cliente ('sms' | 'whatsapp' | 'none' | null)
 *  - onConfirm(sendSMS): false | true (SMS) | 'whatsapp'
 *  - onCancel()
 */
export default function BulkStatusModal({pedidos, status, cobroAplazado, clientChannel, onConfirm, onCancel}) {
    const [aviso, setAviso] = useState(() => {
        if (clientChannel === 'none') return false;
        if (clientChannel === 'whatsapp') return 'whatsapp';
        if (clientChannel === 'sms') return true;
        return false;
    });
    if (!status || !pedidos?.length) return null;

    const etiqueta = ESTADOS_LOTE.find(e => e.value === status)?.label || status;
    const notifica = status === 'ready' || status === 'collected';
    const yaEstaban = pedidos.filter(p => p.status === status).length;
    const sinCobrar = status === 'collected' && !cobroAplazado
        ? pedidos.filter(p => p.status !== status && !p.paid && Number(p.total) > 0).length : 0;
    const cobrados = status === 'cancelled'
        ? pedidos.filter(p => p.status !== status && p.paid && Number(p.total) > 0).length : 0;
    const cambiaran = pedidos.length - yaEstaban - sinCobrar - cobrados;

    const Opcion = ({valor, texto}) => (
        <label style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer'}}>
            <input type="radio" className="uk-radio" checked={aviso === valor} onChange={() => setAviso(valor)}/>
            {texto}
        </label>
    );

    return (
        <div className="uk-modal uk-open" style={{display: 'block'}}>
            <div className="uk-modal-dialog uk-modal-body" style={{maxWidth: 460}}>
                <h2 className="uk-modal-title" style={{fontSize: '1.05rem', marginBottom: 4}}>
                    Cambiar {pedidos.length} pedido{pedidos.length !== 1 ? 's' : ''} a «{etiqueta}»
                </h2>
                <p style={{fontSize: '0.82rem', color: '#64748b', margin: '0 0 12px'}}>
                    {cambiaran > 0
                        ? `Cambiarán ${cambiaran} pedido${cambiaran !== 1 ? 's' : ''}.`
                        : 'Ningún pedido de la selección puede cambiar.'}
                    {status === 'cancelled' && cambiaran > 0 && ' Al cancelar, el importe de cada pedido pasa a 0 €.'}
                </p>

                {(yaEstaban > 0 || sinCobrar > 0 || cobrados > 0) && (
                    <ul style={{fontSize: '0.78rem', color: '#b45309', margin: '0 0 12px', paddingLeft: 18}}>
                        {yaEstaban > 0 && <li>{yaEstaban} ya está{yaEstaban !== 1 ? 'n' : ''} en ese estado y se omitirá{yaEstaban !== 1 ? 'n' : ''}.</li>}
                        {sinCobrar > 0 && <li>{sinCobrar} sin cobrar se omitirá{sinCobrar !== 1 ? 'n' : ''}: cobra primero o entrégalos uno a uno.</li>}
                        {cobrados > 0 && <li>{cobrados} cobrado{cobrados !== 1 ? 's' : ''} se omitirá{cobrados !== 1 ? 'n' : ''}: un pedido cobrado no se cancela en lote.</li>}
                    </ul>
                )}

                {notifica && cambiaran > 0 && (
                    <div style={{display: 'flex', flexDirection: 'column', gap: 6, margin: '0 0 16px', padding: '10px 12px', background: '#f8fafc', borderRadius: 6}}>
                        <div style={{fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase'}}>Avisar al cliente</div>
                        <Opcion valor={false} texto="No avisar"/>
                        <Opcion valor={true} texto={`Un SMS por pedido (${cambiaran})`}/>
                        <Opcion valor="whatsapp" texto={`Un WhatsApp por pedido (${cambiaran})`}/>
                        {clientChannel === 'none' && (
                            <p style={{fontSize: '0.75rem', color: '#f59e0b', margin: 0, fontStyle: 'italic'}}>Este cliente ha pedido no recibir avisos.</p>
                        )}
                    </div>
                )}

                <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                    <button type="button" className="uk-button uk-button-default" onClick={onCancel}>Cancelar</button>
                    <button type="button" className={`uk-button ${status === 'cancelled' ? 'uk-button-danger' : 'uk-button-primary'}`}
                            disabled={cambiaran <= 0} onClick={() => onConfirm(notifica ? aviso : false)}>
                        Cambiar {cambiaran > 0 ? cambiaran : ''}
                    </button>
                </div>
            </div>
        </div>
    );
}
