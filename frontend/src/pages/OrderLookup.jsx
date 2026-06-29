import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { findOrderByNum } from '../api.js';

// Página de aterrizaje al escanear el QR de un ticket interno.
// URL esperada: /buscar-pedido?num=TPV/2025/0095
// Resuelve el pedido por su número y redirige a sus tareas.
export default function OrderLookup({ token }) {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const num = params.get('num') || '';

    useEffect(() => {
        if (!num) {
            setError('No se ha indicado ningún número de pedido.');
            return;
        }
        let cancelled = false;
        findOrderByNum(token, num)
            .then((order) => {
                if (cancelled) return;
                navigate('/tareas', {
                    replace: true,
                    state: { filterOrderId: order.id, orderNumber: order.orderNum },
                });
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err.error || `No se encontró el pedido "${num}".`);
            });
        return () => { cancelled = true; };
    }, [num, token]);

    return (
        <div style={{ padding: 40, textAlign: 'center' }}>
            {error ? (
                <>
                    <div style={{ color: '#d32f2f', fontWeight: 600, marginBottom: 12 }}>{error}</div>
                    <button className="uk-button uk-button-primary" onClick={() => navigate('/tareas')}>
                        Ir a tareas
                    </button>
                </>
            ) : (
                <div>
                    <div uk-spinner="ratio: 1.5" />
                    <div style={{ marginTop: 12, color: '#666' }}>Abriendo pedido {num}…</div>
                </div>
            )}
        </div>
    );
}

