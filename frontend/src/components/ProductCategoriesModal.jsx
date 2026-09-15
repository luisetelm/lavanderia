import React, {useCallback, useEffect, useState} from 'react';
import {fetchProductCategories, createProductCategory, updateProductCategory, deleteProductCategory} from '../api.js';
import {avisar} from '../utils/dialogo.js';

// Categorías de producto: crear, renombrar y borrar (sólo administración).
// Borrar una categoría deja sus productos sin categoría. La confirmación va en
// la propia fila para no abrir un diálogo encima de este modal.

const nota = {fontSize: '0.78rem', color: '#64748b', margin: 0};

export default function ProductCategoriesModal({token, onClose, onChange}) {
    const [categorias, setCategorias] = useState(null);
    const [error, setError] = useState('');
    const [nueva, setNueva] = useState('');
    const [editando, setEditando] = useState(null);   // {id, name}
    const [borrando, setBorrando] = useState(null);   // id pendiente de confirmar

    const cargar = useCallback(async () => {
        try {
            const c = await fetchProductCategories(token);
            setCategorias(Array.isArray(c) ? c : []);
        } catch (e) {
            setError(e.error || 'No se pudieron cargar las categorías');
        }
    }, [token]);

    useEffect(() => { cargar(); }, [cargar]);

    const hecho = async (mensaje) => {
        avisar(mensaje, 'success');
        setError('');
        await cargar();
        onChange?.();
    };

    const crear = async (e) => {
        e.preventDefault();
        const nombre = nueva.trim();
        if (!nombre) return;
        try {
            await createProductCategory(token, nombre);
            setNueva('');
            await hecho('Categoría creada');
        } catch (err) {
            setError(err.error || 'No se pudo crear la categoría');
        }
    };

    const renombrar = async () => {
        try {
            await updateProductCategory(token, editando.id, editando.name);
            setEditando(null);
            await hecho('Categoría renombrada');
        } catch (err) {
            setError(err.error || 'No se pudo renombrar la categoría');
        }
    };

    const borrar = async (c) => {
        try {
            await deleteProductCategory(token, c.id);
            setBorrando(null);
            await hecho('Categoría borrada');
        } catch (err) {
            setError(err.error || 'No se pudo borrar la categoría');
        }
    };

    return (
        <div className="uk-modal uk-open" style={{display: 'block', background: 'rgba(0,0,0,0.6)'}}>
            <div className="uk-modal-dialog uk-modal-body uk-margin-auto-vertical" style={{width: 'min(560px, calc(100% - 24px))'}}>
                <button className="uk-modal-close-default" type="button" uk-close="true" onClick={onClose}></button>
                <h4 className="uk-modal-title">Categorías de producto</h4>
                <p style={{...nota, marginBottom: 12}}>Sirven para ordenar y filtrar el catálogo. Se asignan desde el formulario de cada producto.</p>

                {error && <div className="uk-alert-danger" uk-alert="true"><p>{error}</p></div>}

                <form onSubmit={crear} style={{display: 'flex', gap: 8, marginBottom: 12}}>
                    <input className="uk-input uk-form-small" placeholder="Nueva categoría" maxLength={80}
                           value={nueva} onChange={(e) => setNueva(e.target.value)}/>
                    <button type="submit" className="uk-button uk-button-primary uk-button-small" disabled={!nueva.trim()}>Añadir</button>
                </form>

                {categorias === null ? (
                    <div key="cargando" className="uk-text-center" style={{padding: 16}}><div uk-spinner="ratio: 0.8"></div></div>
                ) : categorias.length === 0 ? (
                    <p key="vacio" style={{...nota, textAlign: 'center', padding: 20}}>Todavía no hay categorías.</p>
                ) : (
                    <div key="lista" className="uk-overflow-auto" style={{maxHeight: 360}}>
                        <table className="uk-table uk-table-divider uk-table-small uk-table-middle" style={{margin: 0}}>
                            <thead>
                            <tr>
                                <th>Nombre</th>
                                <th style={{textAlign: 'right'}}>Productos</th>
                                <th></th>
                            </tr>
                            </thead>
                            <tbody>
                            {categorias.map((c) => (
                                <tr key={c.id}>
                                    <td>
                                        {editando?.id === c.id ? (
                                            <input className="uk-input uk-form-small" autoFocus maxLength={80} value={editando.name}
                                                   onChange={(e) => setEditando({...editando, name: e.target.value})}
                                                   onKeyDown={(e) => {
                                                       if (e.key === 'Enter') renombrar();
                                                       if (e.key === 'Escape') setEditando(null);
                                                   }}/>
                                        ) : c.name}
                                    </td>
                                    <td style={{textAlign: 'right'}}>{c.productos}</td>
                                    <td style={{textAlign: 'right', whiteSpace: 'nowrap'}}>
                                        {editando?.id === c.id ? (
                                            <>
                                                <button type="button" className="uk-button uk-button-primary uk-button-small" onClick={renombrar}>Guardar</button>
                                                <button type="button" className="uk-button uk-button-link uk-margin-small-left" onClick={() => setEditando(null)}>Cancelar</button>
                                            </>
                                        ) : borrando === c.id ? (
                                            <>
                                                <span style={{fontSize: '0.75rem', color: '#b91c1c', marginRight: 8}}>
                                                    {c.productos ? `${c.productos} productos quedarán sin categoría.` : '¿Borrar?'}
                                                </span>
                                                <button type="button" className="uk-button uk-button-danger uk-button-small" onClick={() => borrar(c)}>Borrar</button>
                                                <button type="button" className="uk-button uk-button-link uk-margin-small-left" onClick={() => setBorrando(null)}>No</button>
                                            </>
                                        ) : (
                                            <>
                                                <button type="button" className="uk-icon-button" title="Renombrar" uk-icon="icon: pencil; ratio: 0.7"
                                                        style={{width: 26, height: 26}} onClick={() => { setBorrando(null); setEditando({id: c.id, name: c.name}); }}></button>
                                                <button type="button" className="uk-icon-button" title="Borrar" uk-icon="icon: trash; ratio: 0.7"
                                                        style={{width: 26, height: 26, marginLeft: 4}} onClick={() => { setEditando(null); setBorrando(c.id); }}></button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 14}}>
                    <button type="button" className="uk-button uk-button-default" onClick={onClose}>Cerrar</button>
                </div>
            </div>
        </div>
    );
}
