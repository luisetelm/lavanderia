import React, {useEffect, useState, useRef} from 'react';
import {fetchOrders, payWithCard, payWithCash} from '../api.js';
import PaymentSection from '../components/PaymentSection.jsx';

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

    const load = async (search = '', status = 'all') => {
        setLoading(true);
        try {
            const list = await fetchOrders(token, { q: search, status });
            setTasks(Array.isArray(list) ? list : []);
            setError('');
        } catch (e) {
            setTasks([]);
            setError(e.error || 'Error cargando tareas');
        } finally {
            setLoading(false);
        }
    };

    // Carga inicial
    useEffect(() => {
        load(query, filterStatus);
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

    // Cambio de filtro: si prefieres que sea inmediato y no espere al debounce
    // separa este efecto y quita filterStatus del de arriba:
    // useEffect(() => {
    //     load(query, filterStatus);
    // }, [filterStatus]);

    return (<div>
        <div style={{
            marginBottom: 20, display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between'
        }}>
            <h2 style={{margin: 0}}>Tareas</h2>
            <FilterBar value={filterStatus} onChange={setFilterStatus} query={query} setQuery={setQuery}/>
        </div>

        {error && <div style={{color: 'red'}}>{error}</div>}
        {loading && <div>Cargando...</div>}
        {!loading && tasks.length === 0 && (<div style={{
            padding: '20px', textAlign: 'center', color: '#666', backgroundColor: '#f9f9f9', borderRadius: '8px'
        }}>
            No hay
            tareas {filterStatus !== 'all' ? (filterStatus === 'pending' ? 'pendientes' : filterStatus === 'ready' ? 'listas' : 'recogidas') : ''}.
        </div>)}

        <div style={{
            display: 'grid', gap: '16px', marginTop: '16px'
        }}>
            {tasks.map((t) => {
                const clientName = t.order ? t.order.client ? `${t.order.client.firstName} ${t.order.client.lastName}`.trim() : 'Cliente rápido' : '-';

                return (<div key={t.id}>
                    {t.id ? (<div style={{marginTop: 12}}>
                        <PaymentSection
                            token={token}
                            orderId={t.id}
                            onPaid={() => load(query, filterStatus)}
                        />
                    </div>) : (<div style={{marginTop: 12}}>Pedido no disponible</div>)}

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