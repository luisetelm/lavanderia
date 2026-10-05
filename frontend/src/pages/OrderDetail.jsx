import React, {useEffect, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {fetchOrder, fetchOrderPortalLink} from '../api.js';
import PaymentSection from '../components/PaymentSection.jsx';
import {useDraftOrder} from '../hooks/useDraftOrder.js';
import {avisar} from '../utils/dialogo.js';
import {rutaCliente} from '../utils/rutas.js';

// Página de un pedido (/pedidos/:id). La tarjeta completa del pedido (cobro,
// estado, líneas, tracking, historial, facturas) es PaymentSection, la misma
// que se usaba en la lista de Tareas; aquí se le pone encima el contexto que
// faltaba: de dónde se viene, quién es el cliente y qué más se puede hacer con él.
export default function OrderDetail({token}) {
    const {id} = useParams();
    const navigate = useNavigate();
    const draft = useDraftOrder();
    const [order, setOrder] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [portalBusy, setPortalBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        setOrder(null);
        fetchOrder(token, id)
            .then(o => { if (!cancelled) setOrder(o); })
            .catch(e => { if (!cancelled) setError(e.status === 404 ? 'Este pedido no existe.' : (e.error || 'No se pudo cargar el pedido.')); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [token, id]);

    useEffect(() => {
        if (order?.orderNum) document.title = `${order.orderNum} · Tinte y Burbuja`;
        return () => { document.title = 'Tinte y Burbuja'; };
    }, [order?.orderNum]);

    // "Volver" respeta de dónde se vino (Tareas, Dashboard, Ventas, ficha...);
    // si se entró directamente por la URL, la lista de pedidos.
    const volver = () => {
        if (window.history.length > 1) navigate(-1);
        else navigate('/tareas');
    };

    const client = order?.client || null;
    const nombreCliente = client ? `${client.firstName || ''} ${client.lastName || ''}`.trim() : '';

    const nuevoPedidoParaCliente = () => {
        if (!client) return;
        draft.setSelectedUser({
            id: client.id, firstName: client.firstName, lastName: client.lastName,
            phone: client.phone, email: client.email, isbigclient: client.isbigclient,
            discount: client.discount, notifyChannel: client.notifyChannel,
        });
        navigate('/pos');
    };

    const copiarEnlacePortal = async () => {
        if (!order) return;
        setPortalBusy(true);
        try {
            const {link, magic} = await fetchOrderPortalLink(token, order.id);
            let copiado = false;
            if (navigator.clipboard?.writeText) {
                try { await navigator.clipboard.writeText(link); copiado = true; } catch { /* sin portapapeles */ }
            }
            if (copiado) {
                avisar(magic ? 'Enlace de acceso del cliente copiado (válido 30 días)' : 'Enlace del portal copiado', 'success');
            } else {
                window.prompt('Enlace del portal del cliente:', link);
            }
        } catch (e) {
            avisar(e.error || 'No se pudo generar el enlace del portal', 'danger');
        } finally {
            setPortalBusy(false);
        }
    };

    return (
        <div>
            <div className="uk-flex uk-flex-between uk-flex-middle uk-flex-wrap" style={{gap: 10, marginBottom: 14}}>
                <div className="uk-flex uk-flex-middle" style={{gap: 10, minWidth: 0}}>
                    <button type="button" className="uk-button uk-button-default uk-button-small" onClick={volver}>
                        <span uk-icon="icon: arrow-left; ratio: 0.8"></span> Volver
                    </button>
                    <nav aria-label="Estás en" style={{fontSize: '0.85rem', color: '#64748b', minWidth: 0}}>
                        <Link to="/tareas" style={{color: '#64748b'}}>Pedidos</Link>
                        <span style={{margin: '0 6px'}}>›</span>
                        <strong style={{color: '#1e293b', fontFamily: 'monospace'}}>{order?.orderNum || (loading ? '…' : `#${id}`)}</strong>
                    </nav>
                </div>

                {order && (
                    <div className="uk-flex uk-flex-middle uk-flex-wrap" style={{gap: 8}}>
                        {client ? (
                            <Link to={rutaCliente(client)} className="uk-button uk-button-default uk-button-small"
                                  title="Ver la ficha del cliente, con todos sus pedidos y facturas">
                                <span uk-icon="icon: user; ratio: 0.8"></span> {nombreCliente || 'Ficha del cliente'}
                            </Link>
                        ) : (
                            <span className="uk-text-muted" style={{fontSize: '0.85rem'}}>Cliente rápido (sin ficha)</span>
                        )}
                        {client?.phone && (
                            <a href={`tel:${client.phone}`} className="uk-button uk-button-default uk-button-small" title="Llamar">
                                <span uk-icon="icon: receiver; ratio: 0.8"></span> {client.phone}
                            </a>
                        )}
                        {client && (
                            <button type="button" className="uk-button uk-button-default uk-button-small"
                                    onClick={nuevoPedidoParaCliente}
                                    title="Abre el TPV con este cliente ya seleccionado">
                                <span uk-icon="icon: cart; ratio: 0.8"></span> Nuevo pedido
                            </button>
                        )}
                        <button type="button" className="uk-button uk-button-default uk-button-small"
                                onClick={copiarEnlacePortal} disabled={portalBusy}
                                title="Copia el enlace con el que el cliente ve este pedido en su portal">
                            <span uk-icon="icon: link; ratio: 0.8"></span> {portalBusy ? 'Generando…' : 'Enlace del portal'}
                        </button>
                    </div>
                )}
            </div>

            {loading && (
                <div className="uk-text-center uk-padding">
                    <div uk-spinner="ratio: 1"></div>
                    <p>Cargando pedido...</p>
                </div>
            )}

            {!loading && error && (
                <div className="uk-alert-danger" uk-alert="true">
                    <p>{error}</p>
                    <Link to="/tareas" className="uk-button uk-button-default uk-button-small">Ir a la lista de pedidos</Link>
                </div>
            )}

            {order && (
                <PaymentSection token={token} orderId={order.id} initialOrder={order}/>
            )}
        </div>
    );
}
