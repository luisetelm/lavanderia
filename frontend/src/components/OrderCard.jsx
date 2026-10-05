import React from 'react';
import {Link} from 'react-router-dom';
import {formatEUR} from '../utils/format.js';
import {lineasActivas} from '../utils/lineas.js';
import {rutaCliente, rutaPedido} from '../utils/rutas.js';

const STATUS_META = {
    pending:     {label: 'Pendiente', bg: '#fef3c7', color: '#92400e'},
    in_progress: {label: 'En proceso', bg: '#dbeafe', color: '#1e40af'},
    ready:       {label: 'Listo',     bg: '#dcfce7', color: '#166534'},
    collected:   {label: 'Recogido',  bg: '#e5e7eb', color: '#374151'},
    cancelled:   {label: 'Cancelado', bg: '#fee2e2', color: '#991b1b'},
};

const fmtFecha = (d) => d ? new Date(d).toLocaleDateString('es-ES', {day: 'numeric', month: 'short'}) : '—';

// Tarjeta resumida de un pedido para las listas. Lo que hace falta para
// reconocerlo y decidir si abrirlo: quién, qué número, en qué estado, cuándo
// se entrega y si está cobrado. Todo lo demás está en la página del pedido.
export default function OrderCard({order, workerName = null}) {
    const o = order;
    const st = STATUS_META[o.status] || {label: o.status, bg: '#e5e7eb', color: '#374151'};
    const activo = !['collected', 'cancelled'].includes(o.status);
    const atrasado = activo && o.fechaLimite && new Date(o.fechaLimite) < new Date(new Date().toDateString());
    const hoy = activo && o.fechaLimite && new Date(o.fechaLimite).toDateString() === new Date().toDateString();
    const lineas = lineasActivas(o.lines || []);
    const prendas = lineas.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    const resumen = lineas.map(l => `${l.quantity}× ${l.product?.name || l.productName || `#${l.productId}`}`).join(', ');
    const nombre = o.client ? `${o.client.firstName || ''} ${o.client.lastName || ''}`.trim() : '';
    const sinCobro = Number(o.total) <= 0;

    return (
        <div className="uk-card uk-card-default uk-card-small uk-card-body"
             style={{display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px',
                     borderLeft: `4px solid ${atrasado ? '#dc2626' : hoy ? '#f59e0b' : st.color}`}}>
            <div style={{flex: '1 1 260px', minWidth: 0}}>
                <div style={{display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap'}}>
                    {o.client ? (
                        <Link to={rutaCliente(o.client)} style={{fontWeight: 700, color: '#1e293b', fontSize: '1rem'}}
                              title="Ver la ficha del cliente">{nombre || 'Cliente'}</Link>
                    ) : (
                        <span style={{fontWeight: 700, fontSize: '1rem'}}>Cliente rápido</span>
                    )}
                    <Link to={rutaPedido(o)} style={{fontFamily: 'monospace', fontSize: '0.8rem', color: '#64748b',
                                                     background: '#f1f5f9', padding: '1px 8px', borderRadius: 6}}
                          title="Abrir el pedido">{o.orderNum}</Link>
                    <span style={{background: st.bg, color: st.color, fontWeight: 600, padding: '1px 8px', borderRadius: 10, fontSize: '0.7rem'}}>
                        {st.label}
                    </span>
                    {atrasado && (
                        <span style={{background: '#fee2e2', color: '#991b1b', fontWeight: 700, padding: '1px 8px', borderRadius: 6,
                                      fontSize: '0.65rem', textTransform: 'uppercase'}}>Atrasado</span>
                    )}
                    {hoy && !atrasado && (
                        <span style={{background: '#fef3c7', color: '#92400e', fontWeight: 700, padding: '1px 8px', borderRadius: 6,
                                      fontSize: '0.65rem', textTransform: 'uppercase'}}>Hoy</span>
                    )}
                </div>
                <div style={{fontSize: '0.8rem', color: '#475569', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}
                     title={resumen}>
                    {prendas} prenda{prendas !== 1 ? 's' : ''}{resumen ? ` · ${resumen}` : ''}
                </div>
                <div style={{fontSize: '0.75rem', color: '#94a3b8', marginTop: 2}}>
                    Creado {fmtFecha(o.createdAt)} · Entrega <strong style={{color: atrasado ? '#dc2626' : '#475569'}}>{fmtFecha(o.fechaLimite)}</strong>
                    {workerName && <> · {workerName}</>}
                    {o.client?.phone && <> · {o.client.phone}</>}
                </div>
            </div>

            <div style={{textAlign: 'right', minWidth: 90}}>
                <div style={{fontWeight: 700, fontSize: '1.05rem'}}>{formatEUR(o.total)}</div>
                <div style={{fontSize: '0.7rem', fontWeight: 600, color: o.paid || sinCobro ? '#166534' : '#b45309'}}>
                    {o.paid ? 'Pagado' : sinCobro ? 'Sin cobro' : 'Pendiente de pago'}
                </div>
            </div>

            <Link to={rutaPedido(o)} className="uk-button uk-button-primary uk-button-small" style={{whiteSpace: 'nowrap'}}>
                Abrir
            </Link>
        </div>
    );
}
