import React, {useState, useEffect} from 'react';
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
    const orderWeighted = (o) => (o.lines || []).reduce((s, l) => {
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

                                {/* Mantener el dropdown existente */}
                                {ordersForDay.length > 0 && (<div
                                    className="uk-width-large uk-card uk-card-default uk-card-body uk-padding-small"
                                    uk-dropdown="mode: hover; delay-hide: 200; pos: bottom-center; boundary: !.uk-grid; boundary-align: true; animation: uk-animation-slide-top-small"
                                >
                                    <h5 className="uk-margin-remove-top">Pedidos
                                        para {new Date(key).toLocaleDateString('es-ES')}</h5>
                                    <ul className="uk-list uk-list-divider uk-margin-small-top">
                                        {ordersForDay.map((order) => (<li key={order.id} className="uk-text-small">
                                            <div className="uk-flex uk-flex-between">
                                                <Link
                                                    to={`/tareas`}
                                                    state={{
                                                        filterOrderId: order.id,
                                                        orderNumber: order.orderNum || order.id
                                                    }}
                                                    className="uk-text-bold"
                                                >
                                                    {order.orderNum}
                                                </Link>
                                                <span
                                                    className={`uk-label uk-label-${order.status === 'pending' ? 'warning' : order.status === 'in_progress' ? 'primary' : order.status === 'ready' ? 'success' : 'default'}`}>
                            {order.status}
                        </span>
                                            </div>
                                            <div className="uk-text-muted">
                                                {order.client?.firstName} {order.client?.lastName}
                                            </div>
                                            {/* Desglose de prendas del pedido */}
                                            <ul className="uk-list uk-margin-remove" style={{fontSize: '0.78rem'}}>
                                                {(order.lines || []).map((l) => {
                                                    const noLoad = l.product?.countsForLoad === false;
                                                    return (
                                                        <li key={l.id}
                                                            style={{color: noLoad ? '#9ca3af' : '#475569'}}>
                                                            {l.quantity}× {l.product?.name || `#${l.productId}`}
                                                            {noLoad && (
                                                                <span className="uk-margin-small-left"
                                                                      style={{fontSize: '0.68rem', color: '#9ca3af'}}>
                                                                    (no computa)
                                                                </span>
                                                            )}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                            <div className="uk-text-muted" style={{fontSize: '0.72rem'}}>
                                                Carga: {fmtLoad(orderWeighted(order))}
                                            </div>
                                        </li>))}
                                    </ul>
                                    <div className="uk-text-small uk-text-muted uk-margin-small-top">
                                        Total: {ordersForDay.length} pedido{ordersForDay.length !== 1 ? 's' : ''} · Carga {fmtLoad(load)}
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