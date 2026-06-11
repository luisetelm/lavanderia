import React, { useState } from 'react';

function getCurrentUser() {
    try {
        const raw = localStorage.getItem('user');
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

const ROLE_LABELS = {
    admin: 'Administrador/a',
    cashier: 'Cajero/a',
    worker: 'Trabajador/a',
    customer: 'Cliente',
};

export default function PageToolbar({ title, filters, actions, children }) {
    const [filtersOpen, setFiltersOpen] = useState(false);
    const hasFilters = filters && filters.length > 0;
    const activeCount = hasFilters ? filters.filter(f => f.active).length : 0;
    const user = getCurrentUser();
    const fullName = user
        ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
        : '';
    const initials = user
        ? `${(user.firstName || '').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase()
        : '';

    return (
        <div className="page-toolbar">
            <div className="page-toolbar-top">
                <h2 className="page-toolbar-title">{title}</h2>
                <div className="page-toolbar-actions">
                    {hasFilters && (
                        <button
                            className={`uk-button uk-button-small ${activeCount > 0 ? 'uk-button-primary' : 'uk-button-default'}`}
                            onClick={() => setFiltersOpen(prev => !prev)}
                            type="button"
                        >
                            <span uk-icon="icon: settings; ratio: 0.8" style={{ marginRight: 4 }}></span>
                            Filtros{activeCount > 0 ? ` (${activeCount})` : ''}
                        </button>
                    )}
                    {actions}
                    {user && (
                        <div
                            className="page-toolbar-user"
                            title={`${fullName}${user.role ? ` · ${ROLE_LABELS[user.role] || user.role}` : ''}`}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '4px 10px 4px 4px',
                                borderRadius: 999,
                                background: '#f1f5f9',
                                border: '1px solid #e2e8f0',
                                marginLeft: 4,
                            }}
                        >
                            <span style={{
                                width: 26,
                                height: 26,
                                borderRadius: '50%',
                                background: '#048ABF',
                                color: '#fff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                flexShrink: 0,
                            }}>
                                {initials || '?'}
                            </span>
                            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1e293b' }}>
                                    {fullName || user.firstName || 'Usuario'}
                                </span>
                                {user.role && (
                                    <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
                                        {ROLE_LABELS[user.role] || user.role}
                                    </span>
                                )}
                            </span>
                        </div>
                    )}
                </div>
            </div>
            {hasFilters && filtersOpen && (
                <div className="page-toolbar-filters">
                    {filters.map((group, i) => (
                        <div key={i} className="page-toolbar-filter-group">
                            {group.label && <span className="page-toolbar-filter-label">{group.label}</span>}
                            <div className="page-toolbar-filter-options">
                                {group.options.map((opt, j) => (
                                    <button
                                        key={j}
                                        className={`page-toolbar-chip ${opt.active ? 'active' : ''}`}
                                        onClick={opt.onClick}
                                        type="button"
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {children}
        </div>
    );
}
