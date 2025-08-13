import React, { useState } from 'react';

export default function ProductList({products, searchProduct, setSearchProduct, onAdd}) {
    const [hoveredProduct, setHoveredProduct] = useState(null);
    
    const filtered = products.filter((p) =>
        p.name.toLowerCase().includes(searchProduct.toLowerCase())
    );

    return (
        <div>
            <h3 className="uk-card-title">Productos</h3>
            
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
            
            <div className="uk-child-width-1-2@s uk-child-width-1-4@m uk-grid-small" uk-grid="true">
                {filtered.map((p) => (
                    <div key={p.id}>
                        <div 
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
