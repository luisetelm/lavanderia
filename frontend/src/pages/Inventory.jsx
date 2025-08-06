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
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{background: '#fff', padding: 24, borderRadius: 8, minWidth: 320}}>
                <h4>Importar productos desde CSV</h4>
                {error && <div style={{color: 'red'}}>{error}</div>}
                <form onSubmit={handleSubmit}>
                    <input type="file" accept=".csv" ref={fileInput}/>
                    <div style={{marginTop: 12, display: 'flex', gap: 8}}>
                        <button type="submit" disabled={loading}>Importar</button>
                        <button type="button" onClick={onClose}>Cancelar</button>
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
        <div style={{border: '1px solid #888', padding: 12, borderRadius: 6, marginBottom: 12}}>
            <h4>{initial.id ? 'Editar producto' : 'Nuevo producto'}</h4>
            {error && <div style={{color: 'red'}}>{error}</div>}
            <form onSubmit={submit} style={{display: 'grid', gap: 8}}>
                <div>
                    <label>Nombre</label><br/>
                    <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required/>
                </div>
                <div>
                    <label>SKU</label><br/>
                    <input value={form.sku} onChange={e => setForm(f => ({...f, sku: e.target.value}))}/>
                </div>
                <div>
                    <label>Precio base</label><br/>
                    <input
                        type="number"
                        step="0.01"
                        value={form.basePrice}
                        onChange={e => setForm(f => ({...f, basePrice: parseFloat(e.target.value)}))}
                        required
                    />
                </div>
                <div>
                    <label>Tipo</label><br/>
                    <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
                        <option value="service">Servicio</option>
                        <option value="item">Ítem</option>
                    </select>
                </div>
                <div>
                    <label>Descripción</label><br/>
                    <textarea value={form.description}
                              onChange={e => setForm(f => ({...f, description: e.target.value}))}/>
                </div>
                <div style={{display: 'flex', gap: 8}}>
                    <button type="submit">{initial.id ? 'Guardar cambios' : 'Crear'}</button>
                    {onCancel &&
                        <button type="button" onClick={onCancel} style={{background: '#999'}}>Cancelar</button>}
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

    const load = async () => {
        try {
            const prods = await fetchProducts(token);
            setProducts(prods);
        } catch (e) {
            setError('No se pudo cargar el inventario');
        }
    };

    useEffect(() => {
        load();
    }, [token]);

    return (
        <div>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <h2>Inventario</h2>
                <button onClick={() => {
                    setShowNew(true);
                    setEditing(null);
                }}>Nuevo producto
                </button>
                <button onClick={() => setShowImport(true)}>Importar CSV</button>
            </div>
            {showImport && (
                <ImportCSVModal
                    token={token}
                    onClose={() => setShowImport(false)}
                    onSuccess={load}
                />
            )}

            {error && <div style={{color: 'red'}}>{error}</div>}
            {showNew && (
                <ProductForm
                    token={token}
                    onSave={() => {
                        load();
                        setShowNew(false);
                    }}
                    onCancel={() => setShowNew(false)}
                />
            )}
            {editing && (
                <ProductForm
                    token={token}
                    initial={editing}
                    onSave={() => {
                        load();
                        setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                />
            )}
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16}}>
                {products.map(p => (
                    <div key={p.id}
                         style={{border: '1px solid #ccc', padding: 12, borderRadius: 6, position: 'relative'}}>
                        <div><strong>{p.name}</strong> ({p.type})</div>
                        <div>Precio base: {p.basePrice.toFixed(2)} €</div>
                        <div>SKU: {p.sku || '-'}</div>
                        <div style={{marginTop: 6}}>{p.description}</div>
                        <button
                            style={{position: 'absolute', top: 8, right: 8, fontSize: 12}}
                            onClick={() => {
                                setEditing(p);
                                setShowNew(false);
                            }}
                        >
                            Editar
                        </button>
                    </div>
                ))}
                {products.length === 0 && <div>No hay productos.</div>}
            </div>
        </div>
    );
}
