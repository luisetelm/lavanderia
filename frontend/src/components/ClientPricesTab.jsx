import React, {useEffect, useState} from 'react';
import {fetchProducts, fetchClientPrices, createClientPrice, updateClientPrice, endClientPrice} from '../api.js';
import {formatEUR} from '../utils/format.js';
import {confirmar, avisar} from '../utils/dialogo.js';

// Precios pactados de un cliente (ficha de cliente).
//
// Sustituyen a la tarifa normal y a la de gran cliente para ese producto
// mientras están vigentes, y el descuento del cliente no se aplica sobre ellos.
// La regla la aplica el backend (utils/precioLinea.js); aquí sólo se gestionan.
// Cualquier empleado los ve; sólo administración puede crearlos o cambiarlos.

const ESTADOS = {
    vigente: {texto: 'Vigente', cls: 'uk-label-success'},
    futuro: {texto: 'Próximo', cls: 'uk-label-warning'},
    finalizado: {texto: 'Finalizado', cls: ''},
};

const hoyLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fechaCorta = (s) => (s ? s.split('-').reverse().join('/') : '');
const leerNumero = (v) => Number(String(v).replace(',', '.'));
const formVacio = () => ({id: null, productId: '', price: '', validFrom: hoyLocal(), validTo: '', note: ''});

const lbl = {fontSize: '0.72rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: 2};
const hint = {fontSize: '0.72rem', color: '#64748b', marginTop: 2};

export default function ClientPricesTab({token, clientId, canEdit}) {
    const [precios, setPrecios] = useState([]);
    const [productos, setProductos] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [form, setForm] = useState(formVacio);
    const [guardando, setGuardando] = useState(false);
    const [verFinalizados, setVerFinalizados] = useState(false);

    const cargar = async () => {
        try {
            const res = await fetchClientPrices(token, clientId);
            setPrecios(res?.precios || []);
        } catch (e) {
            setError(e.error || 'No se pudieron cargar los precios pactados.');
        } finally {
            setCargando(false);
        }
    };

    useEffect(() => {
        setCargando(true);
        setError('');
        setForm(formVacio());
        cargar();
    }, [token, clientId]);

    useEffect(() => {
        if (!canEdit) return;
        fetchProducts(token)
            .then((p) => setProductos((Array.isArray(p) ? p : []).slice().sort((a, b) => a.name.localeCompare(b.name, 'es'))))
            .catch(() => setError('No se pudo cargar el catálogo de productos.'));
    }, [token, canEdit]);

    const set = (k, v) => setForm((f) => ({...f, [k]: v}));
    const producto = productos.find((p) => p.id === Number(form.productId));
    const precioForm = form.price === '' ? NaN : leerNumero(form.price);

    const vigentes = precios.filter((p) => p.estado !== 'finalizado');
    const numFinalizados = precios.length - vigentes.length;
    const visibles = verFinalizados ? precios : vigentes;

    const guardar = async (e) => {
        e.preventDefault();
        setError('');
        if (!form.productId) return setError('Elige el producto.');
        if (!Number.isFinite(precioForm) || precioForm < 0) return setError('Indica un precio pactado válido.');
        if (form.validTo && form.validTo < form.validFrom) return setError('La fecha de fin no puede ser anterior a la de inicio.');

        const datos = {
            productId: Number(form.productId),
            price: precioForm,
            validFrom: form.validFrom || undefined,
            validTo: form.validTo || null,
            note: form.note,
        };

        setGuardando(true);
        try {
            if (form.id) {
                await updateClientPrice(token, clientId, form.id, datos);
                avisar('Precio pactado actualizado', 'success');
            } else {
                const res = await createClientPrice(token, clientId, datos);
                avisar(
                    res?.cerrados?.length
                        ? 'Precio pactado creado. El acuerdo anterior de ese producto se ha cerrado el día antes.'
                        : 'Precio pactado creado',
                    'success',
                    5000,
                );
            }
            setForm(formVacio());
            await cargar();
        } catch (err) {
            setError(err.error || 'No se pudo guardar el precio pactado.');
        } finally {
            setGuardando(false);
        }
    };

    const editar = (p) => {
        setError('');
        setForm({
            id: p.id,
            productId: String(p.productId),
            price: String(p.price),
            validFrom: p.validFrom,
            validTo: p.validTo || '',
            note: p.note || '',
        });
    };

    const finalizar = async (p) => {
        // El backend elimina los que aún no han empezado o empiezan hoy, y
        // cierra ayer los que ya se aplicaron.
        const seElimina = p.validFrom >= hoyLocal();
        const ok = await confirmar(
            seElimina
                ? `¿Eliminar el precio pactado de ${p.productName}?`
                : `¿Finalizar el precio pactado de ${p.productName}? Deja de aplicarse desde hoy. Los pedidos ya hechos no cambian.`,
            {textoConfirmar: seElimina ? 'Eliminar' : 'Finalizar', peligroso: true},
        );
        if (!ok) return;
        setError('');
        try {
            const res = await endClientPrice(token, clientId, p.id);
            if (form.id === p.id) setForm(formVacio());
            avisar(res?.eliminado ? 'Precio pactado eliminado' : 'Precio pactado finalizado', 'success');
            await cargar();
        } catch (err) {
            setError(err.error || 'No se pudo finalizar el precio pactado.');
        }
    };

    return (
        <div>
            <p style={{fontSize: '0.78rem', color: '#64748b', margin: '0 0 10px'}}>
                Sustituyen a la tarifa normal y a la de gran cliente mientras están vigentes.
                El descuento del cliente no se aplica sobre ellos.
            </p>

            {error && (
                <div className="uk-alert-danger uk-margin-small" uk-alert="true"><p>{error}</p></div>
            )}

            {canEdit && (
                <form onSubmit={guardar} style={{
                    background: form.id ? '#eff6ff' : '#f8fafc', border: '1px solid #e2e8f0',
                    borderRadius: 6, padding: 10, marginBottom: 12,
                }}>
                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8}}>
                        <div style={{gridColumn: '1 / -1'}}>
                            <label style={lbl} htmlFor="cp-producto">Producto</label>
                            <select id="cp-producto" className="uk-select uk-form-small" value={form.productId}
                                    disabled={Boolean(form.id)} onChange={(e) => set('productId', e.target.value)}>
                                <option value="">Elige un producto…</option>
                                {productos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            {producto && (
                                <div style={hint}>
                                    Normal {formatEUR(Number(producto.basePrice))}
                                    {Number(producto.bigClientPrice) > 0 && ` · Gran cliente ${formatEUR(Number(producto.bigClientPrice))}`}
                                </div>
                            )}
                        </div>
                        <div>
                            <label style={lbl} htmlFor="cp-precio">Precio pactado, IVA incl.</label>
                            <input id="cp-precio" className="uk-input uk-form-small" inputMode="decimal"
                                   placeholder="0,00" value={form.price} onChange={(e) => set('price', e.target.value)}/>
                            {Number.isFinite(precioForm) && precioForm >= 0 && (
                                <div style={hint}>Base {formatEUR(precioForm / 1.21)} + IVA</div>
                            )}
                        </div>
                        <div>
                            <label style={lbl} htmlFor="cp-desde">Desde</label>
                            <input id="cp-desde" type="date" className="uk-input uk-form-small" value={form.validFrom}
                                   onChange={(e) => set('validFrom', e.target.value)}/>
                        </div>
                        <div>
                            <label style={lbl} htmlFor="cp-hasta">Hasta, opcional</label>
                            <input id="cp-hasta" type="date" className="uk-input uk-form-small" value={form.validTo}
                                   min={form.validFrom || undefined} onChange={(e) => set('validTo', e.target.value)}/>
                        </div>
                        <div style={{gridColumn: '1 / -1'}}>
                            <label style={lbl} htmlFor="cp-nota">Nota del acuerdo</label>
                            <input id="cp-nota" className="uk-input uk-form-small" maxLength={255}
                                   placeholder="Ej.: tarifa mantenida tras la subida de 2026"
                                   value={form.note} onChange={(e) => set('note', e.target.value)}/>
                        </div>
                    </div>
                    <div style={{display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end'}}>
                        {form.id && (
                            <button type="button" className="uk-button uk-button-default uk-button-small"
                                    onClick={() => { setForm(formVacio()); setError(''); }}>
                                Cancelar
                            </button>
                        )}
                        <button type="submit" className="uk-button uk-button-primary uk-button-small" disabled={guardando}>
                            {form.id ? 'Guardar cambios' : 'Añadir precio pactado'}
                        </button>
                    </div>
                </form>
            )}

            {cargando ? (
                <div className="uk-text-center" style={{padding: 16}}><div uk-spinner="ratio: 0.8"></div></div>
            ) : visibles.length === 0 ? (
                <div style={{textAlign: 'center', padding: 20, color: '#94a3b8'}}>
                    {precios.length ? 'No hay precios pactados vigentes' : 'Sin precios pactados'}
                </div>
            ) : (
                <div className="uk-overflow-auto">
                    <table className="uk-table uk-table-divider uk-table-small" style={{margin: 0}}>
                        <thead>
                        <tr>
                            <th>Producto</th>
                            <th style={{textAlign: 'right'}}>Pactado</th>
                            <th style={{textAlign: 'right'}}>Normal</th>
                            <th>Vigencia</th>
                            <th>Estado</th>
                            {canEdit && <th></th>}
                        </tr>
                        </thead>
                        <tbody>
                        {visibles.map((p) => {
                            const est = ESTADOS[p.estado] || {texto: p.estado, cls: ''};
                            return (
                                <tr key={p.id}
                                    title={p.createdBy ? `Creado por ${p.createdBy}` : undefined}
                                    style={{
                                        opacity: p.estado === 'finalizado' ? 0.6 : 1,
                                        background: form.id === p.id ? '#eff6ff' : undefined,
                                    }}>
                                    <td style={{fontWeight: 500}}>
                                        {p.productName}
                                        {p.note && <div style={{fontSize: '0.72rem', color: '#64748b', fontWeight: 400}}>{p.note}</div>}
                                    </td>
                                    <td style={{textAlign: 'right', fontWeight: 700}}>{formatEUR(p.price)}</td>
                                    <td style={{textAlign: 'right', color: '#64748b', fontSize: '0.8rem'}}>{formatEUR(p.basePrice)}</td>
                                    <td style={{fontSize: '0.78rem', whiteSpace: 'nowrap'}}>
                                        {fechaCorta(p.validFrom)}
                                        <div style={{color: '#64748b'}}>{p.validTo ? `hasta ${fechaCorta(p.validTo)}` : 'sin fin'}</div>
                                    </td>
                                    <td><span className={`uk-label ${est.cls}`} style={{fontSize: '0.6rem'}}>{est.texto}</span></td>
                                    {canEdit && (
                                        <td style={{whiteSpace: 'nowrap', textAlign: 'right'}}>
                                            {p.estado !== 'finalizado' && (
                                                <>
                                                    <button type="button" className="uk-icon-button" title="Editar"
                                                            uk-icon="icon: pencil; ratio: 0.7" style={{width: 26, height: 26}}
                                                            onClick={() => editar(p)}></button>
                                                    <button type="button" className="uk-icon-button" title="Finalizar"
                                                            uk-icon="icon: close; ratio: 0.7" style={{width: 26, height: 26, marginLeft: 4}}
                                                            onClick={() => finalizar(p)}></button>
                                                </>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                        </tbody>
                    </table>
                </div>
            )}

            {numFinalizados > 0 && (
                <button type="button" className="uk-button uk-button-link" style={{fontSize: '0.75rem', marginTop: 8}}
                        onClick={() => setVerFinalizados((v) => !v)}>
                    {verFinalizados ? 'Ocultar finalizados' : `Ver finalizados (${numFinalizados})`}
                </button>
            )}
        </div>
    );
}
