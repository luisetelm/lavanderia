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
        <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
                <label>Buscar cliente existente</label>
                <input
                    placeholder="Buscar cliente..."
                    value={searchUser}
                    onChange={(e) => setSearchUser(e.target.value)}
                    style={{ width: '100%' }}
                />
                <div
                    style={{
                        maxHeight: 180,
                        overflowY: 'auto',
                        marginTop: 6,
                        border: '1px solid #ccc',
                        borderRadius: 4,
                    }}
                >
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
                            style={{
                                padding: 6,
                                cursor: 'pointer',
                                background: selectedUser?.id === u.id ? '#e0e0e0' : '#fff',
                            }}
                        >
                            {u.firstName} {u.lastName} ({u.role})
                            <div style={{ fontSize: 12, color: '#555' }}>{u.phone}</div>
                        </div>
                    ))}
                    {filteredUsers.length === 0 && (
                        <div style={{ padding: 6, color: '#888' }}>Ningún cliente encontrado</div>
                    )}
                </div>
            </div>

            <div style={{ flex: 1 }}>
                <label>O crear cliente rápido</label>
                <div style={{ display: 'grid', gap: 6 }}>
                    <input
                        placeholder="Nombre"
                        value={quickFirstName}
                        onChange={(e) => {
                            setQuickFirstName(e.target.value);
                            setSelectedUser(null);
                        }}
                    />
                    <input
                        placeholder="Apellidos"
                        value={quickLastName}
                        onChange={(e) => {
                            setQuickLastName(e.target.value);
                            setSelectedUser(null);
                        }}
                    />
                    <input
                        placeholder="Teléfono (obligatorio)"
                        value={quickClientPhone}
                        onChange={(e) => setQuickClientPhone(e.target.value)}
                    />
                    <input
                        placeholder="Email (opcional)"
                        value={quickClientEmail}
                        onChange={(e) => setQuickClientEmail(e.target.value)}
                    />
                </div>
            </div>
        </div>
    );
}
