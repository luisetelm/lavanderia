import React, {useEffect, useState, useRef} from 'react';
import {fetchOrders, fetchUsers, payWithCard, payWithCash} from '../api.js';
import PaymentSection from '../components/PaymentSection.jsx';
import {useLocation} from 'react-router-dom';
import PageToolbar from '../components/PageToolbar.jsx';


export default function Tasks({token, user}) {
    const [tasks, setTasks] = useState([]);
    const [workers, setWorkers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterWorker, setFilterWorker] = useState(''); // Todas las tareas por defecto
    const [sortBy, setSortBy] = useState('createdAt');
    const [sortOrder, setSortOrder] = useState('desc');
    const debounceRef = useRef(null);

    const [showCashModalForTask, setShowCashModalForTask] = useState(null);
    const [receivedAmount, setReceivedAmount] = useState('');
    const [isPaying, setIsPaying] = useState(false);

    const location = useLocation();
    const {filterOrderId, orderNumber} = location.state || {};

    const load = async (search = '', status = 'all', workerId, sort = 'createdAt', order = 'desc') => {
        setLoading(true);
        try {
            const list = await fetchOrders(token, {
                q: search,
                status,
                workerId, // Esto ahora recibirá el parámetro correctamente
                sortBy: sort,
                sortOrder: order
            });
            setTasks(Array.isArray(list) ? list : []);
            setError('');
        } catch (e) {
            setTasks([]);
            setError(e.error || 'Error cargando tareas');
        } finally {
            setLoading(false);
        }
    };


    useEffect(() => {
        if (filterOrderId && orderNumber) {
            setQuery(orderNumber.toString());
            load(orderNumber.toString(), filterStatus, filterWorker, sortBy, sortOrder);
        }
    }, [filterOrderId, orderNumber, filterStatus, filterWorker, sortBy, sortOrder]);

    useEffect(() => {
        if (!filterOrderId) {
            load(query, filterStatus, filterWorker, sortBy, sortOrder);
        }
    }, [token]);

    // Cargar trabajadores UNA sola vez para pasarlos a todas las PaymentSection
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const resp = await fetchUsers(token, { role: 'worker' });
                if (!cancelled) setWorkers(resp.data || []);
            } catch (e) {
                console.error('Error cargando trabajadores:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [token]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            load(query, filterStatus, filterWorker, sortBy, sortOrder);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [query, token, filterStatus, filterWorker, sortBy, sortOrder]);

    return (<div>
        <PageToolbar
            title="Tareas"
            filters={[
                {
                    label: 'Estado',
                    active: filterStatus !== 'all',
                    options: [
                        { label: 'Todas', active: filterStatus === 'all', onClick: () => setFilterStatus('all') },
                        { label: 'Pendientes', active: filterStatus === 'pending', onClick: () => setFilterStatus('pending') },
                        { label: 'Listas', active: filterStatus === 'ready', onClick: () => setFilterStatus('ready') },
                        { label: 'Recogidas', active: filterStatus === 'collected', onClick: () => setFilterStatus('collected') },
                    ]
                },
                {
                    label: 'Trabajador',
                    active: filterWorker !== '',
                    options: [
                        { label: 'Mis tareas', active: filterWorker === user.id, onClick: () => setFilterWorker(filterWorker === user.id ? '' : user.id) },
                        { label: 'Todas las tareas', active: filterWorker === '', onClick: () => setFilterWorker('') },
                    ]
                },
                {
                    label: 'Ordenar',
                    active: sortBy !== 'createdAt' || sortOrder !== 'desc',
                    options: [
                        { label: 'Creación (reciente)', active: sortBy === 'createdAt' && sortOrder === 'desc', onClick: () => { setSortBy('createdAt'); setSortOrder('desc'); } },
                        { label: 'Creación (antigua)', active: sortBy === 'createdAt' && sortOrder === 'asc', onClick: () => { setSortBy('createdAt'); setSortOrder('asc'); } },
                        { label: 'Entrega (reciente)', active: sortBy === 'fechaLimite' && sortOrder === 'desc', onClick: () => { setSortBy('fechaLimite'); setSortOrder('desc'); } },
                        { label: 'Entrega (antigua)', active: sortBy === 'fechaLimite' && sortOrder === 'asc', onClick: () => { setSortBy('fechaLimite'); setSortOrder('asc'); } },
                        { label: 'Actualización (reciente)', active: sortBy === 'updatedAt' && sortOrder === 'desc', onClick: () => { setSortBy('updatedAt'); setSortOrder('desc'); } },
                        { label: 'Actualización (antigua)', active: sortBy === 'updatedAt' && sortOrder === 'asc', onClick: () => { setSortBy('updatedAt'); setSortOrder('asc'); } },
                    ]
                },
            ]}
            actions={
                <form className="uk-search uk-search-default">
                    <input
                        type="search"
                        className="uk-search-input"
                        placeholder="Buscar por pedido o cliente..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </form>
            }
        />

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
                            initialOrder={t}
                            workers={workers}
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

