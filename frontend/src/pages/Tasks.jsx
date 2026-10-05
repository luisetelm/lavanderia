import React, {useEffect, useState, useRef} from 'react';
import {fetchOrders, fetchUsers} from '../api.js';
import OrderCard from '../components/OrderCard.jsx';
import {useLocation, useSearchParams} from 'react-router-dom';
import PageToolbar from '../components/PageToolbar.jsx';
import Pagination from '../components/Pagination.jsx';


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
    const [page, setPage] = useState(0);
    const [meta, setMeta] = useState(null);
    const debounceRef = useRef(null);
    const PAGE_SIZE = 20;

    // Pedido a abrir: va en la URL (?pedido=TPV/2026/0163) para que sobreviva a
    // una recarga o a abrir el enlace en otra pestaña. El state de la ruta se
    // sigue admitiendo por compatibilidad con enlaces antiguos.
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const pedidoUrl = searchParams.get('pedido') || '';
    const {orderNumber} = location.state || {};

    const load = async (search = '', status = 'all', workerId, sort = 'createdAt', order = 'desc', pageArg = 0) => {
        setLoading(true);
        try {
            const resp = await fetchOrders(token, {
                q: search,
                status,
                workerId,
                sortBy: sort,
                sortOrder: order,
                page: pageArg,
                size: PAGE_SIZE,
            });
            // Respuesta paginada: { data, meta }
            const list = Array.isArray(resp) ? resp : (resp?.data || []);
            setTasks(list);
            setMeta(Array.isArray(resp) ? null : (resp?.meta || null));
            setError('');
        } catch (e) {
            setTasks([]);
            setMeta(null);
            setError(e.error || 'Error cargando tareas');
        } finally {
            setLoading(false);
        }
    };


    // Al llegar con un pedido se busca ese; al volver a /tareas sin pedido
    // (menú lateral) se limpia la búsqueda para no quedarse filtrado.
    useEffect(() => {
        const n = pedidoUrl || orderNumber;
        setQuery(n ? String(n) : '');
    }, [pedidoUrl, orderNumber]);

    // Trabajadores, para poner nombre a la persona encargada de cada pedido
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

    // Al cambiar búsqueda/filtros/orden, volver a la primera página
    useEffect(() => {
        setPage(0);
    }, [query, filterStatus, filterWorker, sortBy, sortOrder]);

    // Carga con debounce; incluye la página actual
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            load(query, filterStatus, filterWorker, sortBy, sortOrder, page);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [query, token, filterStatus, filterWorker, sortBy, sortOrder, page]);

    const handlePageChange = (newPage1Based) => {
        const newPage = newPage1Based - 1; // Pagination usa base 1
        setPage(newPage);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

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

        <div className="section-content" style={{display: 'flex', flexDirection: 'column', gap: 10}}>
            {tasks.map((t) => {
                const w = t.workerId ? workers.find(u => u.id === t.workerId) : null;
                return (
                    <OrderCard key={t.id} order={t}
                               workerName={w ? `${w.firstName} ${w.lastName || ''}`.trim() : null}/>
                );
            })}
        </div>

        {!loading && meta && meta.totalPages > 1 && (
            <Pagination meta={meta} onPageChange={handlePageChange} />
        )}
    </div>);
}

