import React, { useState, useEffect, useRef } from 'react';

const isBusinessDay = (d) => {
    const wd = d.getDay();
    return wd !== 0 && wd !== 6;
};

const getNextBusinessDays = (count = 12) => {
    const days = [];
    let cursor = new Date();
    while (days.length < count) {
        cursor = new Date(cursor);
        cursor.setDate(cursor.getDate() + 1);
        if (isBusinessDay(cursor)) {
            days.push(new Date(cursor));
        }
    }
    return days;
};

const formatDateKey = (d) => d.toISOString().split('T')[0];

export default function DateCarousel({
    loadByDay,
    fechaLimite,
    setFechaLimite,
}) {
    const days = getNextBusinessDays(10);

    return (
        <div className="uk-margin-medium-bottom">
            <h4 className="uk-heading-bullet uk-margin-small-bottom">Fecha de entrega</h4>
            
            <div className="uk-child-width-1-5@m uk-child-width-1-3@s uk-child-width-1-2 uk-grid-small" uk-grid="true">
                {days.map((d) => {
                    const key = formatDateKey(d);
                    const ordersForDay = loadByDay[key] || [];
                    
                    // Determinar la clase de color según la cantidad de pedidos
                    const colorClass = 
                        ordersForDay.length >= 5
                            ? 'uk-alert-danger' 
                            : ordersForDay.length >= 2
                                ? 'uk-alert-warning'
                                : 'uk-alert-success';
                    
                    return (
                        <div key={key}>
                            <div className="uk-inline uk-display-block">
                                <div 
                                    className={`${colorClass} uk-padding-small uk-border-rounded uk-box-shadow-small uk-display-block ${
                                        fechaLimite === key ? 'uk-box-shadow-medium uk-position-z-index uk-border uk-border-emphasis' : ''
                                    }`}
                                    onClick={() => setFechaLimite(key)}
                                >
                                    <div className="uk-text-bold">
                                        {new Date(key).toLocaleDateString('es-ES', {
                                            weekday: 'short',
                                            day: 'numeric',
                                            month: 'short',
                                        })}
                                    </div>
                                    <div className="uk-text-small">Pedidos: {ordersForDay.length}</div>
                                </div>
                                
                                {ordersForDay.length > 0 && (
                                    <div 
                                        className="uk-width-large uk-card uk-card-default uk-card-body uk-padding-small"
                                        uk-dropdown="mode: hover; delay-hide: 200; pos: bottom-center; boundary: !.uk-grid; boundary-align: true; animation: uk-animation-slide-top-small"
                                    >
                                        <h5 className="uk-margin-remove-top uk-margin-small-bottom">
                                            Pedidos para {new Date(key).toLocaleDateString('es-ES', {
                                                weekday: 'long',
                                                day: 'numeric',
                                                month: 'long',
                                            })}
                                        </h5>
                                        
                                        <div className="uk-height-medium uk-overflow-auto">
                                            {ordersForDay.map((o) => (
                                                <div key={o.id} className="uk-margin-small-bottom">
                                                    <div className="uk-card-header uk-padding-small">
                                                        <h5 className="uk-margin-remove">
                                                            <span className="uk-text-primary">Pedido: {o.orderNum}</span>
                                                        </h5>
                                                    </div>
                                                    <div className="uk-card-body uk-padding-small">
                                                        <ul className="uk-list uk-list-divider uk-margin-remove">
                                                            {o.lines.map((l) => (
                                                                <li key={l.id} className="uk-text-small">
                                                                    <span className="uk-badge uk-margin-small-right">{l.quantity}</span>
                                                                    {l.productName || l.product?.name}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
