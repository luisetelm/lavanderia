import React, { useState, useMemo } from 'react';

export default function ProductList({products, searchProduct, setSearchProduct, onAdd, itineraries = []}) {
    const [hoveredProduct, setHoveredProduct] = useState(null);
    const [itineraryFilter, setItineraryFilter] = useState(null); // null = todos

    // Obtener la lista única de itinerarios usados por productos
    const usedItineraries = useMemo(() => {
        const ids = [...new Set(products.filter(p => p.itineraryId).map(p => p.itineraryId))];
        return itineraries.filter(it => ids.includes(it.id));
    }, [products, itineraries]);

    const filtered = products.filter((p) => {
        const matchesSearch = p.name.toLowerCase().includes(searchProduct.toLowerCase());
        const matchesItinerary = itineraryFilter === null || p.itineraryId === itineraryFilter;
        return matchesSearch && matchesItinerary;
    });

    const getItineraryName = (product) => {
        if (!product.itineraryId) return null;
        const it = itineraries.find(i => i.id === product.itineraryId);
        return it?.name || null;
    };

    return (
        <div>
            <div className={"uk-flex uk-flex-column"}>
            <h4>Productos</h4>

            <div className="uk-margin-small">
                <div style={{display: 'flex', flexWrap: 'wrap', gap: 4}}>
                    <button
                        type="button"
                        className={`uk-button uk-button-small ${itineraryFilter === null ? 'uk-button-primary' : 'uk-button-default'}`}
                        onClick={() => setItineraryFilter(null)}
                    >
                        Todos
                    </button>
                    {usedItineraries.map(it => (
                        <button
                            key={it.id}
                            type="button"
                            className={`uk-button uk-button-small ${itineraryFilter === it.id ? 'uk-button-primary' : 'uk-button-default'}`}
                            onClick={() => setItineraryFilter(itineraryFilter === it.id ? null : it.id)}
                        >
                            {it.name}
                        </button>
                    ))}
                </div>
            </div>

        </div>

            <div className="uk-margin-small">
                <div className="uk-search uk-search-default uk-width-1-1">
                    <span uk-search-icon="true"></span>
                    <input
                        className="uk-search-input"
                        placeholder="Buscar producto..."
                        value={searchProduct}
                        onChange={(e) => setSearchProduct(e.target.value)}
                    />
                </div>
            </div>
            

            <div className="uk-child-width-1-2@s uk-child-width-1-4@m uk-grid-small" uk-grid="true" >
                {filtered.map((p) => {
                    const itinName = getItineraryName(p);
                    return (
                        <div key={p.id}>
                            <div
                                uk-tooltip={p.description}
                                className={`uk-card uk-card-small uk-card-hover uk-card-default uk-card-body uk-padding-small ${
                                    hoveredProduct === p.id ? 'uk-box-shadow-medium' : ''
                                }`}
                                onClick={() => onAdd(p)}
                                onMouseEnter={() => setHoveredProduct(p.id)}
                                onMouseLeave={() => setHoveredProduct(null)}
                            >
                                <div className="uk-card-title uk-margin-remove-bottom uk-text-small">
                                    {p.name}
                                </div>
                                <div className={`uk-text-small ${hoveredProduct === p.id ? 'uk-text-primary' : 'uk-text-muted'}`}>
                                    {p.basePrice.toFixed(2)} €
                                </div>
                                {itinName && (
                                    <div className="uk-margin-small-top">
                                        <span className="uk-label uk-margin-small-right" style={{fontSize: '0.6rem', background: '#3b82f6'}}>{itinName}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            
            {filtered.length === 0 && (
                <div className="uk-alert uk-alert-warning uk-margin-top">
                    <p className="uk-text-center">No hay productos con ese criterio de búsqueda.</p>
                </div>
            )}
        </div>
    );
}
