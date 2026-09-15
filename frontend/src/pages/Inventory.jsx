import React, {useEffect, useState, useMemo} from 'react';
import {Link} from 'react-router-dom';
import {fetchProducts, updateProduct, fetchItineraries} from '../api.js';
import ProductModal from '../components/ProductModal.jsx';
import PageToolbar from '../components/PageToolbar.jsx';

function formatPrice(val) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "-";
    return `${Number(val).toFixed(2)} €`;
}

function formatPriceWithTax(val, taxPct = 21) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "-";
    const priceWithTax = Number(val);
    if (priceWithTax === 0) return "0,00 €";
    const netBase = priceWithTax / (1 + taxPct / 100);
    const fmtNet = netBase.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtTotal = priceWithTax.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (
        <span>
            <strong>{fmtTotal} €</strong> <span style={{ color: '#94a3b8', fontSize: '0.75em' }}>({fmtNet} + {taxPct}%)</span>
        </span>
    );
}

function formatWeight(val) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "-";
    return `${Number(val)} kg`;
}

export default function Inventory({ token, user }) {
    // Sólo administración crea o modifica productos; el resto consulta y abre la ficha.
    const esAdmin = user?.role === 'admin';
    const [products, setProducts] = useState([]);
    const [editing, setEditing] = useState(null);
    const [showNew, setShowNew] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [itineraries, setItineraries] = useState([]);
    const [sortConfig, setSortConfig] = useState({
        key: "name",
        direction: "ascending",
    });

    // Inline editing
    const [inlineEditId, setInlineEditId] = useState(null);
    const [inlineValues, setInlineValues] = useState({});
    const [inlineSaving, setInlineSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [prods, itins] = await Promise.all([
                fetchProducts(token),
                fetchItineraries(token),
            ]);
            setProducts(Array.isArray(prods) ? prods : []);
            setItineraries(Array.isArray(itins) ? itins : []);
            setError("");
        } catch (e) {
            setError("No se pudo cargar el inventario");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const filteredAndSortedProducts = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();

        let filtered = Array.isArray(products) ? [...products] : [];

        if (term) {
            filtered = filtered.filter((product) => {
                const name = (product?.name || "").toLowerCase();
                const sku = (product?.sku || "").toLowerCase();
                const desc = (product?.description || "").toLowerCase();
                return (
                    name.includes(term) || sku.includes(term) || desc.includes(term)
                );
            });
        }

        const { key, direction } = sortConfig;
        const isNumeric = ["basePrice", "bigClientPrice", "weight"].includes(key);

        filtered.sort((a, b) => {
            const aVal = a?.[key];
            const bVal = b?.[key];

            if (isNumeric) {
                const aNum = Number(aVal) || 0;
                const bNum = Number(bVal) || 0;
                return direction === "ascending" ? aNum - bNum : bNum - aNum;
            }

            const aStr = (aVal ?? "").toString().toLowerCase();
            const bStr = (bVal ?? "").toString().toLowerCase();
            const cmp = aStr.localeCompare(bStr);
            return direction === "ascending" ? cmp : -cmp;
        });

        return filtered;
    }, [products, searchTerm, sortConfig]);

    const handleEdit = (product) => {
        setEditing(product);
        setShowNew(false);
    };

    const handleNewProduct = () => {
        setEditing(null);
        setShowNew(true);
    };

    const handleSort = (key) => {
        setSortConfig((curr) => ({
            key,
            direction:
                curr.key === key && curr.direction === "ascending"
                    ? "descending"
                    : "ascending",
        }));
    };

    const startInlineEdit = (product) => {
        if (!esAdmin) return;
        setInlineEditId(product.id);
        setInlineValues({
            name: product.name || '',
            basePrice: product.basePrice ?? 0,
            bigClientPrice: product.bigClientPrice ?? 0,
            weight: product.weight ?? 0,
            itineraryId: product.itineraryId || '',
        });
    };

    const cancelInlineEdit = () => {
        setInlineEditId(null);
        setInlineValues({});
    };

    const saveInlineEdit = async (productId) => {
        setInlineSaving(true);
        try {
            await updateProduct(token, productId, {
                name: inlineValues.name,
                basePrice: parseFloat(inlineValues.basePrice) || 0,
                bigClientPrice: parseFloat(inlineValues.bigClientPrice) || 0,
                weight: parseFloat(inlineValues.weight) || 0,
                itineraryId: inlineValues.itineraryId ? Number(inlineValues.itineraryId) : null,
            });
            setInlineEditId(null);
            setInlineValues({});
            await load();
        } catch (err) {
            setError(err.error || 'Error al guardar');
        } finally {
            setInlineSaving(false);
        }
    };

    const getSortDirectionIcon = (columnName) => {
        if (sortConfig.key !== columnName) return null;
        return sortConfig.direction === "ascending" ? (
            <span uk-icon="icon: chevron-up; ratio: 0.7"></span>
        ) : (
            <span uk-icon="icon: chevron-down; ratio: 0.7"></span>
        );
    };

    // Función para renderizar el itinerario asignado
    const renderServiceOptions = (product) => {
        if (product?.itineraryId) {
            const itin = itineraries.find(i => i.id === product.itineraryId);
            if (itin) {
                return (
                    <span className="uk-badge" style={{ background: '#3b82f6', fontSize: '0.7rem' }}>
                        {itin.name}
                    </span>
                );
            }
            return <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>ID: {product.itineraryId}</span>;
        }
        // Legacy: mostrar serviceOptions si aún no tiene itinerario
        if (!product?.serviceOptions) return <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>—</span>;
        const badges = [];
        if (product.serviceOptions.dryWash)
            badges.push(<span key="dry" className="uk-badge uk-margin-small-right" style={{ fontSize: '0.65rem' }}>Seco</span>);
        if (product.serviceOptions.wetWash)
            badges.push(<span key="wet" className="uk-badge uk-margin-small-right" style={{ fontSize: '0.65rem' }}>Mojado</span>);
        if (product.serviceOptions.ironing)
            badges.push(<span key="iron" className="uk-badge uk-margin-small-right" style={{ fontSize: '0.65rem' }}>Plancha</span>);
        if (product.serviceOptions.externalService)
            badges.push(<span key="ext" className="uk-badge uk-margin-small-right" style={{ fontSize: '0.65rem' }}>Externo</span>);
        return badges.length ? <div>{badges}</div> : <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>—</span>;
    };

    return (
        <div>
            <PageToolbar
                title="Inventario"
                actions={esAdmin && (
                    <button className="uk-button uk-button-primary" onClick={handleNewProduct}>
                        <span uk-icon="plus"></span> Nuevo producto
                    </button>
                )}
            />

            {error && (
                <div className="uk-alert-danger" uk-alert="">
                    <p>{error}</p>
                </div>
            )}

            <ProductModal
                token={token}
                initial={editing || {}}
                isOpen={!!editing}
                itineraries={itineraries}
                onSave={() => {
                    load();
                    setEditing(null);
                }}
                onClose={() => setEditing(null)}
            />

            <ProductModal
                token={token}
                isOpen={showNew}
                itineraries={itineraries}
                onSave={() => {
                    load();
                    setShowNew(false);
                }}
                onClose={() => setShowNew(false)}
            />

            <div className="section-content">
                <div className="uk-margin">
                    <div className="uk-search uk-search-default uk-width-1-1">
                        <span uk-search-icon=""></span>
                        <input
                            className="uk-search-input"
                            type="search"
                            placeholder="Buscar por nombre, SKU o descripción..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {loading ? (
                    <div className="uk-text-center uk-padding">
                        <div uk-spinner="ratio: 1"></div>
                        <p>Cargando productos...</p>
                    </div>
                ) : (
                    <>
                        <div className="uk-overflow-auto">
                            <table className="uk-table uk-table-hover uk-table-middle uk-table-divider">
                                <thead>
                                <tr>
                                    <th onClick={() => handleSort("name")} style={{ cursor: "pointer" }}>
                                        Nombre {getSortDirectionIcon("name")}
                                    </th>
                                    <th onClick={() => handleSort("type")} style={{ cursor: "pointer" }}>
                                        Tipo {getSortDirectionIcon("type")}
                                    </th>
                                    <th
                                        onClick={() => handleSort("basePrice")}
                                        style={{ cursor: "pointer" }}
                                    >
                                        Precio Base {getSortDirectionIcon("basePrice")}
                                    </th>
                                    <th
                                        onClick={() => handleSort("bigClientPrice")}
                                        style={{ cursor: "pointer" }}
                                    >
                                        Tarifa G. Clientes {getSortDirectionIcon("bigClientPrice")}
                                    </th>
                                    <th onClick={() => handleSort("sku")} style={{ cursor: "pointer" }}>
                                        SKU {getSortDirectionIcon("sku")}
                                    </th>
                                    <th onClick={() => handleSort("weight")} style={{ cursor: "pointer" }}>
                                        Peso (kg) {getSortDirectionIcon("weight")}
                                    </th>
                                    <th>Itinerario</th>
                                    <th>Acciones</th>
                                </tr>
                                </thead>
                                <tbody>
                                {filteredAndSortedProducts.map((product) => (
                                    <tr key={product.id}>
                                        <td>
                                            {inlineEditId === product.id ? (
                                                <input
                                                    className="uk-input uk-form-small"
                                                    value={inlineValues.name}
                                                    onChange={e => setInlineValues(v => ({...v, name: e.target.value}))}
                                                    style={{ minWidth: 120 }}
                                                    autoFocus
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') saveInlineEdit(product.id);
                                                        if (e.key === 'Escape') cancelInlineEdit();
                                                    }}
                                                />
                                            ) : (
                                                <Link to={`/productos/${product.id}`} style={{ fontWeight: 500 }} title="Ver ficha y estadísticas">
                                                    {product.name}
                                                </Link>
                                            )}
                                        </td>
                                        <td>
                        <span
                            className={`uk-label ${
                                product.type === "service"
                                    ? "uk-label-warning"
                                    : "uk-label-success"
                            }`}
                        >
                          {product.type === "service" ? "Servicio" : "Ítem"}
                        </span>
                                        </td>
                                        <td>
                                            {inlineEditId === product.id ? (
                                                <input
                                                    className="uk-input uk-form-small"
                                                    type="number"
                                                    step="0.01"
                                                    value={inlineValues.basePrice}
                                                    onChange={e => setInlineValues(v => ({...v, basePrice: e.target.value}))}
                                                    style={{ width: 80 }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') saveInlineEdit(product.id);
                                                        if (e.key === 'Escape') cancelInlineEdit();
                                                    }}
                                                />
                                            ) : (
                                                <span style={{ cursor: 'pointer' }} onDoubleClick={() => startInlineEdit(product)}>
                                                    {formatPriceWithTax(product.basePrice)}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {inlineEditId === product.id ? (
                                                <input
                                                    className="uk-input uk-form-small"
                                                    type="number"
                                                    step="0.01"
                                                    value={inlineValues.bigClientPrice}
                                                    onChange={e => setInlineValues(v => ({...v, bigClientPrice: e.target.value}))}
                                                    style={{ width: 80 }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') saveInlineEdit(product.id);
                                                        if (e.key === 'Escape') cancelInlineEdit();
                                                    }}
                                                />
                                            ) : (
                                                <span style={{ cursor: 'pointer' }} onDoubleClick={() => startInlineEdit(product)}>
                                                    {formatPriceWithTax(product.bigClientPrice)}
                                                </span>
                                            )}
                                        </td>
                                        <td>{product.sku || "-"}</td>
                                        <td>
                                            {inlineEditId === product.id ? (
                                                <input
                                                    className="uk-input uk-form-small"
                                                    type="number"
                                                    step="0.01"
                                                    value={inlineValues.weight}
                                                    onChange={e => setInlineValues(v => ({...v, weight: e.target.value}))}
                                                    style={{ width: 65 }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') saveInlineEdit(product.id);
                                                        if (e.key === 'Escape') cancelInlineEdit();
                                                    }}
                                                />
                                            ) : (
                                                <span style={{ cursor: 'pointer' }} onDoubleClick={() => startInlineEdit(product)}>
                                                    {formatWeight(product.weight)}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {inlineEditId === product.id ? (
                                                <select
                                                    className="uk-select uk-form-small"
                                                    value={inlineValues.itineraryId}
                                                    onChange={e => setInlineValues(v => ({...v, itineraryId: e.target.value}))}
                                                    style={{ minWidth: 120 }}
                                                >
                                                    <option value="">Sin itinerario</option>
                                                    {itineraries.map(it => (
                                                        <option key={it.id} value={it.id}>{it.name}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span style={{ cursor: 'pointer' }} onDoubleClick={() => startInlineEdit(product)}>
                                                    {renderServiceOptions(product)}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {inlineEditId === product.id ? (
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <button
                                                        className="uk-button uk-button-primary uk-button-small"
                                                        onClick={() => saveInlineEdit(product.id)}
                                                        disabled={inlineSaving}
                                                        style={{ padding: '2px 8px' }}
                                                    >
                                                        {inlineSaving ? <span uk-spinner="ratio: 0.4"></span> : <span uk-icon="icon: check; ratio: 0.75"></span>}
                                                    </button>
                                                    <button
                                                        className="uk-button uk-button-default uk-button-small"
                                                        onClick={cancelInlineEdit}
                                                        style={{ padding: '2px 8px' }}
                                                    >
                                                        <span uk-icon="icon: close; ratio: 0.75"></span>
                                                    </button>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <Link
                                                        to={`/productos/${product.id}`}
                                                        className="uk-button uk-button-default uk-button-small"
                                                        title="Ficha y estadísticas"
                                                        style={{ padding: '2px 8px' }}
                                                    >
                                                        <span uk-icon="icon: album; ratio: 0.75"></span>
                                                    </Link>
                                                    {esAdmin && (
                                                        <>
                                                            <button
                                                                className="uk-button uk-button-default uk-button-small"
                                                                onClick={() => startInlineEdit(product)}
                                                                title="Edición rápida"
                                                                style={{ padding: '2px 8px' }}
                                                            >
                                                                <span uk-icon="icon: pencil; ratio: 0.75"></span>
                                                            </button>
                                                            <button
                                                                className="uk-button uk-button-primary uk-button-small"
                                                                onClick={() => handleEdit(product)}
                                                                title="Editar completo"
                                                                style={{ padding: '2px 8px' }}
                                                            >
                                                                <span uk-icon="icon: settings; ratio: 0.75"></span>
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>

                            {filteredAndSortedProducts.length === 0 && (
                                <div className="uk-text-center uk-margin uk-text-muted">
                                    {searchTerm
                                        ? "No se encontraron productos con esa búsqueda."
                                        : "No hay productos disponibles."}
                                </div>
                            )}
                        </div>

                        <div className="uk-margin uk-text-center uk-text-muted">
                            Mostrando {filteredAndSortedProducts.length} de {products.length} productos
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
