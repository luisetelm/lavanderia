import React from 'react';

export default function CustomerSelector({
    users,
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
}) {
    const filteredUsers = users.filter((u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchUser.toLowerCase())
    );

    return (
        <div className="uk-grid-medium" uk-grid="true">
            <div className="uk-width-1-2@s">
                <label className="uk-form-label">Buscar cliente existente</label>
                <div className="uk-search uk-search-default uk-width-1-1">
                    <span uk-search-icon="true"></span>
                    <input
                        className="uk-search-input"
                        placeholder="Buscar cliente..."
                        value={searchUser}
                        onChange={(e) => setSearchUser(e.target.value)}
                    />
                </div>
                <div className="uk-card uk-card-default uk-card-small uk-margin-small-top uk-height-small uk-overflow-auto">
                    {filteredUsers.map((u) => (
                        <div
                            key={u.id}
                            onClick={() => {
                                setSelectedUser(u);
                                setQuickFirstName('');
                                setQuickLastName('');
                                setQuickClientPhone('');
                                setQuickClientEmail('');
                            }}
                            className={`uk-padding-small uk-link-reset uk-link-toggle ${
                                selectedUser?.id === u.id ? 'uk-background-muted' : ''
                            }`}
                        >
                            <div className="uk-flex uk-flex-between">
                                <div>{u.firstName} {u.lastName} 
                                    <span className="uk-label uk-margin-small-left uk-text-small">
                                        {u.role === 'admin' ? 'Admin' : 
                                         u.role === 'cashier' ? 'Cajero' : 'Trabajador'}
                                    </span>
                                </div>
                            </div>
                            <div className="uk-text-small uk-text-muted">{u.phone}</div>
                        </div>
                    ))}
                    {filteredUsers.length === 0 && (
                        <div className="uk-padding-small uk-text-muted">Ningún cliente encontrado</div>
                    )}
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
        </div>
    );
}
