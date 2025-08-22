import React, {useEffect, useState, useMemo} from 'react';
import {fetchProducts, updateProduct, createProduct} from '../api.js';

function ProductModal({ onSave, initial, token, onClose, isOpen }) {
    const [form, setForm] = useState({
        name: '',
        sku: '',
        basePrice: 0,
        type: 'service',
        description: '',
        weight: 0,
        bigClientPrice: 0,
        serviceOptions: {
            dryWash: false,
            wetWash: false,
            ironing: false,
            externalService: false,
        }
    });
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;

        const src = initial || {};
        setForm({
            name: src.name ?? '',
            sku: src.sku ?? '',
            basePrice: src.basePrice ?? 0,
            type: src.type ?? 'service',
            description: src.description ?? '',
            weight: src.weight ?? 0,
            bigClientPrice: src.bigClientPrice ?? 0,
            serviceOptions: {
                dryWash: src.serviceOptions?.dryWash ?? false,
                wetWash: src.serviceOptions?.wetWash ?? false,
                ironing: src.serviceOptions?.ironing ?? false,
                externalService: src.serviceOptions?.externalService ?? false,
            }
        });
    }, [isOpen, initial?.id]); // evita re-ejecutar por cambios de referencia del objeto

    const submit = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                ...form,
                basePrice: parseFloat(form.basePrice),
                weight: parseFloat(form.weight),
                bigClientPrice: parseFloat(form.bigClientPrice)
            };

            if (initial && initial.id) {
                await updateProduct(token, initial.id, payload);
            } else {
                await createProduct(token, payload);
            }
            onSave();
        } catch (err) {
            setError(err.error || 'Fallo al guardar');
        }
    };

    const handleServiceOptionChange = (option, value) => {
        setForm(prev => ({
            ...prev,
            serviceOptions: {
                ...prev.serviceOptions,
                [option]: value
            }
        }));
    };

    if (!isOpen) return null;

    return (
        <div className="uk-modal uk-open" style={{display: 'block', background: 'rgba(0,0,0,0.6)'}}>
            <div className="uk-modal-dialog uk-modal-body uk-margin-auto-vertical">
                <button className="uk-modal-close-default" type="button" uk-close="true" onClick={onClose}></button>
                <h4 className="uk-modal-title">
                    {initial && initial.id ? "Editar producto" : "Nuevo producto"}
                </h4>

                {error && (
                    <div className="uk-alert-danger" uk-alert="true">
                        <p>{error}</p>
                    </div>
                )}

                <form onSubmit={submit} className="uk-form-stacked">
                    <div className="uk-margin">
                        <label className="uk-form-label">Nombre</label>
                        <div className="uk-form-controls">
                            <input 
                                className="uk-input"
                                value={form.name} 
                                onChange={e => setForm(f => ({...f, name: e.target.value}))} 
                                required
                            />
                        </div>
                    </div>
                    
                    <div className="uk-margin">
                        <label className="uk-form-label">SKU</label>
                        <div className="uk-form-controls">
                            <input 
                                className="uk-input"
                                value={form.sku} 
                                onChange={e => setForm(f => ({...f, sku: e.target.value}))}
                            />
                        </div>
                    </div>
                    
                    <div className="uk-grid-small" uk-grid="true">
                        <div className="uk-width-1-2@s">
                            <label className="uk-form-label">Precio base</label>
                            <div className="uk-form-controls">
                                <input
                                    className="uk-input"
                                    type="number"
                                    step="0.01"
                                    value={form.basePrice}
                                    onChange={e => setForm(f => ({...f, basePrice: e.target.value}))}
                                    required
                                />
                            </div>
                        </div>
                        <div className="uk-width-1-2@s">
                            <label className="uk-form-label">Tarifa Grandes Clientes</label>
                            <div className="uk-form-controls">
                                <input
                                    className="uk-input"
                                    type="number"
                                    step="0.01"
                                    value={form.bigClientPrice}
                                    onChange={e => setForm(f => ({...f, bigClientPrice: e.target.value}))}
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div className="uk-grid-small" uk-grid="true">
                        <div className="uk-width-1-2@s">
                            <label className="uk-form-label">Tipo</label>
                            <div className="uk-form-controls">
                                <select 
                                    className="uk-select"
                                    value={form.type} 
                                    onChange={e => setForm(f => ({...f, type: e.target.value}))}
                                >
                                    <option value="service">Servicio</option>
                                    <option value="item">Ítem</option>
                                </select>
                            </div>
                        </div>
                        <div className="uk-width-1-2@s">
                            <label className="uk-form-label">Peso (kg)</label>
                            <div className="uk-form-controls">
                                <input
                                    className="uk-input"
                                    type="number"
                                    step="0.01"
                                    value={form.weight}
                                    onChange={e => setForm(f => ({...f, weight: e.target.value}))}
                                />
                            </div>
                        </div>
                    </div>
                    
                    {form.type === 'service' && (
                        <div className="uk-margin">
                            <label className="uk-form-label">Opciones de servicio</label>
                            <div className="uk-form-controls uk-grid-small uk-child-width-1-2@s" uk-grid="true">
                                <div>
                                    <label>
                                        <input 
                                            className="uk-checkbox" 
                                            type="checkbox" 
                                            checked={form.serviceOptions.dryWash}
                                            onChange={e => handleServiceOptionChange('dryWash', e.target.checked)}
                                        /> Lavado seco
                                    </label>
                                </div>
                                <div>
                                    <label>
                                        <input 
                                            className="uk-checkbox" 
                                            type="checkbox" 
                                            checked={form.serviceOptions.wetWash}
                                            onChange={e => handleServiceOptionChange('wetWash', e.target.checked)}
                                        /> Lavado mojado
                                    </label>
                                </div>
                                <div>
                                    <label>
                                        <input 
                                            className="uk-checkbox" 
                                            type="checkbox" 
                                            checked={form.serviceOptions.ironing}
                                            onChange={e => handleServiceOptionChange('ironing', e.target.checked)}
                                        /> Plancha
                                    </label>
                                </div>
                                <div>
                                    <label>
                                        <input 
                                            className="uk-checkbox" 
                                            type="checkbox" 
                                            checked={form.serviceOptions.externalService}
                                            onChange={e => handleServiceOptionChange('externalService', e.target.checked)}
                                        /> Servicio externo
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    <div className="uk-margin">
                        <label className="uk-form-label">Descripción</label>
                        <div className="uk-form-controls">
                            <textarea 
                                className="uk-textarea" 
                                rows="3"
                                value={form.description}
                                onChange={e => setForm(f => ({...f, description: e.target.value}))}
                            />
                        </div>
                    </div>
                    
                    <div className="uk-margin uk-flex uk-flex-right">
                        <button type="button" className="uk-button uk-button-default uk-margin-small-right" onClick={onClose}>
                            Cancelar
                        </button>
                        <button type="submit" className="uk-button uk-button-primary">
                            {initial && initial.id ? 'Guardar cambios' : 'Crear'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function formatPrice(val) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "-";
    return `${Number(val).toFixed(2)} €`;
}

function formatWeight(val) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "-";
    return `${Number(val)} kg`;
}

export default function Inventory({ token }) {
    const [products, setProducts] = useState([]);
    const [editing, setEditing] = useState(null);
    const [showNew, setShowNew] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [sortConfig, setSortConfig] = useState({
        key: "name",
        direction: "ascending",
    });

    const load = async () => {
        setLoading(true);
        try {
            const prods = await fetchProducts(token);
            setProducts(Array.isArray(prods) ? prods : []);
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

    const getSortDirectionIcon = (columnName) => {
        if (sortConfig.key !== columnName) return null;
        return sortConfig.direction === "ascending" ? (
            <span uk-icon="icon: chevron-up; ratio: 0.7"></span>
        ) : (
            <span uk-icon="icon: chevron-down; ratio: 0.7"></span>
        );
    };

    // Función para renderizar los servicios como badges
    const renderServiceOptions = (product) => {
        if (!product?.serviceOptions) return null;

        const badges = [];
        if (product.serviceOptions.dryWash)
            badges.push(
                <span key="dry" className="uk-badge uk-margin-small-right">
          Lavado seco
        </span>
            );
        if (product.serviceOptions.wetWash)
            badges.push(
                <span key="wet" className="uk-badge uk-margin-small-right">
          Lavado mojado
        </span>
            );
        if (product.serviceOptions.ironing)
            badges.push(
                <span key="iron" className="uk-badge uk-margin-small-right">
          Plancha
        </span>
            );
        if (product.serviceOptions.externalService)
            badges.push(
                <span key="ext" className="uk-badge uk-margin-small-right">
          Servicio externo
        </span>
            );

        return badges.length ? <div>{badges}</div> : null;
    };

    return (
        <div>
            <div className="section-header">
                <h2>Inventario</h2>
                <div>
                    <button className="uk-button uk-button-primary" onClick={handleNewProduct}>
                        <span uk-icon="plus"></span> Nuevo producto
                    </button>
                </div>
            </div>

            {error && (
                <div className="uk-alert-danger" uk-alert="">
                    <p>{error}</p>
                </div>
            )}

            <ProductModal
                token={token}
                initial={editing || {}}
                isOpen={!!editing}
                onSave={() => {
                    load();
                    setEditing(null);
                }}
                onClose={() => setEditing(null)}
            />

            <ProductModal
                token={token}
                isOpen={showNew}
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
                                    <th>Servicios</th>
                                    <th>Acciones</th>
                                </tr>
                                </thead>
                                <tbody>
                                {filteredAndSortedProducts.map((product) => (
                                    <tr key={product.id}>
                                        <td>{product.name}</td>
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
                                        <td>{formatPrice(product.basePrice)}</td>
                                        <td>{formatPrice(product.bigClientPrice)}</td>
                                        <td>{product.sku || "-"}</td>
                                        <td>{formatWeight(product.weight)}</td>
                                        <td>{renderServiceOptions(product)}</td>
                                        <td>
                                            <button
                                                className="uk-button uk-button-primary uk-button-small"
                                                onClick={() => handleEdit(product)}
                                            >
                                                <span uk-icon="pencil"></span> Editar
                                            </button>
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
