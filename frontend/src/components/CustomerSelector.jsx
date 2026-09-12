import React, {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {fetchUsers} from '../api';
import './CustomerSelector.css';

const ROLE_LABEL = { admin: 'Admin', cashier: 'Cajero', worker: 'Trabajador', customer: 'Cliente' };
const ROLE_CLASS = { admin: 'uk-label-danger', cashier: 'uk-label-warning', worker: 'uk-label-success', customer: 'uk-label-default' };
const NOTIFY_LABEL = { whatsapp: 'Avisos por WhatsApp', sms: 'Avisos por SMS', none: 'No quiere avisos' };
const isValidSpanishPhone = (phone) => /^[6789]\d{8}$/.test(phone);
const initials = (u) => `${(u.firstName || '').charAt(0)}${(u.lastName || '').charAt(0)}`.toUpperCase() || '?';

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

    const hasQuick = !!(quickFirstName || quickLastName || quickClientPhone || quickClientEmail);
    const [mode, setMode] = useState(hasQuick ? 'new' : 'search'); // 'search' | 'new'
    useEffect(() => { if (hasQuick) setMode('new'); }, [hasQuick]);

    // Búsqueda con un pequeño retardo para no lanzar una petición por tecla
    useEffect(() => {
        if (selectedUser) return;
        let active = true;
        setLoading(true);
        const t = setTimeout(() => {
            fetchUsers(token, {q: searchUser, size: 20})
                .then(res => { if (active) setCustomers(res.data || []); })
                .catch(() => { if (active) setCustomers([]); })
                .finally(() => { if (active) setLoading(false); });
        }, searchUser ? 250 : 0);
        return () => { active = false; clearTimeout(t); };
    }, [searchUser, token, selectedUser]);

    /* ── Cliente ya elegido: ficha resumida ── */
    if (selectedUser) {
        const u = selectedUser;
        const discount = Number(u.discount || 0);
        return (
            <div className="cs cs-selected">
                <div className="cs-avatar">{initials(u)}</div>
                <div className="cs-selected-body">
                    <div className="cs-selected-name">
                        {u.firstName} {u.lastName}
                        {u.role && u.role !== 'customer' && (
                            <span className={`uk-label ${ROLE_CLASS[u.role] || 'uk-label-default'}`}>{ROLE_LABEL[u.role] || u.role}</span>
                        )}
                    </div>
                    <div className="cs-selected-meta">
                        {u.phone && <span><span uk-icon="icon: receiver; ratio: 0.65"></span>{u.phone}</span>}
                        {u.email && <span><span uk-icon="icon: mail; ratio: 0.65"></span>{u.email}</span>}
                    </div>
                    {(u.isbigclient || discount > 0 || u.notifyChannel) && (
                        <div className="cs-selected-tags">
                            {u.isbigclient && <span className="cs-tag cs-tag-big">Gran cliente</span>}
                            {discount > 0 && <span className="cs-tag cs-tag-dto">−{discount}% dto.</span>}
                            {u.notifyChannel && <span className="cs-tag">{NOTIFY_LABEL[u.notifyChannel] || u.notifyChannel}</span>}
                        </div>
                    )}
                </div>
                <div className="cs-selected-actions">
                    <button type="button" className="uk-button uk-button-default uk-button-small"
                            onClick={() => setSelectedUser(null)}>
                        Cambiar
                    </button>
                    <Link to={`/usuarios/${u.id}`} className="cs-link">Ver ficha</Link>
                </div>
            </div>
        );
    }

    /* ── Sin cliente: buscar o crear rápido ── */
    const phoneInvalid = quickClientPhone && !isValidSpanishPhone(quickClientPhone);

    return (
        <div className="cs">
            <div className="cs-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'search'}
                        className={`cs-tab ${mode === 'search' ? 'is-active' : ''}`}
                        onClick={() => setMode('search')}>
                    <span uk-icon="icon: search; ratio: 0.75"></span> Buscar cliente
                </button>
                <button type="button" role="tab" aria-selected={mode === 'new'}
                        className={`cs-tab ${mode === 'new' ? 'is-active' : ''}`}
                        onClick={() => setMode('new')}>
                    <span uk-icon="icon: plus; ratio: 0.75"></span> Cliente nuevo
                    {hasQuick && <span className="cs-tab-dot" title="Hay datos escritos"></span>}
                </button>
            </div>

            {mode === 'search' ? (
                <div className="cs-search">
                    <div className="uk-search uk-search-default uk-width-1-1">
                        <span uk-search-icon="true"></span>
                        <input
                            className="uk-search-input"
                            placeholder="Nombre, apellidos o teléfono…"
                            value={searchUser}
                            onChange={e => setSearchUser(e.target.value)}
                            autoComplete="off"
                        />
                    </div>
                    <div className="cs-results">
                        {loading && customers.length === 0 ? (
                            <div className="cs-results-empty"><div uk-spinner="ratio: 0.7"></div></div>
                        ) : customers.length === 0 ? (
                            <div className="cs-results-empty">
                                No se encontraron clientes.
                                <button type="button" className="cs-link" onClick={() => setMode('new')}>Crear cliente nuevo</button>
                            </div>
                        ) : customers.map(u => (
                            <button type="button" key={u.id} className="cs-result" onClick={() => setSelectedUser(u)}>
                                <span className="cs-avatar cs-avatar-sm">{initials(u)}</span>
                                <span className="cs-result-body">
                                    <span className="cs-result-name">
                                        {u.firstName} {u.lastName}
                                        {u.role && u.role !== 'customer' && (
                                            <span className={`uk-label ${ROLE_CLASS[u.role] || 'uk-label-default'}`}>{ROLE_LABEL[u.role] || u.role}</span>
                                        )}
                                        {u.isbigclient && <span className="cs-tag cs-tag-big">Gran cliente</span>}
                                    </span>
                                    <span className="cs-result-meta">{u.phone || 'sin teléfono'}{u.email ? ` · ${u.email}` : ''}</span>
                                </span>
                                <span className="cs-result-go" uk-icon="icon: chevron-right; ratio: 0.8"></span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="cs-new">
                    <div className="cs-new-grid">
                        <input className="uk-input" placeholder="Nombre" value={quickFirstName}
                               onChange={(e) => setQuickFirstName(e.target.value)}/>
                        <input className="uk-input" placeholder="Apellidos" value={quickLastName}
                               onChange={(e) => setQuickLastName(e.target.value)}/>
                        <div>
                            <input className={`uk-input ${phoneInvalid ? 'uk-form-danger' : ''}`}
                                   placeholder="Teléfono (obligatorio)" inputMode="tel" value={quickClientPhone}
                                   onChange={(e) => setQuickClientPhone(e.target.value)}/>
                            {phoneInvalid && <div className="cs-hint cs-hint-error">Teléfono móvil o fijo español de 9 cifras</div>}
                        </div>
                        <input className="uk-input" placeholder="Email (opcional)" type="email" value={quickClientEmail}
                               onChange={(e) => setQuickClientEmail(e.target.value)}/>
                    </div>
                    <div className="cs-hint">Se creará al validar el pedido. Si ya existe un cliente con ese teléfono, usa «Buscar cliente».</div>
                </div>
            )}
        </div>
    );
}
