// hooks/useOrder.js
import { useState, useEffect } from 'react';
import { fetchOrder } from '../api.js';

export function useOrder(token, orderId) {
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(!!orderId);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!orderId) return;
        let aborted = false;
        setLoading(true);
        fetchOrder(token, orderId)
            .then((o) => {
                if (!aborted) setOrder(o);
            })
            .catch((e) => {
                if (!aborted) setError(e.error || 'Error cargando pedido');
            })
            .finally(() => {
                if (!aborted) setLoading(false);
            });
        return () => {
            aborted = true;
        };
    }, [token, orderId]);

    const refresh = async () => {
        if (!orderId) return;
        setLoading(true);
        try {
            const o = await fetchOrder(token, orderId);
            setOrder(o);
            setError(null);
        } catch (e) {
            setError(e.error || 'Error cargando pedido');
        } finally {
            setLoading(false);
        }
    };

    return { order, loading, error, refresh };
}
