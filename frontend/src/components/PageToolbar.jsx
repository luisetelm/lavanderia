import React, { useState } from 'react';

export default function PageToolbar({ title, filters, actions, children }) {
    const [filtersOpen, setFiltersOpen] = useState(false);
    const hasFilters = filters && filters.length > 0;
    const activeCount = hasFilters ? filters.filter(f => f.active).length : 0;

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
