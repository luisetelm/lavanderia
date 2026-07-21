import React, {useState, useEffect, useCallback} from 'react';
import {fetchOrderHistory} from '../api.js';
import {formatEUR} from '../utils/format.js';

// Historial económico de un pedido y, sobre todo, el aviso de si queda algo
// pendiente de cobrar o devolver.
//
// El saldo no se guarda en ningún sitio: se calcula como (pagos - total del
// pedido). Así no puede quedar desincronizado si alguien ajusta el pedido, y
// es lo que le dice al cajero que tiene que devolver dinero al cliente.

const ETIQUETA = {
    cobro:         {texto: 'Cobro',         color: '#166534'},
    devolucion:    {texto: 'Devolución',    color: '#d32f2f'},
    factura:       {texto: 'Factura',       color: '#334155'},
    rectificativa: {texto: 'Rectificativa', color: '#d32f2f'},
    anulacion:     {texto: 'Línea anulada', color: '#b45309'},
};

const METODO = {
    cash: 'efectivo', card_pos: 'tarjeta', card: 'tarjeta',
    stripe: 'Stripe', transfer: 'transferencia',
};

export default function OrderHistory({token, orderId, refreshKey = 0}) {
    const [datos, setDatos] = useState(null);
    const [abierto, setAbierto] = useState(false);
    const [error, setError] = useState('');

    const cargar = useCallback(async () => {
        try {
            setDatos(await fetchOrderHistory(token, orderId));
        } catch (e) {
            setError(e.error || 'No se pudo cargar el historial.');
        }
    }, [token, orderId]);

    useEffect(() => { cargar(); }, [cargar, refreshKey]);

    if (error) return <div style={{fontSize: 11, color: '#d32f2f'}}>{error}</div>;
    if (!datos) return null;

    const {saldo, pendiente, eventos = []} = datos;
    // Sin movimientos que contar y sin nada pendiente, no merece ocupar espacio.
    if (!pendiente && eventos.length <= 2) return null;

    return (
        <div style={{marginTop: 10}}>
            {pendiente && (
                <div style={{
                    padding: '8px 10px',
                    borderRadius: 4,
                    marginBottom: 8,
                    background: pendiente === 'devolver' ? '#fee2e2' : '#fef3c7',
                    color: pendiente === 'devolver' ? '#991b1b' : '#92400e',
                    fontWeight: 600,
                    fontSize: 13,
                }}>
                    {pendiente === 'devolver'
                        ? `Pendiente de devolver al cliente: ${formatEUR(Math.abs(saldo))}`
                        : `Pendiente de cobrar: ${formatEUR(Math.abs(saldo))}`}
                </div>
            )}

            <button
                className="uk-button uk-button-text"
                style={{fontSize: 11}}
                onClick={() => setAbierto((v) => !v)}
            >
                {abierto ? '▾' : '▸'} Historial del pedido ({eventos.length})
            </button>

            {abierto && (
                <div style={{marginTop: 6, fontSize: 11}}>
                    {eventos.map((e, i) => {
                        const meta = ETIQUETA[e.tipo] || {texto: e.tipo, color: '#334155'};
                        return (
                            <div key={i} style={{
                                display: 'flex', gap: 8, padding: '4px 0',
                                borderBottom: '1px solid #f1f5f9',
                            }}>
                                <span style={{color: '#94a3b8', whiteSpace: 'nowrap'}}>
                                    {new Date(e.fecha).toLocaleDateString('es-ES', {day: '2-digit', month: '2-digit'})}
                                </span>
                                <span style={{color: meta.color, fontWeight: 600, minWidth: 92}}>
                                    {meta.texto}
                                </span>
                                <span style={{flex: 1, color: '#475569'}}>
                                    {e.numero || e.concepto || ''}
                                    {e.metodo ? ` (${METODO[e.metodo] || e.metodo})` : ''}
                                    {e.rectificaA ? ` · rectifica ${e.rectificaA}` : ''}
                                    {e.nota ? <div style={{color: '#94a3b8'}}>{e.nota}</div> : null}
                                    {e.usuario ? <span style={{color: '#94a3b8'}}> · {e.usuario}</span> : null}
                                </span>
                                <span style={{
                                    whiteSpace: 'nowrap',
                                    color: Number(e.importe) < 0 ? '#d32f2f' : '#334155',
                                }}>
                                    {formatEUR(Number(e.importe) || 0)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
