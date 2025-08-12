import React, {useEffect, useState, useRef} from 'react';
import {fetchOrders, payWithCard, payWithCash} from '../api.js';
import PaymentSection from '../components/PaymentSection.jsx';

export default function Tasks({token, products}) {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('all'); // nuevo estado para el filtro
    const debounceRef = useRef(null);

    const [showCashModalForTask, setShowCashModalForTask] = useState(null); // task.id que está pagando
    const [receivedAmount, setReceivedAmount] = useState('');
    const [isPaying, setIsPaying] = useState(false);

    const load = async (search = '') => {
        setLoading(true);
        try {
            const url = search ? `/api/tasks?q=${encodeURIComponent(search)}` : '/api/tasks';
            const t = await fetchOrders(token, url);
            setTasks(t);
            setError('');
        } catch (e) {
            setError(e.error || 'Error cargando tareas');
        } finally {
            setLoading(false);
        }
    };

    // Filtrar tareas según el estado seleccionado
    const filteredTasks = tasks.filter(task => {
        switch (filterStatus) {
            case 'pending':
                return task.status === "pending";
            case 'ready':
                return task.status === "ready";
            case 'collected':
                return task.status === "collected";
            default:
                return true;
        }
    });

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

    return (<div>
        <div style={{
            marginBottom: 20, display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between'
        }}>
            <h2 style={{margin: 0}}>Tareas</h2>
            <FilterBar value={filterStatus} onChange={setFilterStatus} query={query} setQuery={setQuery}/>
        </div>

        {error && <div style={{color: 'red'}}>{error}</div>}
        {loading && <div>Cargando...</div>}
        {!loading && filteredTasks.length === 0 && (<div style={{
            padding: '20px', textAlign: 'center', color: '#666', backgroundColor: '#f9f9f9', borderRadius: '8px'
        }}>
            No hay
            tareas {filterStatus !== 'all' ? (filterStatus === 'pending' ? 'pendientes' : filterStatus === 'ready' ? 'listas' : 'recogidas') : ''}.
        </div>)}

        <div style={{
            display: 'grid', gap: '16px', marginTop: '16px'
        }}>
            {filteredTasks.map((t) => {
                const clientName = t.order ? t.order.client ? `${t.order.client.firstName} ${t.order.client.lastName}`.trim() : 'Cliente rápido' : '-';

                return (<div key={t.id}>
                    {/* PaymentSection en lugar de la vista manual */}
                    {t.id ? (<div style={{marginTop: 12}}>
                        <PaymentSection
                            token={token}
                            orderId={t.id}
                            onPaid={() => load(query)}
                        />
                    </div>) : (<div style={{marginTop: 12}}>Pedido no disponible</div>)}


                    {/* Notificaciones */}
                    {t.notifications?.length > 0 && (<div style={{marginTop: 10}}>
                        <div style={{fontWeight: 'bold'}}>Notificaciones:</div>
                        {t.notifications.map((n) => (<div
                            key={n.id}
                            style={{fontSize: 12, marginTop: 4, display: 'flex', gap: 6}}
                        >
                            <div>
                                <strong>{n.type}</strong> — {n.status}
                            </div>
                            {n.createdAt && (<div style={{color: '#555'}}>
                                {new Date(n.createdAt).toLocaleString()}
                            </div>)}
                            <div>{n.content}</div>
                        </div>))}
                    </div>)}
                </div>);
            })}
        </div>
    </div>);
}

// javascript
function FilterBar({value, onChange, query, setQuery}) {
    const Btn = ({val, children}) => (<button
        type="button"
        className={`uk-button ${value === val ? 'uk-button-primary' : 'uk-button-default'}`}
        aria-pressed={value === val}
        onClick={() => onChange(val)}
    >
        {children}
    </button>);

    return (<div className="uk-flex uk-flex-between uk-flex-middle uk-margin-small">
        <div className="uk-flex uk-flex-middle uk-grid-small" data-uk-grid>
            <div>
                <input
                    className="uk-input uk-form-width-medium"
                    placeholder="Buscar por pedido o cliente..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>
            <div>
                <div className="uk-button-group">
                    <Btn val="all">Todas</Btn>
                    <Btn val="pending">Pendientes</Btn>
                    <Btn val="ready">Listas</Btn>
                    <Btn val="collected">Recogidas</Btn>
                </div>
            </div>
        </div>
    </div>);
}