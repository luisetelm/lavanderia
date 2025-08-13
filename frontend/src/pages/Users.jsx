import React, {useEffect, useState} from 'react';
import {fetchUsers, createUser, updateUser} from '../api.js';

function UserForm({initial = {}, onSave, token, onCancel}) {
    const [form, setForm] = useState({
        firstName: initial.firstName || '',
        lastName: initial.lastName || '',
        email: initial.email || '',
        role: initial.role || 'cashier',
        phone: initial.phone || '',
        password: '',
        isActive: initial.isActive !== undefined ? initial.isActive : true,
    });
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        try {
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

    return (
        <div className="uk-card uk-card-default uk-card-body">
            <h4 className="uk-card-title">{initial.id ? 'Editar usuario' : 'Nuevo usuario'}</h4>

            {error && (
                <div className="uk-alert-danger" uk-alert="true">
                    <p>{error}</p>
                </div>
            )}

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
                            className="uk-input"
                            value={form.email}
                            onChange={e => setForm(f => ({...f, email: e.target.value}))}
                            required
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
                    <div className="uk-flex uk-flex-left">
                        <button type="submit" className="uk-button uk-button-primary">
                            {initial.id ? 'Guardar' : 'Crear'}
                        </button>
                        {onCancel && (
                            <button
                                type="button"
                                className="uk-button uk-button-default uk-margin-small-left"
                                onClick={onCancel}
                            >
                                Cancelar
                            </button>
                        )}
                    </div>
                </div>
            </form>
        </div>
    );
}

export default function Users({token}) {
    const [users, setUsers] = useState([]);
    const [filteredUsers, setFilteredUsers] = useState([]);
    const [editing, setEditing] = useState(null);
    const [showNew, setShowNew] = useState(false);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(false);
    const usersPerPage = 10; // Mostramos 10 usuarios por página en la interfaz

    const load = async () => {
        setLoading(true);
        try {
            const u = await fetchUsers(token);
            setUsers(u);
            setFilteredUsers(u);
            setTotalPages(Math.ceil(u.length / usersPerPage));
        } catch (e) {
            setError('No se pudieron cargar usuarios');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [token]);

    useEffect(() => {
        if (searchTerm) {
            const lowercaseTerm = searchTerm.toLowerCase();
            const filtered = users.filter(
                user => 
                    user.firstName.toLowerCase().includes(lowercaseTerm) ||
                    user.lastName.toLowerCase().includes(lowercaseTerm) ||
                    user.email.toLowerCase().includes(lowercaseTerm) ||
                    user.role.toLowerCase().includes(lowercaseTerm)
            );
            setFilteredUsers(filtered);
            setTotalPages(Math.ceil(filtered.length / usersPerPage));
            setCurrentPage(1); // Reiniciar a la primera página cuando se busca
        } else {
            setFilteredUsers(users);
            setTotalPages(Math.ceil(users.length / usersPerPage));
        }
    }, [searchTerm, users]);

    // Obtener usuarios para la página actual
    const getCurrentPageUsers = () => {
        const startIndex = (currentPage - 1) * usersPerPage;
        const endIndex = startIndex + usersPerPage;
        return filteredUsers.slice(startIndex, endIndex);
    };

    const handleSearch = (e) => {
        setSearchTerm(e.target.value);
    };

    const handlePageChange = (page) => {
        setCurrentPage(page);
    };

    return (
        <div>
            <div className={'section-header uk-margin'}>
                <h2>Usuarios</h2>
            </div>

            <div className="section-content uk-grid-divider uk-grid-medium" uk-grid="true">
                {/* Columna de listado de usuarios */}
                <div className={`uk-width-${showNew || editing ? '3-4' : '1-1'}@m`}>
                    <div className="uk-card uk-card-default uk-card-body">
                        <div className="uk-flex uk-flex-between uk-flex-middle uk-margin-bottom">
                            <div className="uk-search uk-search-default uk-width-medium">
                                <span uk-search-icon="true"></span>
                                <input 
                                    className="uk-search-input" 
                                    type="search" 
                                    placeholder="Buscar usuarios..." 
                                    value={searchTerm}
                                    onChange={handleSearch}
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

                        {error && (
                            <div className="uk-alert-danger" uk-alert="true">
                                <p>{error}</p>
                            </div>
                        )}

                        {loading ? (
                            <div className="uk-text-center uk-padding">
                                <div uk-spinner="ratio: 1"></div>
                                <p>Cargando usuarios...</p>
                            </div>
                        ) : (
                            <>
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
                                            {getCurrentPageUsers().map(u => (
                                                <tr key={u.id}>
                                                    <td>{u.firstName} {u.lastName}</td>
                                                    <td>{u.email}</td>
                                                    <td>
                                                        <span className={`uk-label ${
                                                            u.role === 'admin' ? 'uk-label-danger' : 
                                                            u.role === 'cashier' ? 'uk-label-warning' : 'uk-label-success'
                                                        }`}>
                                                            {u.role === 'admin' ? 'Admin' : 
                                                             u.role === 'cashier' ? 'Cajero' : 'Trabajador'}
                                                        </span>
                                                    </td>
                                                    <td>{u.phone || '-'}</td>
                                                    <td>
                                                        <span className={`uk-label ${u.isActive ? 'uk-label-success' : 'uk-label-danger'}`}>
                                                            {u.isActive ? 'Activo' : 'Inactivo'}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <button
                                                            className="uk-button uk-button-primary uk-button-small"
                                                            onClick={() => {
                                                                setEditing(u);
                                                                setShowNew(false);
                                                            }}
                                                        >
                                                            <span uk-icon="pencil"></span>
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {getCurrentPageUsers().length === 0 && (
                                                <tr>
                                                    <td colSpan="6" className="uk-text-center uk-text-muted">
                                                        {searchTerm ? 'No se encontraron usuarios con esa búsqueda.' : 'No hay usuarios.'}
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Paginación */}
                                {totalPages > 1 && (
                                    <ul className="uk-pagination uk-flex-center uk-margin-medium-top">
                                        <li className={currentPage === 1 ? 'uk-disabled' : ''}>
                                            <a href="#" onClick={(e) => {
                                                e.preventDefault();
                                                if (currentPage > 1) handlePageChange(currentPage - 1);
                                            }}>
                                                <span uk-pagination-previous="true"></span>
                                            </a>
                                        </li>
                                        
                                        {Array.from({ length: totalPages }).map((_, i) => (
                                            <li key={i} className={currentPage === i + 1 ? 'uk-active' : ''}>
                                                <a href="#" onClick={(e) => {
                                                    e.preventDefault();
                                                    handlePageChange(i + 1);
                                                }}>
                                                    {i + 1}
                                                </a>
                                            </li>
                                        ))}
                                        
                                        <li className={currentPage === totalPages ? 'uk-disabled' : ''}>
                                            <a href="#" onClick={(e) => {
                                                e.preventDefault();
                                                if (currentPage < totalPages) handlePageChange(currentPage + 1);
                                            }}>
                                                <span uk-pagination-next="true"></span>
                                            </a>
                                        </li>
                                    </ul>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Columna de formulario (aparece cuando se edita o crea un usuario) */}
                {(showNew || editing) && (
                    <div className="uk-width-1-4@m">
                        {showNew && (
                            <UserForm
                                token={token}
                                onSave={() => {
                                    load();
                                    setShowNew(false);
                                }}
                                onCancel={() => setShowNew(false)}
                            />
                        )}

                        {editing && (
                            <UserForm
                                token={token}
                                initial={editing}
                                onSave={() => {
                                    load();
                                    setEditing(null);
                                }}
                                onCancel={() => setEditing(null)}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
