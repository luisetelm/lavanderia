import React, {useEffect, useState, useRef} from 'react';
import {fetchOrders, fetchUsers} from '../api.js';
import PaymentSection from '../components/PaymentSection.jsx';
import {useSearchParams} from 'react-router-dom';
import PageToolbar from '../components/PageToolbar.jsx';
import Pagination from '../components/Pagination.jsx';


export default function Tasks({token, user}) {
    const [tasks, setTasks] = useState([]);
    const [workers, setWorkers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Lista de pedidos (/pedidos; la ruta antigua /tareas redirige aquí).
    // Todos los filtros viven en la URL: se pueden compartir, el botón atrás
    // los respeta y el Dashboard puede enlazar a "pendientes" o "listos".
    //   ?q=texto  ?estado=pending|ready|collected  ?trabajador=ID
    //   ?orden=createdAt|fechaLimite|updatedAt  ?dir=asc|desc  ?pagina=N
    //   ?pedido=NUM (enlaces antiguos: busca ese pedido)
    const [searchParams, setSearchParams] = useSearchParams();
    const query = searchParams.get('q') ?? searchParams.get('pedido') ?? '';
    const filterStatus = searchParams.get('estado') || 'all';
    const filterWorker = searchParams.get('trabajador') ? Number(searchParams.get('trabajador')) : '';
    const sortBy = searchParams.get('orden') || 'createdAt';
    const sortOrder = searchParams.get('dir') || 'desc';
    const page = Math.max(0, (parseInt(searchParams.get('pagina'), 10) || 1) - 1);
    const DEFAULTS = {q: '', estado: 'all', trabajador: '', orden: 'createdAt', dir: 'desc', pagina: '1'};
    // Cambiar un filtro vuelve a la primera página; cambiar de página, no.
    const setParams = (cambios) => {
        const next = new URLSearchParams(searchParams);
        if (!('pagina' in cambios)) next.delete('pagina');
        if ('q' in cambios) next.delete('pedido');
        Object.entries(cambios).forEach(([k, v]) => {
            if (v === undefined || v === null || String(v) === '' || String(v) === String(DEFAULTS[k])) next.delete(k);
            else next.set(k, String(v));
        });
        setSearchParams(next, {replace: true});
    };
    const setQuery = (v) => setParams({q: v});
    const setFilterStatus = (v) => setParams({estado: v});
    const setFilterWorker = (v) => setParams({trabajador: v});
    const setSort = (orden, dir) => setParams({orden, dir});
    const setPage = (p0) => setParams({pagina: p0 + 1});

    const [meta, setMeta] = useState(null);
    const debounceRef = useRef(null);
    const PAGE_SIZE = 20;

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
            setError(e.error || 'Error cargando pedidos');
        } finally {
            setLoading(false);
        }
    };


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

    // Carga con debounce; incluye la página actual
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            load(query, filterStatus, filterWorker, sortBy, sortOrder, page);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [query, token, filterStatus, filterWorker, sortBy, sortOrder, page]);

    const handlePageChange = (newPage1Based) => {
        setPage(newPage1Based - 1); // Pagination usa base 1
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (<div>
        <PageToolbar
            title="Pedidos"
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
                        { label: 'Mis pedidos', active: filterWorker === user.id, onClick: () => setFilterWorker(filterWorker === user.id ? '' : user.id) },
                        { label: 'Todos los pedidos', active: filterWorker === '', onClick: () => setFilterWorker('') },
                    ]
                },
                {
                    label: 'Ordenar',
                    active: sortBy !== 'createdAt' || sortOrder !== 'desc',
                    options: [
                        { label: 'Creación (reciente)', active: sortBy === 'createdAt' && sortOrder === 'desc', onClick: () => setSort('createdAt', 'desc') },
                        { label: 'Creación (antigua)', active: sortBy === 'createdAt' && sortOrder === 'asc', onClick: () => setSort('createdAt', 'asc') },
                        { label: 'Entrega (reciente)', active: sortBy === 'fechaLimite' && sortOrder === 'desc', onClick: () => setSort('fechaLimite', 'desc') },
                        { label: 'Entrega (antigua)', active: sortBy === 'fechaLimite' && sortOrder === 'asc', onClick: () => setSort('fechaLimite', 'asc') },
                        { label: 'Actualización (reciente)', active: sortBy === 'updatedAt' && sortOrder === 'desc', onClick: () => setSort('updatedAt', 'desc') },
                        { label: 'Actualización (antigua)', active: sortBy === 'updatedAt' && sortOrder === 'asc', onClick: () => setSort('updatedAt', 'asc') },
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
            No hay pedidos
            {filterStatus !== 'all' ? (filterStatus === 'pending' ? ' pendientes' : filterStatus === 'ready' ? ' listas' : ' recogidas') : ''}.
        </div>)}

        <div className="section-content">
            {tasks.map((t) => (
                <div key={t.id} className="uk-margin">
                    <PaymentSection
                        token={token}
                        orderId={t.id}
                        initialOrder={t}
                        workers={workers}
                        onPaid={() => load(query, filterStatus, filterWorker, sortBy, sortOrder, page)}
                    />
                </div>
            ))}
        </div>

        {!loading && meta && meta.totalPages > 1 && (
            <Pagination meta={meta} onPageChange={handlePageChange} />
        )}
    </div>);
}

