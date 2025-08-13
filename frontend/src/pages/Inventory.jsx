import React, {useEffect, useState, useRef} from 'react';
import {fetchProducts, createOrder, updateProduct, createProduct, importProducts} from '../api.js';

function ImportCSVModal({token, onClose, onSuccess}) {
    const fileInput = useRef();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!fileInput.current.files[0]) {
            setError('Selecciona un archivo CSV');
            return;
        }
        setLoading(true);
        setError('');
        const formData = new FormData();
        formData.append('file', fileInput.current.files[0]);
        try {
            const products = await importProducts(token, formData);
            onSuccess();
            onClose();
        } catch (err) {
            setError('Error al importar el archivo');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="uk-modal uk-open" uk-modal="true">
            <div className="uk-modal-dialog uk-modal-body uk-margin-auto-vertical">
                <h4 className="uk-modal-title">Importar productos desde CSV</h4>
                
                {error && (
                    <div className="uk-alert-danger" uk-alert="true">
                        <p>{error}</p>
                    </div>
                )}
                
                <form onSubmit={handleSubmit} className="uk-form-stacked">
                    <div className="uk-margin">
                        <div className="uk-form-controls">
                            <div className="uk-margin" uk-form-custom="true">
                                <input type="file" accept=".csv" ref={fileInput} />
                                <button className="uk-button uk-button-default" type="button" tabIndex="-1">
                                    Seleccionar archivo
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div className="uk-margin uk-flex uk-flex-right">
                        <button type="button" className="uk-button uk-button-default uk-margin-small-right" onClick={onClose}>
                            Cancelar
                        </button>
                        <button type="submit" className="uk-button uk-button-primary" disabled={loading}>
                            {loading ? (
                                <span>
                                    <div uk-spinner="ratio: 0.8" className="uk-margin-small-right"></div>
                                    Importando...
                                </span>
                            ) : (
                                'Importar'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function ProductForm({onSave, initial = {}, token, onCancel}) {
    const [form, setForm] = useState({
        name: initial.name || '',
        sku: initial.sku || '',
        basePrice: initial.basePrice || 0,
        type: initial.type || 'service',
        description: initial.description || '',
    });
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        try {
            if (initial.id) {
                await updateProduct(token, initial.id, form);
            } else {
                await createProduct(token, form);
            }
            onSave();
        } catch (err) {
            setError(err.error || 'Fallo al guardar');
        }
    };

    return (
        <div className="uk-card uk-card-default uk-card-body uk-margin-bottom">
            <h4 className="uk-card-title">{initial.id ? 'Editar producto' : 'Nuevo producto'}</h4>
            
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
                
                <div className="uk-margin">
                    <label className="uk-form-label">Precio base</label>
                    <div className="uk-form-controls">
                        <input
                            className="uk-input"
                            type="number"
                            step="0.01"
                            value={form.basePrice}
                            onChange={e => setForm(f => ({...f, basePrice: parseFloat(e.target.value)}))}
                            required
                        />
                    </div>
                </div>
                
                <div className="uk-margin">
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
                
                <div className="uk-margin uk-flex">
                    <button type="submit" className="uk-button uk-button-primary">
                        {initial.id ? 'Guardar cambios' : 'Crear'}
                    </button>
                    {onCancel && (
                        <button 
                            type="button" 
                            className="uk-button uk-button-default uk-margin-small-left" 
                            onClick={onCancel}
                        >
                            Cancelar
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
}

export default function Inventory({token}) {
    const [products, setProducts] = useState([]);
    const [editing, setEditing] = useState(null);
    const [showNew, setShowNew] = useState(false);
    const [error, setError] = useState('');
    const [showImport, setShowImport] = useState(false);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const prods = await fetchProducts(token);
            setProducts(prods);
            setError('');
        } catch (e) {
            setError('No se pudo cargar el inventario');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [token]);

    return (
        <div>
            <div className="section-header">
                <h2>Inventario</h2>
                <div>
                    <button 
                        className="uk-button uk-button-primary uk-margin-small-right"
                        onClick={() => {
                            setShowNew(true);
                            setEditing(null);
                        }}
                    >
                        <span uk-icon="plus"></span> Nuevo producto
                    </button>
                    <button 
                        className="uk-button uk-button-default"
                        onClick={() => setShowImport(true)}
                    >
                        <span uk-icon="cloud-upload"></span> Importar CSV
                    </button>
                </div>
            </div>

            {showImport && (
                <ImportCSVModal
                    token={token}
                    onClose={() => setShowImport(false)}
                    onSuccess={load}
                />
            )}

            {error && (
                <div className="uk-alert-danger" uk-alert="true">
                    <p>{error}</p>
                </div>
            )}

            {showNew && (
                <div className="section-content">
                    <ProductForm
                        token={token}
                        onSave={() => {
                            load();
                            setShowNew(false);
                        }}
                        onCancel={() => setShowNew(false)}
                    />
                </div>
            )}

            {editing && (
                <div className="section-content">
                    <ProductForm
                        token={token}
                        initial={editing}
                        onSave={() => {
                            load();
                            setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                    />
                </div>
            )}

            <div className="section-content">
                {loading ? (
                    <div className="uk-text-center uk-padding">
                        <div uk-spinner="ratio: 1"></div>
                        <p>Cargando productos...</p>
                    </div>
                ) : (
                    <div className="uk-grid uk-grid-medium uk-child-width-1-3@l uk-child-width-1-2@m uk-child-width-1-1@s" uk-grid="true">
                        {products.map(p => (
                            <div key={p.id}>
                                <div className="uk-card uk-card-default uk-card-body uk-position-relative">
                                    <button
                                        className="uk-button uk-button-small uk-position-top-right uk-position-small"
                                        onClick={() => {
                                            setEditing(p);
                                            setShowNew(false);
                                        }}
                                    >
                                        <span uk-icon="pencil"></span>
                                    </button>
                                    
                                    <h3 className="uk-card-title">{p.name}</h3>
                                    
                                    <div className="uk-margin-small-top">
                                        <span className={`uk-label ${p.type === 'service' ? 'uk-label-warning' : 'uk-label-success'}`}>
                                            {p.type === 'service' ? 'Servicio' : 'Ítem'}
                                        </span>
                                    </div>
                                    
                                    <div className="uk-margin-small-top">
                                        <strong>Precio base:</strong> {p.basePrice.toFixed(2)} €
                                    </div>
                                    
                                    <div className="uk-margin-small-top">
                                        <strong>SKU:</strong> {p.sku || '-'}
                                    </div>
                                    
                                    {p.description && (
                                        <div className="uk-margin-small-top">
                                            <p className="uk-text-small">{p.description}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        
                        {products.length === 0 && (
                            <div className="uk-width-1-1 uk-text-center uk-text-muted uk-margin">
                                No hay productos.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
