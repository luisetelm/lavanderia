import React, { useEffect, useState, useRef } from 'react';
import { fetchTasks, updateTask } from '../api.js';
import { printSaleTicket, printWashLabels } from '../utils/printUtils.js';

export default function Tasks({ token, products }) {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const debounceRef = useRef(null);

    const load = async (search = '') => {
        setLoading(true);
        try {
            const url = search ? `/api/tasks?q=${encodeURIComponent(search)}` : '/api/tasks';
            const t = await fetchTasks(token, url);
            setTasks(t);
            setError('');
        } catch (e) {
            setError(e.error || 'Error cargando tareas');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [token]);

    // debounce para búsqueda
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            load(query);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [query, token]);

    const markReady = async (task) => {
        try {
            await updateTask(token, task.id, { state: 'ready' });
            await load();
        } catch (e) {
            console.error(e);
        }
    };

    const markCollected = async (task) => {
        try {
            await updateTask(token, task.id, { state: 'collected' });
            await load();
        } catch (e) {
            console.error(e);
        }
    };

    const handlePrintTicket = (task) => {
        if (!task.order) return;
        printSaleTicket(task.order, products);
    };

    const handlePrintLabels = (task) => {
        if (!task.order) return;
        const totalItems = task.order.lines.reduce(
            (sum, l) => sum + (l.quantity || 1),
            0
        );
        printWashLabels({
            orderNum: task.order.orderNum,
            clientFirstName: task.order.client?.firstName || '',
            clientLastName: task.order.client?.lastName || '',
            totalItems,
        });
    };

    return (
        <div>
            <h2>Tareas</h2>
            <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Tareas</h2>
                <div>
                    <input
                        placeholder="Buscar por pedido o cliente..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        style={{ padding: 6, width: 300 }}
                    />
                </div>
            </div>
            {error && <div style={{ color: 'red' }}>{error}</div>}
            {loading && <div>Cargando...</div>}
            {!loading && tasks.length === 0 && <div>No hay tareas.</div>}
            {tasks.map((t) => {
                const clientName = t.order
                    ? t.order.client
                        ? `${t.order.client.firstName} ${t.order.client.lastName}`.trim()
                        : 'Cliente rápido'
                    : '-';
                return (

                    <div
                        key={t.id}
                        style={{
                            border: '1px solid #aaa',
                            padding: 12,
                            marginBottom: 12,
                            borderRadius: 6,
                            background:
                                t.state === 'ready'
                                    ? '#e6ffe6'
                                    : t.state === 'collected'
                                        ? '#ececec'
                                        : '#fff',
                            position: 'relative',
                        }}
                    >


                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: 16 }}>
                                    {t.name} ({t.state})
                                </div>
                                <div>
                                    <strong>Pedido:</strong> {t.order?.orderNum || '-'}
                                </div>
                                <div>
                                    <strong>Cliente:</strong> {clientName}
                                </div>
                                {t.order?.client?.phone && (
                                    <div>
                                        <strong>Teléfono:</strong> {t.order.client.phone}
                                    </div>
                                )}
                                <div>
                                    <strong>Asignado a:</strong>{' '}
                                    {t.worker
                                        ? `${t.worker.firstName || ''} ${t.worker.lastName || ''}`.trim()
                                        : '—'}
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <button onClick={() => handlePrintTicket(t)}>Imprimir ticket</button>
                                <button onClick={() => handlePrintLabels(t)}>
                                    Imprimir etiquetas lavado
                                </button>
                            </div>
                        </div>

                        {/* Líneas del pedido */}
                        {t.order?.lines && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ fontWeight: 'bold' }}>Líneas:</div>
                                {t.order.lines.map((l) => {
                                    let name = l.productName;
                                    if (!name) {
                                        const prod = products.find((p) => p.id === l.productId);
                                        name = prod ? prod.name : `#${l.productId}`;
                                    }
                                    return (
                                        <div
                                            key={l.id}
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                fontSize: 13,
                                                marginTop: 2,
                                            }}
                                        >
                                            <div>
                                                {l.quantity}x {name}
                                            </div>
                                            <div>{(l.unitPrice * l.quantity).toFixed(2)}€</div>
                                        </div>
                                    );
                                })}
                                <div
                                    style={{
                                        marginTop: 6,
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        fontWeight: 'bold',
                                    }}
                                >
                                    <div>Total:</div>
                                    <div>{t.order.total.toFixed(2)}€</div>
                                </div>
                            </div>
                        )}

                        {/* Acciones */}
                        <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {t.state !== 'ready' && (
                                <button onClick={() => markReady(t)}>Marcar como listo</button>
                            )}
                            {t.state !== 'collected' && (
                                <button onClick={() => markCollected(t)}>Marcar como recogido</button>
                            )}
                        </div>

                        {/* Notificaciones */}
                        {t.notifications?.length > 0 && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ fontWeight: 'bold' }}>Notificaciones:</div>
                                {t.notifications.map((n) => (
                                    <div
                                        key={n.id}
                                        style={{ fontSize: 12, marginTop: 4, display: 'flex', gap: 6 }}
                                    >
                                        <div>
                                            <strong>{n.type}</strong> — {n.status}
                                        </div>
                                        {n.createdAt && (
                                            <div style={{ color: '#555' }}>
                                                {new Date(n.createdAt).toLocaleString()}
                                            </div>
                                        )}
                                        <div>{n.content}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
