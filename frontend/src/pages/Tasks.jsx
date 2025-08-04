import React, {useEffect, useState, useRef} from 'react';
import {fetchTasks, updateTask, payWithCard, payWithCash} from '../api.js';
import {printSaleTicket, printWashLabels} from '../utils/printUtils.js';
import PaymentSection from '../components/PaymentSection.jsx';
import CashModal from '../components/CashModal.jsx'; // asegúrate de que existe

export default function Tasks({token, products}) {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const debounceRef = useRef(null);

    const [showCashModalForTask, setShowCashModalForTask] = useState(null); // task.id que está pagando
    const [receivedAmount, setReceivedAmount] = useState('');
    const [isPaying, setIsPaying] = useState(false);

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

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            load(query);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [query, token]);

    const markReady = async (task) => {
        try {
            await updateTask(token, task.id, {state: 'ready'});
            await load(query);
        } catch (e) {
            console.error(e);
        }
    };

    const markCollected = async (task) => {
        try {
            await updateTask(token, task.id, {state: 'collected'});
            await load(query);
        } catch (e) {
            console.error(e);
        }
    };

    const handlePrintTicket = (task) => {
        if (!task.order) return;
        printSaleTicket(task.order, products, 'CLIENTE');
    };

    const handlePrintLabels = (task) => {
        console.log(task)

        if (!task.order) return;
        const totalItems = task.order.lines.reduce((sum, l) => sum + (l.quantity || 1), 0);
        printWashLabels({
            orderNum: task.order.orderNum,
            clientFirstName: task.order.client?.firstName || '',
            clientLastName: task.order.client?.lastName || '',
            totalItems,
            fechaLimite: task.order.fechaLimite,
        });
    };

    const handleCardPay = async (task) => {
        if (!task?.order) return;
        setIsPaying(true);
        try {
            await payWithCard(token, task.order.id);
            await load(query);
        } catch (e) {
            console.error('Error pago tarjeta:', e);
            setError(e.error || 'Error en pago con tarjeta');
        } finally {
            setIsPaying(false);
        }
    };

    const handleCashStart = (task) => {
        setReceivedAmount('');
        setError('');
        setShowCashModalForTask(task.id);
    };

    const handleCashConfirm = async (task) => {
        if (!task?.order) return;
        const received = parseFloat(receivedAmount);
        if (isNaN(received) || received < task.order.total) {
            setError('Cantidad recibida insuficiente');
            return;
        }
        setIsPaying(true);
        try {
            const {order: updatedOrder, change} = await payWithCash(token, task.order.id, received);
            console.log('Vuelta:', change);
            setShowCashModalForTask(null);
            await load(query);
        } catch (e) {
            console.error('Error pago efectivo:', e);
            setError(e.error || 'Error en pago en efectivo');
        } finally {
            setIsPaying(false);
        }
    };

    return (
        <div>
            <h2>Tareas</h2>
            <div style={{marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center'}}>
                <h2 style={{margin: 0}}>Tareas</h2>
                <div>
                    <input
                        placeholder="Buscar por pedido o cliente..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        style={{padding: 6, width: 300}}
                    />
                </div>
            </div>
            {error && <div style={{color: 'red'}}>{error}</div>}
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
                    >
                        {/* PaymentSection en lugar de la vista manual */}
                        {t.order ? (
                            <div style={{marginTop: 12}}>
                                <PaymentSection
                                    token={token}
                                    orderId={t.order.id}
                                    onPaid={() => load(query)}
                                />

                                {/* Modal de efectivo para esta tarea */}
                                {showCashModalForTask === t.id && t.order && (
                                    <CashModal
                                        order={t.order}
                                        receivedAmount={receivedAmount}
                                        setReceivedAmount={setReceivedAmount}
                                        change={
                                            receivedAmount
                                                ? Math.max(0, parseFloat(receivedAmount) - t.order.total).toFixed(2)
                                                : '0.00'
                                        }
                                        onConfirm={() => handleCashConfirm(t)}
                                        onClose={() => setShowCashModalForTask(null)}
                                        isProcessing={isPaying}
                                        error={error}
                                    />
                                )}
                            </div>
                        ) : (
                            <div style={{marginTop: 12}}>Pedido no disponible</div>
                        )}


                        {/* Notificaciones */}
                        {t.notifications?.length > 0 && (
                            <div style={{marginTop: 10}}>
                                <div style={{fontWeight: 'bold'}}>Notificaciones:</div>
                                {t.notifications.map((n) => (
                                    <div
                                        key={n.id}
                                        style={{fontSize: 12, marginTop: 4, display: 'flex', gap: 6}}
                                    >
                                        <div>
                                            <strong>{n.type}</strong> — {n.status}
                                        </div>
                                        {n.createdAt && (
                                            <div style={{color: '#555'}}>
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