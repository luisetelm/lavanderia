import React, {useState, useMemo} from 'react';
import './ProductList.css';

// Catálogo de productos del POS: filtros por itinerario, buscador y rejilla.
// `cartCounts` = { [productId]: unidades ya en el pedido } para marcar las tarjetas.
// `agreedPriceFor(productId)` = precio pactado del cliente elegido o null; si lo hay, se enseña en lugar del normal.
export default function ProductList({products, searchProduct, setSearchProduct, onAdd, itineraries = [], cartCounts = {}, agreedPriceFor = null}) {
    const [itineraryFilter, setItineraryFilter] = useState(null); // null = todos

    // Itinerarios que realmente usa algún producto
    const usedItineraries = useMemo(() => {
        const ids = [...new Set(products.filter(p => p.itineraryId).map(p => p.itineraryId))];
        return itineraries.filter(it => ids.includes(it.id));
    }, [products, itineraries]);

    const q = searchProduct.trim().toLowerCase();
    const filtered = products.filter((p) => {
        const matchesSearch = !q || p.name.toLowerCase().includes(q);
        const matchesItinerary = itineraryFilter === null || p.itineraryId === itineraryFilter;
        return matchesSearch && matchesItinerary;
    });

    const itineraryName = (p) => p.itineraryId ? (itineraries.find(i => i.id === p.itineraryId)?.name || null) : null;

    return (
        <div className="pl">
            <div className="pl-tools">
                <div className="uk-search uk-search-default pl-search">
                    <span uk-search-icon="true"></span>
                    <input
                        className="uk-search-input"
                        placeholder="Buscar producto…"
                        value={searchProduct}
                        onChange={(e) => setSearchProduct(e.target.value)}
                        autoComplete="off"
                    />
                    {searchProduct && (
                        <button type="button" className="pl-search-clear" aria-label="Limpiar búsqueda"
                                onClick={() => setSearchProduct('')}>×</button>
                    )}
                </div>
                <div className="pl-filters">
                    <button type="button"
                            className={`pl-filter ${itineraryFilter === null ? 'is-active' : ''}`}
                            onClick={() => setItineraryFilter(null)}>
                        Todos
                    </button>
                    {usedItineraries.map(it => (
                        <button key={it.id} type="button"
                                className={`pl-filter ${itineraryFilter === it.id ? 'is-active' : ''}`}
                                onClick={() => setItineraryFilter(itineraryFilter === it.id ? null : it.id)}>
                            {it.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="pl-grid-wrap">
                {filtered.length === 0 ? (
                    <div className="pl-empty">No hay productos con ese criterio de búsqueda.</div>
                ) : (
                    <div className="pl-grid">
                        {filtered.map((p) => {
                            const itin = itineraryName(p);
                            const inCart = cartCounts[p.id] || 0;
                            const pactado = agreedPriceFor ? agreedPriceFor(p.id) : null;
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    className={`pl-item ${inCart > 0 ? 'is-in-cart' : ''}`}
                                    onClick={() => onAdd(p)}
                                    uk-tooltip={p.description || undefined}
                                >
                                    <span className="pl-item-name">{p.name}</span>
                                    <span className="pl-item-price">
                                        {Number(pactado ?? p.basePrice).toFixed(2)} €
                                        {pactado !== null && <em className="pl-item-agreed" title="Precio pactado con este cliente">pactado</em>}
                                    </span>
                                    {itin && <span className="pl-item-itin">{itin}</span>}
                                    {inCart > 0 && <span className="pl-item-count" title="Unidades en el pedido">{inCart}</span>}
                                    <span className="pl-item-add" aria-hidden="true">+</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
            <div className="pl-foot">
                {filtered.length} de {products.length} producto{products.length !== 1 ? 's' : ''}
                {q || itineraryFilter !== null ? (
                    <button type="button" className="pl-link" onClick={() => { setSearchProduct(''); setItineraryFilter(null); }}>
                        Quitar filtros
                    </button>
                ) : null}
            </div>
        </div>
    );
}
