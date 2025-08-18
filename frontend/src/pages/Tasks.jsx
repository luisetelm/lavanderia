import React, {useEffect, useState, useRef} from 'react';
import {fetchOrders, payWithCard, payWithCash} from '../api.js';
import PaymentSection from '../components/PaymentSection.jsx';
import {useLocation} from 'react-router-dom';


export default function Tasks({token, products}) {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const debounceRef = useRef(null);

    const [showCashModalForTask, setShowCashModalForTask] = useState(null);
    const [receivedAmount, setReceivedAmount] = useState('');
    const [isPaying, setIsPaying] = useState(false);

    const location = useLocation();
    const {filterOrderId, orderNumber} = location.state || {};
    const load = async (search = '', status = 'all') => {
        setLoading(true);
        try {
            const list = await fetchOrders(token, {q: search, status});
            setTasks(Array.isArray(list) ? list : []);
            setError('');
        } catch (e) {
            setTasks([]);
            setError(e.error || 'Error cargando tareas');
        } finally {
            setLoading(false);
        }
    };

// Aplicar filtro automáticamente si viene del POS
    useEffect(() => {
        if (filterOrderId && orderNumber) {
            setQuery(orderNumber.toString());
            load(orderNumber.toString(), filterStatus);
        }
    }, [filterOrderId, orderNumber]);

// Carga inicial
    useEffect(() => {
        // Solo cargar si no viene filtro del POS
        if (!filterOrderId) {
            load(query, filterStatus);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

// Debounce al escribir en la barra de búsqueda
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            load(query, filterStatus);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [query, token, filterStatus]);

    return (<div>
        <div className="section-header">
            <h2 className="uk-margin-remove">Tareas</h2>
            <FilterBar value={filterStatus} onChange={setFilterStatus} query={query} setQuery={setQuery}/>
        </div>

        {error && (<div className="uk-alert-danger" uk-alert="true">
            <p>{error}</p>
        </div>)}

        {loading && (<div className="uk-text-center uk-padding">
            <div uk-spinner="ratio: 1"></div>
            <p>Cargando...</p>
        </div>)}

        {!loading && tasks.length === 0 && (<div className="uk-alert uk-alert-primary uk-text-center">
            No hay tareas
            {filterStatus !== 'all' ? (filterStatus === 'pending' ? ' pendientes' : filterStatus === 'ready' ? ' listas' : ' recogidas') : ''}.
        </div>)}

        <div className="section-content">
            {tasks.map((t) => {
                const clientName = t.order ? t.order.client ? `${t.order.client.firstName} ${t.order.client.lastName}`.trim() : 'Cliente rápido' : '-';

                return (<div key={t.id}>
                    {t.id ? (<div className="uk-margin">
                        <PaymentSection
                            token={token}
                            orderId={t.id}
                            onPaid={() => load(query, filterStatus)}
                        />
                    </div>) : (<div className="uk-alert uk-alert-warning uk-margin">
                        Pedido no disponible
                    </div>)}

                    {t.notifications?.length > 0 && (<div className="uk-margin-top">
                        <h4 className="uk-heading-bullet uk-margin-small-bottom">
                            Notificaciones
                        </h4>
                        <div className="uk-margin-small-top">
                            {t.notifications.map((n) => (
                                <div key={n.id} className="uk-grid-small uk-margin-small" uk-grid="true">
                                    <div className="uk-width-auto">
                                                    <span className="uk-label">
                                                        {n.type}
                                                    </span>
                                        <span> — {n.status}</span>
                                    </div>
                                    {n.createdAt && (<div className="uk-width-auto uk-text-muted">
                                        {new Date(n.createdAt).toLocaleString()}
                                    </div>)}
                                    <div className="uk-width-expand">
                                        {n.content}
                                    </div>
                                </div>))}
                        </div>
                    </div>)}
                </div>);
            })}
        </div>
    </div>);
}

function FilterBar({value, onChange, query, setQuery}) {
    const Btn = ({val, children}) => (<button
        type="button"
        className={`uk-button ${value === val ? 'uk-button-primary' : 'uk-button-default'}`}
        aria-pressed={value === val}
        onClick={() => onChange(val)}
    >
        {children}
    </button>);

    return (<div>
        <div>
            <form className="uk-search uk-search-default">
                <input
                    type="search"
                    className="uk-search-input uk-width-1-1"
                    placeholder="Buscar por pedido o cliente..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </form>
        </div>
        <div>
            <div className="uk-button-group">
                <Btn val="all">Todas</Btn>
                <Btn val="pending">Pendientes</Btn>
                <Btn val="ready">Listas</Btn>
                <Btn val="collected">Recogidas</Btn>
            </div>
        </div>
    </div>);
}