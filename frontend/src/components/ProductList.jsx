import React, { useState } from 'react';

export default function ProductList({products, searchProduct, setSearchProduct, onAdd}) {
    const [hoveredProduct, setHoveredProduct] = useState(null);
    const [serviceFilter, setServiceFilter] = useState(null);
    
    const filtered = products.filter((p) => {
        // Filtro por texto de búsqueda
        const matchesSearch = p.name.toLowerCase().includes(searchProduct.toLowerCase());
        
        // Filtro por categoría de servicio (si no hay filtro seleccionado, mostrar todos)
        const matchesService = serviceFilter === null || 
            (p.serviceOptions && p.serviceOptions[serviceFilter] === true);
            
        return matchesSearch && matchesService;
    });

    const handleFilterClick = (filter) => {
        // Si hacemos clic en el filtro actual o en "Todos" (null), volvemos a mostrar todos
        if (serviceFilter === filter) {
            setServiceFilter(null);
        } else {
            setServiceFilter(filter);
        }
    };

    return (
        <div>
            <div className={"uk-flex uk-flex-column"}>
            <h4>Productos</h4>

            <div className="uk-margin-small">
                <div className="uk-button-group">
                    <button
                        type="button"
                        className={`uk-button ${serviceFilter === null ? 'uk-button-primary' : 'uk-button-default'}`}
                        aria-pressed={serviceFilter === null}
                        onClick={() => setServiceFilter(null)}
                    >
                        Todos
                    </button>
                    <button
                        type="button"
                        className={`uk-button ${serviceFilter === 'dryWash' ? 'uk-button-primary' : 'uk-button-default'}`}
                        aria-pressed={serviceFilter === 'dryWash'}
                        onClick={() => handleFilterClick('dryWash')}
                    >
                        Seco
                    </button>
                    <button
                        type="button"
                        className={`uk-button ${serviceFilter === 'wetWash' ? 'uk-button-primary' : 'uk-button-default'}`}
                        aria-pressed={serviceFilter === 'wetWash'}
                        onClick={() => handleFilterClick('wetWash')}
                    >
                        Mojado
                    </button>
                    <button
                        type="button"
                        className={`uk-button ${serviceFilter === 'ironing' ? 'uk-button-primary' : 'uk-button-default'}`}
                        aria-pressed={serviceFilter === 'ironing'}
                        onClick={() => handleFilterClick('ironing')}
                    >
                        Plancha
                    </button>
                    <button
                        type="button"
                        className={`uk-button ${serviceFilter === 'externalService' ? 'uk-button-primary' : 'uk-button-default'}`}
                        aria-pressed={serviceFilter === 'externalService'}
                        onClick={() => handleFilterClick('externalService')}
                    >
                        Externo
                    </button>
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
                {filtered.map((p) => (
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
                            {p.serviceOptions && (
                                <div className="uk-flex uk-flex-wrap uk-margin-small-top">
                                    {p.serviceOptions.dryWash && <span className="uk-label uk-label-warning uk-margin-small-right uk-margin-small-bottom" style={{fontSize: '0.6rem'}}>Seco</span>}
                                    {p.serviceOptions.wetWash && <span className="uk-label uk-label-primary uk-margin-small-right uk-margin-small-bottom" style={{fontSize: '0.6rem'}}>Mojado</span>}
                                    {p.serviceOptions.ironing && <span className="uk-label uk-label-success uk-margin-small-right uk-margin-small-bottom" style={{fontSize: '0.6rem'}}>Plancha</span>}
                                    {p.serviceOptions.externalService && <span className="uk-label uk-label-danger uk-margin-small-right uk-margin-small-bottom" style={{fontSize: '0.6rem'}}>Externo</span>}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            
            {filtered.length === 0 && (
                <div className="uk-alert uk-alert-warning uk-margin-top">
                    <p className="uk-text-center">No hay productos con ese criterio de búsqueda.</p>
                </div>
            )}
        </div>
    );
}
