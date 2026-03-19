import React, {useEffect, useState} from 'react';
import UIkit from 'uikit';
import {fetchUsers, updateUser} from '../api.js';
import Pagination from '../components/Pagination.jsx';
import { useNavigate } from 'react-router-dom';
import UserForm from '../components/UserForm.jsx';
import PageToolbar from '../components/PageToolbar.jsx';


function Users({token, user: loggedUser}) {
    const [users, setUsers] = useState([]);
    const [showNew, setShowNew] = useState(false);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const usersPerPage = 50;

    const [paginationMeta, setPaginationMeta] = useState({
        page: 0, totalPages: 1, hasPrevPage: false, hasNextPage: false
    });

    const navigate = useNavigate();

    const load = async () => {
        setLoading(true);
        try {
            const {data, meta} = await fetchUsers(token, {
                q: searchTerm, page: currentPage - 1, size: usersPerPage
            });
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

    const saveDiscount = async (user, value) => {
        const d = Number(value);
        if (isNaN(d) || d < 0 || d > 100) {
            UIkit.notification({message: 'El descuento debe estar entre 0 y 100', status: 'warning'});
            return;
        }
        try {
            await updateUser(token, user.id, { discount: d });
            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, discount: d } : u));
            UIkit.notification({message: 'Descuento actualizado', status: 'success'});
        } catch (e) {
            UIkit.notification({message: e.error || 'Error actualizando descuento', status: 'danger'});
        }
    };

    return (
        <div>
            <PageToolbar
                title="Usuarios"
                actions={
                    <button
                        className="uk-button uk-button-primary"
                        uk-toggle="target: #offcanvas-user-form"
                        onClick={() => setShowNew(true)}
                    >
                        <span uk-icon="plus"></span> Nuevo usuario
                    </button>
                }
            />

            <div>
                    <div className="uk-card uk-card-default uk-card-body">
                        <div className="uk-margin-bottom">
                            <div className="uk-search uk-search-default" style={{width: '100%', maxWidth: 300}}>
                                <span uk-search-icon="true"></span>
                                <input
                                    className="uk-search-input"
                                    placeholder="Buscar por nombre, apellidos, email o teléfono..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        {error && (<div className="uk-alert-danger" uk-alert="true">
                            <p>{error}</p>
                        </div>)}

                        {loading ? (
                            <div className="uk-text-center uk-padding">
                                <div uk-spinner="ratio: 1"></div>
                                <p>Cargando usuarios...</p>
                            </div>
                        ) : (
                            <>
                                {/* Tabla desktop */}
                                <div className="uk-overflow-auto uk-visible@m">
                                    <table className="uk-table uk-table-divider uk-table-middle uk-table-hover" style={{minWidth: 700}}>
                                        <thead>
                                        <tr>
                                            <th>Nombre</th>
                                            <th>Email</th>
                                            <th>Rol</th>
                                            <th>Teléfono</th>
                                            <th>Estado</th>
                                            <th style={{width: 100}}>Dto. (%)</th>
                                            <th></th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {users.map(u => (
                                            <tr key={u.id}>
                                                <td>
                                                    {u.firstName} {u.lastName}
                                                    {u.autoMonthlyInvoice && (
                                                        <span className="uk-label uk-label-primary"
                                                            style={{ fontSize: '0.6em', marginLeft: 6, verticalAlign: 'middle' }}
                                                            title="Facturación automática mensual">
                                                            Auto-fact.
                                                        </span>
                                                    )}
                                                </td>
                                                <td style={{fontSize: '0.85rem'}}>{u.email || '-'}</td>
                                                <td>
                                                    <span className={`uk-label ${{
                                                        admin: 'uk-label-danger', cashier: 'uk-label-warning',
                                                        worker: 'uk-label-success', customer: 'uk-label-default'
                                                    }[u.role]}`}>
                                                        {{admin:'Admin',cashier:'Cajero',worker:'Trabajador',customer:'Cliente'}[u.role]}
                                                    </span>
                                                </td>
                                                <td>{u.phone || '-'}</td>
                                                <td>
                                                    <span className={`uk-label ${u.isActive ? 'uk-label-success' : 'uk-label-danger'}`}>
                                                        {u.isActive ? 'Activo' : 'Inactivo'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <input type="number" min={0} max={100} step={1}
                                                        className="uk-input uk-form-small" style={{width: 70}}
                                                        value={typeof u.discount === 'number' ? u.discount : (u.discount ? Number(u.discount) : 0)}
                                                        onChange={(e) => setUsers(prev => prev.map(x => x.id === u.id ? { ...x, discount: e.target.value } : x))}
                                                        onBlur={(e) => saveDiscount(u, e.target.value)}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') { saveDiscount(u, e.currentTarget.value); e.currentTarget.blur(); } }}
                                                    />
                                                </td>
                                                <td>
                                                    <button className="uk-button uk-button-primary uk-button-small"
                                                        onClick={() => navigate(`/usuarios/${u.id}`)}>
                                                        <span uk-icon="pencil"></span>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {users.length === 0 && (
                                            <tr><td colSpan="7" className="uk-text-center uk-text-muted">
                                                {searchTerm ? 'Sin resultados.' : 'No hay usuarios.'}
                                            </td></tr>
                                        )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Cards móvil */}
                                <div className="uk-hidden@m">
                                    {users.map(u => (
                                        <div key={u.id} onClick={() => navigate(`/usuarios/${u.id}`)}
                                             style={{
                                                 padding: '12px 0', borderBottom: '1px solid #e2e8f0',
                                                 cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                             }}>
                                            <div>
                                                <div style={{fontWeight: 600, fontSize: '0.9rem'}}>
                                                    {u.firstName} {u.lastName}
                                                    {u.autoMonthlyInvoice && (
                                                        <span className="uk-label uk-label-primary"
                                                            style={{fontSize: '0.55em', marginLeft: 4, verticalAlign: 'middle'}}>
                                                            Auto-fact.
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{fontSize: '0.8rem', color: '#64748b', marginTop: 2}}>
                                                    {u.phone || u.email || '-'}
                                                </div>
                                            </div>
                                            <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                                                <span className={`uk-label ${{
                                                    admin: 'uk-label-danger', cashier: 'uk-label-warning',
                                                    worker: 'uk-label-success', customer: 'uk-label-default'
                                                }[u.role]}`} style={{fontSize: '0.6rem'}}>
                                                    {{admin:'Admin',cashier:'Cajero',worker:'Trabajador',customer:'Cliente'}[u.role]}
                                                </span>
                                                <span uk-icon="icon: chevron-right; ratio: 0.8" style={{color: '#94a3b8'}}></span>
                                            </div>
                                        </div>
                                    ))}
                                    {users.length === 0 && (
                                        <div style={{textAlign: 'center', padding: 20, color: '#94a3b8'}}>
                                            {searchTerm ? 'Sin resultados.' : 'No hay usuarios.'}
                                        </div>
                                    )}
                                </div>

                                <div id="offcanvas-user-form" uk-offcanvas="overlay: true; mode: slide; flip: true">
                                    <div className="uk-offcanvas-bar">
                                        <button
                                            className="uk-offcanvas-close"
                                            type="button"
                                            uk-close="true"
                                            onClick={() => setShowNew(false)}
                                        />
                                        {showNew && (
                                            <UserForm
                                                token={token}
                                                loggedUser={loggedUser}
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
                                    </div>
                                </div>

                                {paginationMeta.totalPages > 1 && (
                                    <Pagination
                                        meta={paginationMeta}
                                        onPageChange={page => setCurrentPage(page)}
                                    />
                                )}

                            </>
                        )}
                    </div>
            </div>
        </div>
    );
}

export default Users;
