import React, {useState, useEffect} from 'react';
import { lineasActivas } from '../utils/lineas.js';
import {fetchDates} from '../api';
import {Link} from 'react-router-dom';


export default function DateCarousel({
                                         fechaLimite, setFechaLimite, token
                                     }) {
    const [currentPage, setCurrentPage] = useState(0);
    const [dates, setDates] = useState([]);
    const [loadByDay, setLoadByDay] = useState({});
    const [suggestedDate, setSuggestedDate] = useState(null);
    const [loading, setLoading] = useState(false);

    const loadDates = async (page) => {
        setLoading(true);
        try {
            const res = await fetchDates(page, token);
            setDates(res.dates);
            setLoadByDay(res.loadByDay);
            console.log(res);

            if (page === 0 && res.suggestedDate) {
                setSuggestedDate(res.suggestedDate);
                // Solo establecer la fecha sugerida aquí si no hay fecha límite establecida
                if (fechaLimite === null || fechaLimite === undefined || fechaLimite === '') {

                    console.log('Estableciendo fecha sugerida:', res.suggestedDate);
                    setFechaLimite(res.suggestedDate);
                }
            }
        } catch (error) {
            console.error('Error loading dates:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (token) {
            loadDates(0);
        }
    }, [token]);


    const handlePrevious = () => {
        const newPage = currentPage - 1; // Permitir páginas negativas
        console.log('Previous - Current page:', currentPage, 'New page:', newPage);
        setCurrentPage(newPage);
        loadDates(newPage);
    };

    const handleNext = () => {
        const newPage = currentPage + 1;
        console.log('Next - Current page:', currentPage, 'New page:', newPage);
        setCurrentPage(newPage);
        loadDates(newPage);
    };

    if (loading) {
        return <div className="uk-text-center">
            <div uk-spinner="true"></div>
        </div>;
    }

    // Carga ponderada: ignora productos que no computan y pondera por workloadWeight.
    const orderWeighted = (o) => lineasActivas(o.lines).reduce((s, l) => {
        const p = l.product || {};
        if (p.countsForLoad === false) return s;
        const w = (p.workloadWeight != null) ? Number(p.workloadWeight) : 1;
        return s + (l.quantity || 0) * w;
    }, 0);
    const dayWeighted = (orders) => orders.reduce((s, o) => s + orderWeighted(o), 0);
    const fmtLoad = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

    return (<div className="uk-margin-medium-bottom">
        <h4 className="uk-margin-small-bottom">Fecha de entrega</h4>

        <div className="uk-flex uk-flex-middle uk-grid-small" uk-grid="true">
                <span
                    onClick={handlePrevious}
                    disabled={currentPage === 0}
                >
                    <span uk-icon="icon: chevron-left; ratio: 2;"></span>
                </span>

            <div className="uk-width-expand">
                <div className="uk-child-width-1-5 uk-grid-small" uk-grid="true">
                    {dates.map((key) => {
                        const ordersForDay = loadByDay[key] || [];
                        const load = dayWeighted(ordersForDay);
                        const colorClass = load >= 8 ? 'uk-alert-danger' : load >= 4 ? 'uk-alert-warning' : 'uk-alert-success';

                        const isSuggested = key === suggestedDate;

                        return (<div key={key}>
                            <div className="uk-inline uk-display-block">
                                <div
                                    className={`${colorClass} uk-padding-small uk-border-rounded uk-box-shadow-small uk-display-block ${fechaLimite === key ? 'uk-box-shadow-medium uk-position-z-index uk-border uk-border-emphasis uk-background-selected' : ''} ${isSuggested ? 'uk-box-shadow-large uk-border uk-border-primary' : ''}`}
                                    onClick={() => setFechaLimite(key)}
                                >
                                    <div className="uk-text-bold">
                                        {new Date(key).toLocaleDateString('es-ES', {
                                            weekday: 'short', day: 'numeric', month: 'short',
                                        })}

                                    </div>
                                    <div className="uk-text-small">Pedidos: {ordersForDay.length}</div>
                                    <div className="uk-text-small uk-text-bold">Carga: {fmtLoad(load)}</div>
                                </div>

                                {/* Dropdown acotado: cabecera/pie fijos y lista con scroll */}
                                {/* IMPORTANTE: no poner display/flex en el elemento uk-dropdown,
                                    porque sobrescribe el display:none que UIkit usa para ocultarlo.
                                    El layout va en un div interior. */}
                                {ordersForDay.length > 0 && (<div
                                    className="uk-card uk-card-default"
                                    style={{ padding: 0 }}
                                    uk-dropdown="mode: hover; delay-hide: 200; pos: bottom-center; boundary: !.uk-grid; boundary-align: true; animation: uk-animation-slide-top-small"
                                >
                                  <div style={{
                                      width: 300, maxWidth: '92vw',
                                      display: 'flex', flexDirection: 'column',
                                      maxHeight: '60vh', overflow: 'hidden',
                                  }}>
                                    {/* Cabecera fija */}
                                    <div style={{ padding: '10px 12px', borderBottom: '1px solid #eef2f7', flexShrink: 0 }}>
                                        <strong style={{ fontSize: '0.82rem' }}>
                                            {new Date(key).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}
                                        </strong>
                                    </div>

                                    {/* Lista con scroll */}
                                    <div style={{ overflowY: 'auto', flex: 1 }}>
                                        {ordersForDay.map((order) => {
                                            const st = order.status;
                                            const stLabel = st === 'pending' ? 'Pendiente' : st === 'in_progress' ? 'En proceso' : st === 'ready' ? 'Listo' : st === 'collected' ? 'Recogido' : st === 'cancelled' ? 'Cancelado' : st;
                                            const stClass = st === 'pending' ? 'warning' : st === 'in_progress' ? 'primary' : st === 'ready' ? 'success' : 'default';
                                            return (
                                                <div key={order.id} style={{ padding: '8px 12px', borderBottom: '1px solid #f4f6f9' }}>
                                                    <div className="uk-flex uk-flex-between uk-flex-middle" style={{ gap: 6 }}>
                                                        <Link
                                                            to={`/tareas`}
                                                            state={{ filterOrderId: order.id, orderNumber: order.orderNum || order.id }}
                                                            className="uk-text-bold"
                                                            style={{ fontSize: '0.82rem' }}
                                                        >
                                                            {order.orderNum}
                                                        </Link>
                                                        <span className={`uk-label uk-label-${stClass}`} style={{ fontSize: '0.6rem' }}>
                                                            {stLabel}
                                                        </span>
                                                    </div>
                                                    <div className="uk-text-muted" style={{ fontSize: '0.72rem' }}>
                                                        {order.client?.firstName} {order.client?.lastName} · Carga {fmtLoad(orderWeighted(order))}
                                                    </div>
                                                    {/* Prendas en una sola línea que envuelve */}
                                                    <div style={{ fontSize: '0.72rem', marginTop: 2, lineHeight: 1.35 }}>
                                                        {lineasActivas(order.lines).map((l, i) => {
                                                            const noLoad = l.product?.countsForLoad === false;
                                                            return (
                                                                <span key={l.id} style={{ color: noLoad ? '#9ca3af' : '#475569' }}>
                                                                    {i > 0 ? ', ' : ''}{l.quantity}× {l.product?.name || `#${l.productId}`}{noLoad ? ' (no computa)' : ''}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Pie fijo con el resumen del día */}
                                    <div style={{ padding: '8px 12px', borderTop: '1px solid #eef2f7', background: '#fbfcfe', fontSize: '0.72rem', color: '#64748b', flexShrink: 0 }}>
                                        {ordersForDay.length} pedido{ordersForDay.length !== 1 ? 's' : ''} · Carga {fmtLoad(load)}
                                    </div>
                                  </div>
                                </div>)}
                            </div>
                        </div>);
                    })}
                </div>
            </div>

            <span
                onClick={handleNext}
            >
                    <span uk-icon="icon: chevron-right; ratio: 2;"></span>
                </span>
        </div>
    </div>);
}