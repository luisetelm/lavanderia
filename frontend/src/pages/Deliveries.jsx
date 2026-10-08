import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {fetchOrders, updateOrder} from '../api.js';
import StatusChangeModal from '../components/StatusChangeModal.jsx';
import {lineasActivas} from '../utils/lineas.js';
import {formatEUR} from '../utils/format.js';
import {formatDate} from '../utils/dates.js';
import {avisar} from '../utils/dialogo.js';
import {printInternalLabel} from '../utils/printUtils.js';
import {getPrintSettings} from '../utils/printSettings.js';
import {rutaCliente, rutaPedido} from '../utils/rutas.js';
import {etiquetaCobro, pagaAFinDeMes, sePuedeRecoger} from '../utils/pedidos.js';

// Vista de Entregas: lo que hay que entregar un día, pensada para dejarla
// abierta en la tablet de la lavandería. Un día por pantalla (va en la URL),
// los atrasados siempre arriba, y los dos gestos del día (marcar listo y
// entregar) con botones grandes.

const ACTIVOS = 'pending,in_progress,ready'; // lo que aún está por entregar
const PAGE_MAX = 100;

const fromYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = fromYmd(s); d.setDate(d.getDate() + n); return formatDate(d); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDia = (s, opts) => fromYmd(s).toLocaleDateString('es-ES', opts);

const GRUPOS = [
    {key: 'pending',     label: 'Pendientes de hacer', color: '#b45309', bg: '#fef3c7'},
    {key: 'in_progress', label: 'En proceso',          color: '#1e40af', bg: '#dbeafe'},
    {key: 'ready',       label: 'Listos para entregar', color: '#166534', bg: '#dcfce7'},
    {key: 'collected',   label: 'Entregados',          color: '#374151', bg: '#e5e7eb'},
];

const seguimiento = (o) => {
    const pasos = lineasActivas(o.lines).flatMap(l => l.steps || []);
    return {hay: pasos.length > 0, todosHechos: pasos.length === 0 || pasos.every(s => s.status === 'done')};
};

export default function Deliveries({token}) {
    const hoy = formatDate(new Date());
    const [params, setParams] = useSearchParams();
    const diaParam = params.get('dia');
    const dia = diaParam && /^\d{4}-\d{2}-\d{2}$/.test(diaParam) ? diaParam : hoy;
    const esHoy = dia === hoy;

    const [pedidos, setPedidos] = useState([]);
    const [atrasados, setAtrasados] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filtro, setFiltro] = useState('');
    const [verAtrasados, setVerAtrasados] = useState(true);
    const [modal, setModal] = useState(null); // { order, action }
    const [ocupado, setOcupado] = useState(null); // id del pedido que se está cambiando
    const pickerRef = useRef(null);

    const setDia = (d) => setParams(d === hoy ? {} : {dia: d});

    const cargar = useCallback(async (silencioso = false) => {
        if (!silencioso) setLoading(true);
        setError('');
        try {
            const [delDia, vencidos] = await Promise.all([
                fetchOrders(token, {deliveryFrom: dia, deliveryTo: dia, sortBy: 'fechaLimite', sortOrder: 'asc', page: 0, size: PAGE_MAX}),
                // Atrasados: por entregar y con fecha anterior a HOY (no al día que se mira)
                fetchOrders(token, {deliveryTo: addDays(hoy, -1), status: ACTIVOS, sortBy: 'fechaLimite', sortOrder: 'asc', page: 0, size: PAGE_MAX}),
            ]);
            setPedidos((delDia?.data || []).filter(o => o.status !== 'cancelled'));
            setAtrasados(vencidos?.data || []);
        } catch (e) {
            setError(e.error || 'No se pudieron cargar las entregas');
        } finally {
            setLoading(false);
        }
    }, [token, dia, hoy]);

    useEffect(() => { cargar(); }, [cargar]);

    // La tablet se queda con esta pantalla abierta: se refresca sola.
    useEffect(() => {
        const t = setInterval(() => cargar(true), 60000);
        return () => clearInterval(t);
    }, [cargar]);

    const coincide = (o) => {
        const q = filtro.trim().toLowerCase();
        if (!q) return true;
        const nombre = o.client ? `${o.client.firstName || ''} ${o.client.lastName || ''}` : 'cliente rápido';
        return (o.orderNum || '').toLowerCase().includes(q) || nombre.toLowerCase().includes(q) || (o.client?.phone || '').includes(q);
    };

    const porGrupo = useMemo(() => {
        const g = Object.fromEntries(GRUPOS.map(x => [x.key, []]));
        pedidos.filter(coincide).forEach(o => { (g[o.status] || (g[o.status] = [])).push(o); });
        return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pedidos, filtro]);
    const atrasadosVisibles = atrasados.filter(coincide);
    const porEntregar = pedidos.filter(o => o.status !== 'collected').length;
    const totalPrendas = pedidos.reduce((s, o) => s + lineasActivas(o.lines).reduce((a, l) => a + (Number(l.quantity) || 0), 0), 0);

    const cambiarEstado = async (sendSMS) => {
        const {order, action} = modal;
        setModal(null);
        setOcupado(order.id);
        try {
            await updateOrder(token, order.id, {status: action, sendSMS});
            avisar(action === 'ready' ? `${order.orderNum} marcado como listo` : `${order.orderNum} entregado`, 'success', 2500);
            if (action === 'ready' && getPrintSettings().onReady) {
                try { await printInternalLabel(order, {token}); }
                catch (e) { console.warn('Impresión automática de etiqueta interna falló:', e); }
            }
            await cargar(true);
        } catch (e) {
            avisar(e.error || 'No se pudo cambiar el estado', 'danger');
        } finally {
            setOcupado(null);
        }
    };

    const abrirPicker = () => pickerRef.current?.showPicker ? pickerRef.current.showPicker() : pickerRef.current?.click();

    const Fila = ({o, mostrarFecha = false}) => {
        const {hay, todosHechos} = seguimiento(o);
        const sinCobro = Number(o.total) <= 0;
        const lineas = lineasActivas(o.lines);
        const prendas = lineas.reduce((a, l) => a + (Number(l.quantity) || 0), 0);
        const resumen = lineas.map(l => `${l.quantity}× ${l.product?.name || l.productName || `#${l.productId}`}`).join(', ');
        const nombre = o.client ? `${o.client.firstName || ''} ${o.client.lastName || ''}`.trim() : '';
        const trabajando = ocupado === o.id;
        const puedeListo = o.status !== 'ready' && o.status !== 'collected' && todosHechos;
        const puedeEntregar = o.status === 'ready' && sePuedeRecoger(o);
        return (
            <div className="ent-fila">
                <div className="ent-info">
                    <div className="ent-titulo">
                        {o.client
                            ? <Link to={rutaCliente(o.client)} className="ent-cliente" title="Ver la ficha del cliente">{nombre || 'Cliente'}</Link>
                            : <span className="ent-cliente">Cliente rápido</span>}
                        <Link to={rutaPedido(o)} className="ent-num" title="Abrir el pedido">{o.orderNum}</Link>
                        {mostrarFecha && o.fechaLimite && (
                            <span className="ent-fecha">{new Date(o.fechaLimite).toLocaleDateString('es-ES', {weekday: 'short', day: 'numeric', month: 'short'})}</span>
                        )}
                    </div>
                    <div className="ent-prendas" title={resumen}>{prendas} prenda{prendas !== 1 ? 's' : ''} · {resumen}</div>
                    <div className="ent-meta">
                        <span className={sePuedeRecoger(o) ? 'ok' : 'warn'}>{etiquetaCobro(o)}{!o.paid && !sinCobro ? ` · ${formatEUR(o.total)}` : ''}</span>
                        {hay && !todosHechos && <span className="warn"> · Tracking en curso</span>}
                        {o.client?.phone && <span> · {o.client.phone}</span>}
                        {o.observaciones && <span className="nota"> · {o.observaciones}</span>}
                    </div>
                </div>
                <div className="ent-acciones">
                    {o.status !== 'ready' && o.status !== 'collected' && (
                        <button type="button" className="uk-button uk-button-primary" disabled={!puedeListo || trabajando}
                                title={!todosHechos ? 'Completa el tracking de todas las prendas primero' : 'El pedido está listo para que lo recojan'}
                                onClick={() => setModal({order: o, action: 'ready'})}>
                            {trabajando ? <span uk-spinner="ratio: 0.6"></span> : <><span uk-icon="icon: check; ratio: 0.9"></span> Listo</>}
                        </button>
                    )}
                    {o.status === 'ready' && (
                        <button type="button" className="uk-button uk-button-secondary" disabled={!puedeEntregar || trabajando}
                                title={!puedeEntregar ? 'Cobra el pedido antes de entregarlo' : 'El cliente se lo lleva'}
                                onClick={() => setModal({order: o, action: 'collected'})}>
                            {trabajando ? <span uk-spinner="ratio: 0.6"></span> : <><span uk-icon="icon: sign-out; ratio: 0.9"></span> Entregar</>}
                        </button>
                    )}
                    {o.status === 'ready' && !o.paid && !sinCobro && !pagaAFinDeMes(o) && (
                        <Link to={rutaPedido(o)} className="uk-button uk-button-default" title="Abrir el pedido para cobrarlo">Cobrar</Link>
                    )}
                    {o.status === 'collected' && <span className="ent-hecho"><span uk-icon="icon: check; ratio: 0.8"></span> Entregado</span>}
                </div>
            </div>
        );
    };

    return (
        <div className="ent">
            <style>{`
                .ent-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
                .ent-nav { display: flex; align-items: center; gap: 6px; }
                .ent-nav .uk-button { min-height: 40px; }
                .ent-dia { font-size: 1.15rem; font-weight: 700; margin: 0 6px; white-space: nowrap; }
                .ent-resumen { color: #64748b; font-size: 0.85rem; }
                .ent-buscar { min-width: 220px; }
                .ent-grupo { margin-bottom: 18px; }
                .ent-grupo-tit { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 0.85rem; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 8px; }
                .ent-grupo-tit .n { display: inline-flex; min-width: 24px; height: 24px; padding: 0 7px; border-radius: 12px; align-items: center; justify-content: center; font-size: 0.8rem; }
                .ent-fila { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 8px; }
                .ent-info { flex: 1 1 280px; min-width: 0; }
                .ent-titulo { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
                .ent-cliente { font-weight: 700; font-size: 1.05rem; color: #1e293b; }
                .ent-num { font-family: monospace; font-size: 0.8rem; color: #64748b; background: #f1f5f9; padding: 1px 8px; border-radius: 6px; }
                .ent-fecha { font-size: 0.75rem; font-weight: 700; color: #991b1b; background: #fee2e2; padding: 1px 8px; border-radius: 6px; }
                .ent-prendas { font-size: 0.85rem; color: #334155; margin-top: 2px; }
                .ent-meta { font-size: 0.75rem; color: #94a3b8; margin-top: 2px; }
                .ent-meta .ok { color: #166534; font-weight: 600; } .ent-meta .warn { color: #b45309; font-weight: 600; } .ent-meta .nota { color: #64748b; font-style: italic; }
                .ent-acciones { display: flex; gap: 8px; align-items: center; }
                .ent-acciones .uk-button { min-height: 44px; min-width: 120px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
                .ent-hecho { color: #166534; font-weight: 600; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 4px; }
                .ent-atrasados { border: 1px solid #fecaca; background: #fff7f7; border-radius: 12px; padding: 12px 14px 4px; margin-bottom: 18px; }
                .ent-atrasados .ent-grupo-tit { color: #991b1b; cursor: pointer; user-select: none; }
                .ent-vacio { color: #94a3b8; text-align: center; padding: 30px 10px; border: 1px dashed #e2e8f0; border-radius: 10px; }
                @media (max-width: 640px) { .ent-acciones { width: 100%; } .ent-acciones .uk-button { flex: 1; } }
            `}</style>

            <div className="ent-head">
                <div>
                    <h2 style={{margin: 0, fontSize: '1.3rem', fontWeight: 700}}>Entregas</h2>
                    <div className="ent-resumen">
                        {loading ? 'Cargando…' : `${porEntregar} por entregar · ${pedidos.length - porEntregar} entregado${pedidos.length - porEntregar !== 1 ? 's' : ''} · ${totalPrendas} prenda${totalPrendas !== 1 ? 's' : ''}`}
                    </div>
                </div>
                <div className="ent-nav">
                    <button type="button" className="uk-button uk-button-default uk-button-small" onClick={() => setDia(hoy)} disabled={esHoy}>Hoy</button>
                    <button type="button" className="uk-button uk-button-default uk-button-small" onClick={() => setDia(addDays(dia, -1))} aria-label="Día anterior">
                        <span uk-icon="icon: chevron-left"></span>
                    </button>
                    <span className="ent-dia">{cap(fmtDia(dia, {weekday: 'long', day: 'numeric', month: 'long'}))}{esHoy ? '' : ''}</span>
                    <button type="button" className="uk-button uk-button-default uk-button-small" onClick={() => setDia(addDays(dia, 1))} aria-label="Día siguiente">
                        <span uk-icon="icon: chevron-right"></span>
                    </button>
                    <button type="button" className="uk-button uk-button-default uk-button-small" onClick={abrirPicker} title="Elegir otro día">
                        <span uk-icon="icon: calendar"></span>
                    </button>
                    <input ref={pickerRef} type="date" value={dia} onChange={e => e.target.value && setDia(e.target.value)}
                           style={{position: 'absolute', opacity: 0, width: 0, height: 0}} tabIndex={-1} aria-hidden="true"/>
                </div>
                <form className="uk-search uk-search-default ent-buscar" onSubmit={e => e.preventDefault()}>
                    <input type="search" className="uk-search-input" placeholder="Cliente, pedido o teléfono…" value={filtro} onChange={e => setFiltro(e.target.value)}/>
                </form>
            </div>

            {error && <div className="uk-alert-danger" uk-alert="true"><p>{error}</p></div>}

            {atrasadosVisibles.length > 0 && (
                <div className="ent-atrasados">
                    <div className="ent-grupo-tit" onClick={() => setVerAtrasados(v => !v)}>
                        <span className="n" style={{background: '#fee2e2', color: '#991b1b'}}>{atrasadosVisibles.length}</span>
                        Atrasados · deberían haberse entregado
                        <span uk-icon={`icon: chevron-${verAtrasados ? 'up' : 'down'}; ratio: 0.8`} style={{marginLeft: 'auto'}}></span>
                    </div>
                    {verAtrasados && atrasadosVisibles.map(o => <Fila key={o.id} o={o} mostrarFecha/>)}
                </div>
            )}

            {loading && pedidos.length === 0 && (
                <div className="uk-text-center uk-padding"><div uk-spinner="ratio: 1"></div></div>
            )}

            {!loading && pedidos.length === 0 && (
                <div className="ent-vacio">No hay pedidos con entrega {esHoy ? 'hoy' : `el ${fmtDia(dia, {day: 'numeric', month: 'long'})}`}.</div>
            )}

            {GRUPOS.map(g => porGrupo[g.key]?.length > 0 && (
                <div key={g.key} className="ent-grupo">
                    <div className="ent-grupo-tit" style={{color: g.color}}>
                        <span className="n" style={{background: g.bg, color: g.color}}>{porGrupo[g.key].length}</span>{g.label}
                    </div>
                    {porGrupo[g.key].map(o => <Fila key={o.id} o={o}/>)}
                </div>
            ))}

            {modal && (
                <StatusChangeModal
                    action={modal.action}
                    clientChannel={modal.order?.client?.notifyChannel || null}
                    onConfirm={cambiarEstado}
                    onCancel={() => setModal(null)}
                />
            )}
        </div>
    );
}
