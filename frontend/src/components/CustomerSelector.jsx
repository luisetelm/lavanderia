import React, {useEffect, useState} from 'react';
import {fetchUsers} from '../api';

export default function CustomerSelector({
                                             searchUser,
                                             setSearchUser,
                                             selectedUser,
                                             setSelectedUser,
                                             quickFirstName,
                                             quickLastName,
                                             quickClientPhone,
                                             quickClientEmail,
                                             setQuickFirstName,
                                             setQuickLastName,
                                             setQuickClientPhone,
                                             setQuickClientEmail,
                                             token
                                         }) {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let active = true;
        setLoading(true);
        fetchUsers(token, {q: searchUser, size: 20})
            .then(res => {
                if (active) setCustomers(res.data || []);
            })
            .catch(() => {
                if (active) setCustomers([]);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [searchUser, token]);

    const quickFields = {quickFirstName, quickLastName, quickClientPhone, quickClientEmail};
    const setQuickFields = updater => {
        setQuickFirstName(updater(quickFields).quickFirstName);
        setQuickLastName(updater(quickFields).quickLastName);
        setQuickClientPhone(updater(quickFields).quickClientPhone);
        setQuickClientEmail(updater(quickFields).quickClientEmail);
    };

    return (<div className="uk-grid-medium" uk-grid="true">
        <div className="uk-width-1-1">
            <h4>Clientes</h4>

        </div>
            <div className="uk-width-1-2@s">
                <label className="uk-form-label">Buscar cliente existente</label>
                <div className="uk-search uk-search-default uk-width-1-1">
                    <span uk-search-icon="true"></span>
                    <input
                        className="uk-search-input"
                        placeholder="Buscar cliente..."
                        value={searchUser}
                        onChange={e => setSearchUser(e.target.value)}
                    />
                </div>
                <div
                    className="uk-card uk-card-default uk-card-small uk-margin-small-top uk-height-small uk-overflow-auto">
                    {loading ? (<div className="uk-text-center uk-padding-small">
                            <div uk-spinner="ratio: 1"></div>
                        </div>) : (customers.map((u) => (<div
                                key={u.id}
                                onClick={() => {
                                    setSelectedUser(u);
                                    setQuickFirstName('');
                                    setQuickLastName('');
                                    setQuickClientPhone('');
                                    setQuickClientEmail('');
                                }}
                                className={`uk-padding-small uk-link-reset uk-link-toggle ${selectedUser?.id === u.id ? 'uk-background-selected' : ''}`}
                            >
                                <div className="uk-flex uk-flex-between">
                                    <div>{u.firstName} {u.lastName}
                                        <span className={`uk-label ${{
                                            admin: 'uk-label-danger',
                                            cashier: 'uk-label-warning',
                                            worker: 'uk-label-success',
                                            customer: 'uk-label-default'
                                        }[u.role]}`}>
                                                        {{
                                                            admin: 'Admin',
                                                            cashier: 'Cajero',
                                                            worker: 'Cliente',
                                                            customer: 'Cliente'
                                                        }[u.role]}
                                                    </span>
                                    </div>
                                </div>
                        <div className="uk-text-small uk-text-muted"><span uk-icon="icon: phone; ratio: 0.8;"></span>{u.phone}</div>
                            </div>)))}
                    {!loading && customers.length === 0 && (
                        <div className="uk-text-center uk-text-muted uk-padding-small">
                            No se encontraron clientes.
                        </div>)}
                </div>
            </div>

            <div className="uk-width-1-2@s">
                <label className="uk-form-label">O crear cliente rápido</label>
                <div className="uk-form-stacked">
                    <div className="uk-margin-small">
                        <div className="uk-form-controls">
                            <input
                                className="uk-input"
                                placeholder="Nombre"
                                value={quickFirstName}
                                onChange={(e) => {
                                    setQuickFirstName(e.target.value);
                                    setSelectedUser(null);
                                }}
                            />
                        </div>
                    </div>
                    <div className="uk-margin-small">
                        <div className="uk-form-controls">
                            <input
                                className="uk-input"
                                placeholder="Apellidos"
                                value={quickLastName}
                                onChange={(e) => {
                                    setQuickLastName(e.target.value);
                                    setSelectedUser(null);
                                }}
                            />
                        </div>
                    </div>
                    <div className="uk-margin-small">
                        <div className="uk-form-controls">
                            <input
                                className="uk-input"
                                placeholder="Teléfono (obligatorio)"
                                value={quickClientPhone}
                                onChange={(e) => setQuickClientPhone(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="uk-margin-small">
                        <div className="uk-form-controls">
                            <input
                                className="uk-input"
                                placeholder="Email (opcional)"
                                value={quickClientEmail}
                                onChange={(e) => setQuickClientEmail(e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>);
}
