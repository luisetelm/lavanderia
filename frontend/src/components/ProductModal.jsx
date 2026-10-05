import React, {useEffect, useState} from 'react';
import {updateProduct, createProduct, fetchProductCategories, createProductCategory} from '../api.js';

// Alta y edición de un producto. Lo usan el catálogo (Inventory) y la ficha de producto.

export default function ProductModal({ onSave, initial, token, onClose, isOpen, itineraries, titulo }) {
    const [categorias, setCategorias] = useState([]);
    const [nuevaCategoria, setNuevaCategoria] = useState(null); // null = eligiendo; texto = creando una
    const [form, setForm] = useState({
        name: '',
        sku: '',
        categoryId: null,
        basePrice: 0,
        type: 'service',
        description: '',
        weight: 0,
        bigClientPrice: 0,
        itineraryId: null,
        labelCount: 1,
        printWashLabel: true,
        countsForLoad: true,
        webSection: '',
        webName: '',
        webOrder: 0,
        workloadWeight: 1,
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
            itineraryId: src.itineraryId ?? null,
            labelCount: src.labelCount ?? 1,
            printWashLabel: src.printWashLabel ?? true,
            countsForLoad: src.countsForLoad ?? true,
            webSection: src.webSection ?? '',
            webName: src.webName ?? '',
            webOrder: src.webOrder ?? 0,
            workloadWeight: src.workloadWeight ?? 1,
            categoryId: src.categoryId ?? null,
        });
    }, [isOpen, initial?.id]);

    useEffect(() => {
        if (!isOpen) return;
        setError('');
        setNuevaCategoria(null);
        fetchProductCategories(token)
            .then((c) => setCategorias(Array.isArray(c) ? c : []))
            .catch(() => setCategorias([]));
    }, [isOpen, token]);

    const crearCategoria = async () => {
        const nombre = (nuevaCategoria || '').trim();
        if (!nombre) return;
        try {
            const categoria = await createProductCategory(token, nombre);
            setCategorias((cs) => [...cs, categoria].sort((a, b) => a.name.localeCompare(b.name, 'es')));
            setForm((f) => ({...f, categoryId: categoria.id}));
            setNuevaCategoria(null);
            setError('');
        } catch (err) {
            setError(err.error || 'No se pudo crear la categoría');
        }
    };

    const submit = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                ...form,
                basePrice: parseFloat(form.basePrice),
                weight: parseFloat(form.weight),
                bigClientPrice: parseFloat(form.bigClientPrice),
                itineraryId: form.itineraryId ? Number(form.itineraryId) : null,
                labelCount: Math.max(1, parseInt(form.labelCount, 10) || 1),
                printWashLabel: !!form.printWashLabel,
                countsForLoad: !!form.countsForLoad,
                workloadWeight: Math.max(0, parseFloat(form.workloadWeight) || 0),
                categoryId: form.categoryId ? Number(form.categoryId) : null,
                webSection: form.webSection || null,
                webName: form.webName.trim() || null,
                webOrder: parseInt(form.webOrder, 10) || 0,
            };

            const guardado = initial && initial.id
                ? await updateProduct(token, initial.id, payload)
                : await createProduct(token, payload);
            onSave(guardado);
        } catch (err) {
            setError(err.error || 'Fallo al guardar');
        }
    };


    if (!isOpen) return null;

    return (
        <div className="uk-modal uk-open" style={{display: 'block', background: 'rgba(0,0,0,0.6)'}}>
            <div className="uk-modal-dialog uk-modal-body uk-margin-auto-vertical">
                <button className="uk-modal-close-default" type="button" uk-close="true" onClick={onClose}></button>
                <h4 className="uk-modal-title">
                    {titulo || (initial && initial.id ? "Editar producto" : "Nuevo producto")}
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
                    
                    <div className="uk-margin">
                        <label className="uk-form-label">Categoría</label>
                        <div className="uk-form-controls">
                            {nuevaCategoria === null ? (
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <select
                                        className="uk-select"
                                        value={form.categoryId || ''}
                                        onChange={e => setForm(f => ({...f, categoryId: e.target.value ? Number(e.target.value) : null}))}
                                    >
                                        <option value="">Sin categoría</option>
                                        {categorias.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <button type="button" className="uk-button uk-button-default" style={{ whiteSpace: 'nowrap' }}
                                            onClick={() => setNuevaCategoria('')}>
                                        Nueva
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <input
                                        className="uk-input"
                                        autoFocus
                                        maxLength={80}
                                        placeholder="Nombre de la categoría"
                                        value={nuevaCategoria}
                                        onChange={e => setNuevaCategoria(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') { e.preventDefault(); crearCategoria(); }
                                            if (e.key === 'Escape') setNuevaCategoria(null);
                                        }}
                                    />
                                    <button type="button" className="uk-button uk-button-primary" onClick={crearCategoria}>Añadir</button>
                                    <button type="button" className="uk-button uk-button-default" onClick={() => setNuevaCategoria(null)}>Cancelar</button>
                                </div>
                            )}
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
                                {parseFloat(form.basePrice) > 0 && (
                                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 4 }}>
                                        IVA incl. · Base neta: {(Number(form.basePrice) / 1.21).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} + 21% = <strong style={{ color: '#1e293b' }}>{Number(form.basePrice).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</strong>
                                    </div>
                                )}
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
                                {parseFloat(form.bigClientPrice) > 0 && (
                                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 4 }}>
                                        IVA incl. · Base neta: {(Number(form.bigClientPrice) / 1.21).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} + 21% = <strong style={{ color: '#1e293b' }}>{Number(form.bigClientPrice).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</strong>
                                    </div>
                                )}
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

                    <div className="uk-margin">
                        <label className="uk-form-label">Etiquetas por unidad</label>
                        <div className="uk-form-controls">
                            <input
                                className="uk-input"
                                type="number"
                                min="1"
                                step="1"
                                value={form.labelCount}
                                onChange={e => setForm(f => ({...f, labelCount: e.target.value}))}
                                style={{ maxWidth: 120 }}
                                disabled={!form.printWashLabel}
                            />
                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 4 }}>
                                Nº de etiquetas de ropa que se imprimen por cada unidad. Ej.: traje de 2 piezas = 2.
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                                <input
                                    className="uk-checkbox"
                                    type="checkbox"
                                    checked={!!form.printWashLabel}
                                    onChange={e => setForm(f => ({...f, printWashLabel: e.target.checked}))}
                                />
                                <span style={{ fontSize: '0.85rem' }}>
                                    {form.printWashLabel ? 'Imprime etiquetas de lavado' : 'No imprime etiquetas de lavado (p. ej. KG ropa blanca)'}
                                </span>
                            </label>
                        </div>
                    </div>

                    <div className="uk-grid-small" uk-grid="true">
                        <div className="uk-width-1-2@s">
                            <label className="uk-form-label">Factor de carga</label>
                            <div className="uk-form-controls">
                                <input
                                    className="uk-input"
                                    type="number"
                                    min="0"
                                    step="0.05"
                                    value={form.workloadWeight}
                                    onChange={e => setForm(f => ({...f, workloadWeight: e.target.value}))}
                                    disabled={!form.countsForLoad}
                                />
                                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 4 }}>
                                    Peso de trabajo para planificar el día, en camisas equivalentes. Ej.: camisa = 1, traje = 2,5, servilleta = 0,05.
                                </div>
                            </div>
                        </div>
                        <div className="uk-width-1-2@s">
                            <label className="uk-form-label">Computa en la carga del día</label>
                            <div className="uk-form-controls">
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                                    <input
                                        className="uk-checkbox"
                                        type="checkbox"
                                        checked={!!form.countsForLoad}
                                        onChange={e => setForm(f => ({...f, countsForLoad: e.target.checked}))}
                                    />
                                    <span style={{ fontSize: '0.85rem' }}>
                                        {form.countsForLoad ? 'Sí, suma trabajo' : 'No (p. ej. KG ropa blanca)'}
                                    </span>
                                </label>
                            </div>
                        </div>
                    </div>

                    {form.type === 'service' && (
                        <div className="uk-margin">
                            <label className="uk-form-label">Itinerario de servicio</label>
                            <div className="uk-form-controls">
                                <select
                                    className="uk-select"
                                    value={form.itineraryId || ''}
                                    onChange={e => setForm(f => ({...f, itineraryId: e.target.value ? Number(e.target.value) : null}))}
                                >
                                    <option value="">Sin itinerario (sin tracking)</option>
                                    {itineraries.map(it => (
                                        <option key={it.id} value={it.id}>
                                            {it.name} ({it.steps?.length || 0} pasos)
                                        </option>
                                    ))}
                                </select>
                                {form.itineraryId && (() => {
                                    const sel = itineraries.find(it => it.id === Number(form.itineraryId));
                                    if (!sel?.steps?.length) return null;
                                    return (
                                        <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#64748b' }}>
                                            Pasos: {sel.steps.map(s => s.stepLabel).join(' → ')}
                                        </div>
                                    );
                                })()}
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
                    
                    <fieldset className="uk-fieldset" style={{ border: '1px solid var(--tyb-border)', borderRadius: 'var(--tyb-radius-md)', padding: '12px 16px 16px', marginTop: 20 }}>
                        <legend style={{ fontSize: '0.85rem', fontWeight: 600, padding: '0 6px' }}>Web pública</legend>
                        <div style={{ fontSize: '0.75rem', color: 'var(--tyb-text-muted)', marginBottom: 10 }}>
                            Si eliges una sección, el producto sale en la tarifa de tinteyburbuja.com con su precio al público.
                            La tarifa de gran cliente y los precios pactados no se publican nunca; en hostelería se muestra sin precio.
                        </div>
                        <div className="uk-grid-small" uk-grid="true">
                            <div className="uk-width-1-3@s">
                                <label className="uk-form-label">Sección</label>
                                <div className="uk-form-controls">
                                    <select
                                        className="uk-select"
                                        value={form.webSection}
                                        onChange={e => setForm(f => ({...f, webSection: e.target.value}))}
                                    >
                                        <option value="">No se publica</option>
                                        <option value="lavado">Lavado y planchado</option>
                                        <option value="tintoreria">Tintorería</option>
                                        <option value="hosteleria">Hostelería</option>
                                    </select>
                                </div>
                            </div>
                            <div className="uk-width-1-2@s">
                                <label className="uk-form-label">Nombre en la web</label>
                                <div className="uk-form-controls">
                                    <input
                                        className="uk-input"
                                        type="text"
                                        maxLength={80}
                                        placeholder={form.name ? form.name.charAt(0) + form.name.slice(1).toLowerCase() : 'Como en el catálogo'}
                                        value={form.webName}
                                        onChange={e => setForm(f => ({...f, webName: e.target.value}))}
                                        disabled={!form.webSection}
                                    />
                                </div>
                            </div>
                            <div className="uk-width-1-6@s">
                                <label className="uk-form-label">Orden</label>
                                <div className="uk-form-controls">
                                    <input
                                        className="uk-input"
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={form.webOrder}
                                        onChange={e => setForm(f => ({...f, webOrder: e.target.value}))}
                                        disabled={!form.webSection}
                                    />
                                </div>
                            </div>
                        </div>
                    </fieldset>

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
