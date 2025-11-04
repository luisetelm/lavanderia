import React, {useEffect, useState} from 'react';
import UIkit from 'uikit';
import {fetchUsers, createUser, updateUser} from '../api.js';
import Pagination from '../components/Pagination.jsx';


function UserForm({initial = {}, onSave, token, onCancel}) {
    const [form, setForm] = useState({
        firstName: initial.firstName || '',
        lastName: initial.lastName || '',
        email: initial.email || '',
        role: initial.role || 'cashier',
        phone: initial.phone || '',
        password: '',
        isActive: initial.isActive !== undefined ? Boolean(initial.isActive) : true,
        isbigclient: initial.isbigclient !== undefined ? Boolean(initial.isbigclient) : false,
        denominacionsocial: initial.denominacionsocial || '',
        nif: initial.nif || '',
        tipopersona: initial.tipopersona || '',
        direccion: initial.direccion || '',
        localidad: initial.localidad || '',
        provincia: initial.provincia || '',
        codigopostal: initial.codigopostal || '',
        pais: initial.pais || '',
    });

    console.log(form)
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        try {
            console.log(form)
            if (initial.id) {
                await updateUser(token, initial.id, form);
            } else {
                await createUser(token, form);
            }
            onSave();
        } catch (err) {
            setError(err.error || 'Fallo al guardar usuario');
        }
    };

    useEffect(() => {
        const offcanvas = UIkit.offcanvas('#offcanvas-user-form');
        const handler = () => { if (onCancel) onCancel(); };
        const el = document.getElementById('offcanvas-user-form');
        if (el) el.addEventListener('hidden', handler);
        return () => {
            if (el) el.removeEventListener('hidden', handler);
        };
    }, [onCancel]);

    return (<div>
        <h4>{initial.id ? 'Editar usuario' : 'Nuevo usuario'}</h4>

        {error && (<div className="uk-alert-danger" uk-alert="true">
            <p>{error}</p>
        </div>)}

        <form onSubmit={submit} className="uk-form-stacked">
            <div className="uk-margin">
                <label className="uk-form-label">Nombre</label>
                <div className="uk-form-controls">
                    <input
                        className="uk-input"
                        value={form.firstName}
                        onChange={e => setForm(f => ({...f, firstName: e.target.value}))}
                        required
                    />
                </div>
            </div>

            <div className="uk-margin">
                <label className="uk-form-label">Apellidos</label>
                <div className="uk-form-controls">
                    <input
                        className="uk-input"
                        value={form.lastName}
                        onChange={e => setForm(f => ({...f, lastName: e.target.value}))}
                        required
                    />
                </div>
            </div>

            <div className="uk-margin">
                <label className="uk-form-label">Email</label>
                <div className="uk-form-controls">
                    <input
                        type="email"
                        autoComplete="off"
                        className="uk-input"
                        value={form.email}
                        onChange={e => setForm(f => ({...f, email: e.target.value}))}
                    />
                </div>
            </div>

            <div className="uk-margin">
                <label className="uk-form-label">Rol</label>
                <div className="uk-form-controls">
                    <select
                        className="uk-select"
                        value={form.role}
                        onChange={e => setForm(f => ({...f, role: e.target.value}))}
                    >
                        <option value="admin">Admin</option>
                        <option value="cashier">Cajero</option>
                        <option value="worker">Trabajador</option>
                        <option value="customer">Cliente</option>
                    </select>
                </div>
            </div>

            <div className="uk-margin">
                <label className="uk-form-label">Teléfono</label>
                <div className="uk-form-controls">
                    <input
                        className="uk-input"
                        value={form.phone}
                        onChange={e => setForm(f => ({...f, phone: e.target.value}))}
                    />
                </div>
            </div>

            <div className="uk-margin">
                <label className="uk-form-label">
                    Contraseña {initial.id ? '(dejar vacío para no cambiar)' : ''}
                </label>
                <div className="uk-form-controls">
                    <input
                        autoComplete="new-password"
                        type="password"
                        className="uk-input"
                        value={form.password}
                        onChange={e => setForm(f => ({...f, password: e.target.value}))}
                    />
                </div>
            </div>

            <div className="uk-margin">
                <label>
                    <input
                        className="uk-checkbox"
                        type="checkbox"
                        checked={form.isActive}
                        onChange={e => setForm(f => ({...f, isActive: e.target.checked}))}
                    />{' '}
                    Activo
                </label>
            </div>

            <div className="uk-margin">
                <label>
                    <input
                        className="uk-checkbox"
                        type="checkbox"
                        checked={form.isbigclient}
                        onChange={e => setForm(f => ({...f, isbigclient: e.target.checked}))}
                    />{' '}
                    Tarifa Gran Cliente
                </label>
            </div>

            <div className="uk-margin">
                <label className="uk-form-label">Denominación social</label>
                <div className="uk-form-controls">
                    <input
                        className="uk-input"
                        value={form.denominacionsocial}
                        onChange={e => setForm(f => ({...f, denominacionsocial: e.target.value}))}
                    />
                </div>
            </div>
            <div className="uk-margin">
                <label className="uk-form-label">NIF</label>
                <div className="uk-form-controls">
                    <input
                        className="uk-input"
                        value={form.nif}
                        onChange={e => setForm(f => ({...f, nif: e.target.value}))}
                    />
                </div>
            </div>
            <div className="uk-margin">
                <label className="uk-form-label">Tipo de persona</label>
                <div className="uk-form-controls">
                    <select
                        className="uk-select"
                        value={form.tipopersona}
                        onChange={e => setForm(f => ({...f, tipopersona: e.target.value}))}
                    >
                        <option value="">Selecciona tipo</option>
                        <option value="Física">Física</option>
                        <option value="Jurídica">Jurídica</option>
                    </select>
                </div>
            </div>
            <div className="uk-margin">
                <label className="uk-form-label">Dirección</label>
                <div className="uk-form-controls">
                    <input
                        className="uk-input"
                        value={form.direccion}
                        onChange={e => setForm(f => ({...f, direccion: e.target.value}))}
                    />
                </div>
            </div>
            <div className="uk-margin">
                <label className="uk-form-label">Localidad</label>
                <div className="uk-form-controls">
                    <input
                        className="uk-input"
                        value={form.localidad}
                        onChange={e => setForm(f => ({...f, localidad: e.target.value}))}
                    />
                </div>
            </div>
            <div className="uk-margin">
                <label className="uk-form-label">Provincia</label>
                <div className="uk-form-controls">
                    <input
                        className="uk-input"
                        value={form.provincia}
                        onChange={e => setForm(f => ({...f, provincia: e.target.value}))}
                    />
                </div>
            </div>
            <div className="uk-margin">
                <label className="uk-form-label">Código Postal</label>
                <div className="uk-form-controls">
                    <input
                        className="uk-input"
                        value={form.codigopostal}
                        onChange={e => setForm(f => ({...f, codigopostal: e.target.value}))}
                    />
                </div>
            </div>
            <div className="uk-margin">
                <label className="uk-form-label">País</label>
                <div className="uk-form-controls">
                    <input
                        className="uk-input"
                        value={form.pais}
                        onChange={e => setForm(f => ({...f, pais: e.target.value}))}
                    />
                </div>
            </div>

            <div className="uk-margin">
                <div className="uk-flex uk-flex-left">
                    <button type="submit" className="uk-button uk-button-primary">
                        {initial.id ? 'Guardar' : 'Crear'}
                    </button>
                    {onCancel && (<button
                        type="button"
                        className="uk-button uk-button-default uk-margin-small-left"
                        onClick={onCancel}
                    >
                        Cancelar
                    </button>)}
                </div>
            </div>
        </form>
    </div>);
}

export default function Users({token}) {
    const [users, setUsers] = useState([]);
    const [filteredUsers, setFilteredUsers] = useState([]);
    const [editing, setEditing] = useState(null);
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

    useEffect(() => {
        load();
    }, [token, searchTerm, currentPage]);


    // Obtener usuarios para la página actual
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
                            uk-toggle="target: #offcanvas-user-form"
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
                                                setEditing(u);
                                                setShowNew(false);
                                            }} uk-toggle="target: #offcanvas-user-form"

                                        >
                                            <span uk-icon="pencil"></span>
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

                        {/* Offcanvas que contiene el formulario */}
                        <div id="offcanvas-user-form" uk-offcanvas="overlay: true; mode: slide; flip: true">
                            <div className="uk-offcanvas-bar">
                                <button
                                    className="uk-offcanvas-close"
                                    type="button"
                                    uk-close="true"
                                    onClick={() => {
                                        setShowNew(false);
                                        setEditing(null);
                                    }}
                                />
                                {showNew && (
                                    <UserForm
                                        token={token}
                                        onSave={() => {
                                            load();
                                            UIkit.offcanvas('#offcanvas-user-form').hide();
                                            setShowNew(false);
                                        }}
                                        onCancel={() => {
                                            UIkit.offcanvas('#offcanvas-user-form').hide();
                                            setShowNew(false);
                                        }}
                                    />
                                )}
                                {editing && (
                                    <UserForm
                                        token={token}
                                        initial={editing}
                                        onSave={() => {
                                            load();
                                            UIkit.offcanvas('#offcanvas-user-form').hide();
                                            setEditing(null);
                                        }}
                                        onCancel={() => {
                                            UIkit.offcanvas('#offcanvas-user-form').hide();
                                            setEditing(null);
                                        }}
                                    />
                                )}
                            </div>
                        </div>

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
