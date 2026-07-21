import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { findOrderByNum, findOrdersByPortalToken } from '../api.js';

// Página de aterrizaje al escanear el QR de un ticket. Admite los dos QR que
// imprime el sistema:
//   - Ticket interno / etiqueta: /buscar-pedido?num=TPV/2025/0095
//   - Ticket de cliente:         /buscar-pedido?token=<jwt del magic link>
// El segundo identifica al CLIENTE, no a un pedido, así que se resuelven sus
// pedidos activos: si sólo hay uno se abre directo, si hay varios se elige.
export default function OrderLookup({ token }) {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const [choices, setChoices] = useState(null);   // { client, orders } si hay varios
    const num = params.get('num') || '';
    const magicToken = params.get('token') || '';

    // useCallback para poder declararlo como dependencia del efecto sin que
    // se recree en cada render (y relance la búsqueda en bucle).
    const openOrder = useCallback((order) => {
        navigate('/tareas', {
            replace: true,
            state: { filterOrderId: order.id, orderNumber: order.orderNum },
        });
    }, [navigate]);

    useEffect(() => {
        let cancelled = false;

        // ── Ticket de cliente: cliente → sus pedidos activos ──
        if (magicToken) {
            findOrdersByPortalToken(token, magicToken)
                .then(({ client, orders }) => {
                    if (cancelled) return;
                    const nombre = `${client.firstName || ''} ${client.lastName || ''}`.trim();
                    if (!orders.length) {
                        setError(`${nombre || 'Este cliente'} no tiene pedidos pendientes.`);
                        return;
                    }
                    if (orders.length === 1) {
                        openOrder(orders[0]);
                        return;
                    }
                    setChoices({ client, orders });
                })
                .catch((err) => {
                    if (cancelled) return;
                    setError(err.error || 'No se pudo leer el QR del ticket.');
                });
            return () => { cancelled = true; };
        }

        // ── Ticket interno: búsqueda por número de pedido ──
        if (!num) {
            setError('No se ha indicado ningún número de pedido.');
            return;
        }
        findOrderByNum(token, num)
            .then((order) => {
                if (cancelled) return;
                openOrder(order);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err.error || `No se encontró el pedido "${num}".`);
            });
        return () => { cancelled = true; };
    }, [num, magicToken, token, openOrder]);

    if (error) {
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ color: '#d32f2f', fontWeight: 600, marginBottom: 12 }}>{error}</div>
                <button className="uk-button uk-button-primary" onClick={() => navigate('/tareas')}>
                    Ir a tareas
                </button>
            </div>
        );
    }

    // Varios pedidos activos: que el empleado elija.
    if (choices) {
        const nombre = `${choices.client.firstName || ''} ${choices.client.lastName || ''}`.trim();
        return (
            <div style={{ padding: 40, maxWidth: 560, margin: '0 auto' }}>
                <h3 style={{ marginBottom: 4 }}>{nombre}</h3>
                <div style={{ color: '#666', marginBottom: 20 }}>
                    {choices.orders.length} pedidos pendientes. Elige cuál abrir:
                </div>
                <ul className="uk-list uk-list-divider">
                    {choices.orders.map((o) => (
                        <li key={o.id}>
                            <button
                                className="uk-button uk-button-text"
                                style={{ width: '100%', textAlign: 'left' }}
                                onClick={() => openOrder(o)}
                            >
                                <strong>{o.orderNum}</strong>
                                <span style={{ color: '#666', marginLeft: 10 }}>
                                    {o.status === 'ready' ? 'Listo' : 'En proceso'}
                                    {o.fechaLimite
                                        ? ` · entrega ${new Date(o.fechaLimite).toLocaleDateString('es-ES')}`
                                        : ''}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        );
    }

    return (
        <div style={{ padding: 40, textAlign: 'center' }}>
            <div uk-spinner="ratio: 1.5" />
            <div style={{ marginTop: 12, color: '#666' }}>
                {magicToken ? 'Buscando los pedidos del cliente…' : `Abriendo pedido ${num}…`}
            </div>
        </div>
    );
}
