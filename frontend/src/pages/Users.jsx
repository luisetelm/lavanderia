import React, {useEffect, useState} from 'react';
import {fetchUsers} from '../api.js';
import Pagination from '../components/Pagination.jsx';
import UserDetailModal from '../components/UserDetailModal.jsx';


export default function Users({token}) {
    const [users, setUsers] = useState([]);
    const [filteredUsers, setFilteredUsers] = useState([]);
    const [editing, setEditing] = useState(null);
    const [loadingUser, setLoadingUser] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const usersPerPage = 50; // Mostramos 10 usuarios por página en la interfaz

    const [paginationMeta, setPaginationMeta] = useState({
        page: 0, totalPages: 1, hasPrevPage: false, hasNextPage: false
    });

    const load = async () => {
        setLoading(true);
        try {
            const {data, meta} = await fetchUsers(token, {
                q: searchTerm, page: currentPage - 1, size: usersPerPage
            });
            console.log(users, meta);
            setUsers(data);
            setPaginationMeta(meta);
        } catch {
            setError('No se pudieron cargar usuarios');
        } finally {
            setLoading(false);
        }
    };

    // Función para cargar usuario completo con pedidos (ahora solo abre el modal con el id)
    const loadUserWithOrders = async (userId) => {
        setLoadingUser(true);
        try {
            setEditing({ id: userId });
        } finally {
            setLoadingUser(false);
        }
    };

    useEffect(() => {
        load();
    }, [token, searchTerm, currentPage]);

    // Obtener usuarios para la página current
    const getCurrentPageUsers = () => {
        const startIndex = (currentPage - 1) * usersPerPage;
        const endIndex = startIndex + usersPerPage;
        return Array.isArray(filteredUsers) ? filteredUsers.slice(startIndex, endIndex)   // 2) Guard para array
            : [];
    };

    const handleSearch = (e) => {
        setSearchTerm(e.target.value);
    };

    const handlePageChange = (page) => {
        setCurrentPage(page);
    };

    return (<div>
        <div className={'section-header uk-margin'}>
            <h2>Usuarios</h2>
        </div>

        <div className="section-content uk-grid-divider uk-grid-medium" uk-grid="true">
            {/* Columna de listado de usuarios */}
            <div className={`uk-width-1-1`}>
                <div className="uk-card uk-card-default uk-card-body">
                    <div className="uk-flex uk-flex-between uk-flex-middle uk-margin-bottom">
                        <div className="uk-search uk-search-default uk-width-medium">
                            <span uk-search-icon="true"></span>
                            <input
                                className="uk-search-input"
                                placeholder="Buscar..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button
                            className="uk-button uk-button-primary"
                            onClick={() => {
                                setShowNew(true);
                                setEditing(null);
                            }}
                        >
                            <span uk-icon="plus"></span> Nuevo usuario
                        </button>
                    </div>

                    {error && (<div className="uk-alert-danger" uk-alert="true">
                        <p>{error}</p>
                    </div>)}

                    {loading ? (<div className="uk-text-center uk-padding">
                        <div uk-spinner="ratio: 1"></div>
                        <p>Cargando usuarios...</p>
                    </div>) : (<>
                        <div className="uk-overflow-auto">
                            <table className="uk-table uk-table-divider uk-table-middle uk-table-hover">
                                <thead>
                                <tr>
                                    <th>Nombre</th>
                                    <th>Email</th>
                                    <th>Rol</th>
                                    <th>Teléfono</th>
                                    <th>Estado</th>
                                    <th>Acciones</th>
                                </tr>
                                </thead>
                                <tbody>
                                {users.map(u => (<tr key={u.id}>
                                    <td>{u.firstName} {u.lastName}</td>
                                    <td>{u.email}</td>
                                    <td>
                                                    <span className={`uk-label ${{
                                                        admin: 'uk-label-danger',
                                                        cashier: 'uk-label-warning',
                                                        worker: 'uk-label-success',
                                                        customer: 'uk-label-default'
                                                    }[u.role]}`}>
                                                        {{
                                                            admin: 'Admin',
                                                            cashier: 'Cajero',
                                                            worker: 'Trabajador',
                                                            customer: 'Cliente'
                                                        }[u.role]}
                                                    </span>


                                    </td>
                                    <td>{u.phone || '-'}</td>
                                    <td>
                                                        <span
                                                            className={`uk-label ${u.isActive ? 'uk-label-success' : 'uk-label-danger'}`}>
                                                            {u.isActive ? 'Activo' : 'Inactivo'}
                                                        </span>
                                    </td>
                                    <td>
                                        <button
                                            className="uk-button uk-button-primary uk-button-small"
                                            onClick={() => {
                                                setShowNew(false);
                                                loadUserWithOrders(u.id);
                                            }}
                                            disabled={loadingUser}
                                        >
                                            {loadingUser ? <div uk-spinner="ratio: 0.6"></div> : <span uk-icon="pencil"></span>}
                                        </button>
                                    </td>
                                </tr>))}
                                {users.length === 0 && (<tr>
                                    <td colSpan="6" className="uk-text-center uk-text-muted">
                                        {searchTerm ? 'No se encontraron usuarios con esa búsqueda.' : 'No hay usuarios.'}
                                    </td>
                                </tr>)}
                                </tbody>
                            </table>
                        </div>

                        {/* Modal a pantalla completa (componente) */}
                        <UserDetailModal
                            open={showNew || !!editing}
                            token={token}
                            userId={editing?.id}
                            isNew={!!showNew}
                            onClose={() => {
                                setShowNew(false);
                                setEditing(null);
                            }}
                            onSaved={async () => {
                                await load();
                                setShowNew(false);
                                setEditing(null);
                            }}
                        />

                        {paginationMeta.totalPages > 1 && (<Pagination
                            meta={paginationMeta}
                            onPageChange={page => setCurrentPage(page)}
                        />)}

                    </>)}
                </div>
            </div>


        </div>
    </div>);
}
