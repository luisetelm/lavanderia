import React, {useState} from 'react';
import {createProforma} from '../api.js';
import {formatEUR} from '../utils/format.js';

// Emite la factura proforma de un pedido: el presupuesto detallado que el cliente
// presenta ante un tercero (una aseguradora, el caso que la motiva: prendas de un
// incendio que paga el seguro).
//
// La proforma no es una factura. Va siempre a nombre del cliente —es él el
// obligado al pago, aunque el dinero lo ponga la aseguradora— y se puede borrar
// sin dejar rastro si no la aceptan. Aquí sólo se recogen los datos que no están
// en el pedido: ante quién se presenta, el expediente y hasta cuándo vale.
//
// Las condiciones (se factura el trabajo hecho aunque el resultado no sea
// satisfactorio, y aviso previo si aparece un vicio oculto) van impresas en el
// documento y no son opcionales: se enumeran aquí para que quien lo emite sepa
// qué está firmando el cliente. Ver docs/factura-proforma.md.
export default function ProformaModal({token, order, onDone, onClose}) {
    const enTreintaDias = () => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d.toISOString().slice(0, 10);
    };

    const [recipientName, setRecipientName] = useState('');
    const [recipientRef, setRecipientRef] = useState('');
    const [validUntil, setValidUntil] = useState(enTreintaDias());
    const [notes, setNotes] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');

    const cliente = order.client || {};
    const nombreCliente = cliente.denominacionsocial
        || `${cliente.firstName || ''} ${cliente.lastName || ''}`.trim()
        || '—';

    const lineasVivas = (order.lines || []).filter((l) => !l.voidedAt && !l.invoicedInId);
    const unidades = lineasVivas.reduce((s, l) => s + Number(l.quantity || 0), 0);
    const total = Number(order.total) || 0;
    const base = +(total / 1.21).toFixed(2);
    const iva = +(total - base).toFixed(2);

    const emitir = async () => {
        setError('');
        setGuardando(true);
        try {
            const p = await createProforma(token, {
                orderIds: [order.id],
                recipientName: recipientName.trim() || null,
                recipientRef: recipientRef.trim() || null,
                validUntil,
                notes: notes.trim() || null,
            });
            onDone(p);
        } catch (e) {
            setError(e.error || e.message || 'No se pudo emitir la proforma.');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120,
        }}>
            <div style={{
                background: '#fff', borderRadius: 8, width: 600, maxWidth: '95vw',
                maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            }}>
                <div style={{padding: '16px 20px', borderBottom: '1px solid #e5e7eb'}}>
                    <h4 style={{margin: 0}}>Factura proforma · pedido {order.orderNum}</h4>
                    <div style={{fontSize: '0.8rem', color: '#64748b'}}>
                        {nombreCliente} · {unidades} unidades · {formatEUR(total)} IVA incl.
                    </div>
                </div>

                <div style={{padding: 20, overflowY: 'auto', flex: 1}}>
                    <div style={{
                        border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 6,
                        padding: '10px 12px', fontSize: '0.8rem', color: '#1e40af', marginBottom: 18,
                    }}>
                        La proforma es un presupuesto, no una factura: no se contabiliza, no
                        consume número de la serie de facturas y se puede borrar si no la
                        aceptan. El pedido sigue pendiente de facturar.
                    </div>

                    <div style={{fontWeight: 600, marginBottom: 8}}>Ante quién se presenta</div>
                    <input
                        className="uk-input uk-form-small"
                        placeholder="Nombre de la aseguradora o del tercero (opcional)"
                        value={recipientName}
                        onChange={(e) => setRecipientName(e.target.value)}
                    />
                    <input
                        className="uk-input uk-form-small"
                        style={{marginTop: 8}}
                        placeholder="Nº de siniestro, póliza o expediente (opcional)"
                        value={recipientRef}
                        onChange={(e) => setRecipientRef(e.target.value)}
                    />
                    <div style={{fontSize: '0.75rem', color: '#64748b', marginTop: 6}}>
                        El documento se emite <strong>a nombre del cliente</strong>: esto sólo es
                        la mención que necesita el tercero para localizar el expediente. El
                        obligado al pago sigue siendo el cliente.
                    </div>

                    <div style={{fontWeight: 600, margin: '18px 0 8px'}}>Válida hasta</div>
                    <input
                        type="date"
                        className="uk-input uk-form-small"
                        style={{width: 180}}
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                    />
                    <div style={{fontSize: '0.75rem', color: '#64748b', marginTop: 6}}>
                        Pasado el plazo, las prendas se devuelven sin tratar o se presupuestan de
                        nuevo con la tarifa vigente. Piensa en el sitio que ocupan mientras el
                        tercero decide.
                    </div>

                    <div style={{fontWeight: 600, margin: '18px 0 8px'}}>Observaciones (salen en el documento)</div>
                    <textarea
                        className="uk-textarea uk-form-small"
                        rows={3}
                        placeholder="Ej.: prendas recuperadas del incendio del 18/09/2026 en el domicilio del asegurado."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />

                    <div style={{
                        marginTop: 18, borderTop: '1px solid #e5e7eb', paddingTop: 14,
                        fontSize: '0.78rem', color: '#475569',
                    }}>
                        <div style={{fontWeight: 600, color: '#334155', marginBottom: 6}}>
                            Condiciones que se imprimen en el documento
                        </div>
                        <ul className="uk-list" style={{margin: 0, fontSize: '0.78rem'}}>
                            <li>· Presupuesto sin valor fiscal; la factura se emite al acabar el trabajo.</li>
                            <li>· Recuento de {unidades} unidades: lo que no está en el detalle no está presupuestado.</li>
                            <li>· <strong>Se factura el trabajo realizado aunque el resultado no sea
                                plenamente satisfactorio</strong>, porque el tejido llega ya dañado.</li>
                            <li>· <strong>Si aparece un vicio oculto</strong> o cualquier cosa que cambie la
                                previsión de trabajo, se para esa prenda y <strong>se avisa al cliente</strong>
                                antes de seguir; para cobrar más hace falta una revisión aceptada.</li>
                            <li>· El obligado al pago es el cliente, pague quien pague.</li>
                        </ul>
                    </div>

                    {error && (
                        <div className="uk-alert uk-alert-danger" style={{marginTop: 14, fontSize: '0.85rem'}}>
                            {error}
                        </div>
                    )}
                </div>

                <div style={{padding: '14px 20px', borderTop: '1px solid #e5e7eb', background: '#f8fafc'}}>
                    <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: '0.85rem', color: '#475569', marginBottom: 10,
                    }}>
                        <span>Base {formatEUR(base)} · IVA {formatEUR(iva)}</span>
                        <strong style={{fontSize: '1.05rem', color: '#0f172a'}}>{formatEUR(total)}</strong>
                    </div>
                    <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                        <button className="uk-button uk-button-default uk-button-small"
                                onClick={onClose} disabled={guardando} type="button">
                            Cancelar
                        </button>
                        <button className="uk-button uk-button-primary uk-button-small"
                                onClick={emitir} disabled={guardando} type="button">
                            {guardando ? 'Emitiendo…' : 'Emitir proforma'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
