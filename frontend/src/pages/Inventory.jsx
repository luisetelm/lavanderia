import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import * as XLSX from 'xlsx';
import {fetchProducts, updateProduct, fetchItineraries, fetchProductCategories, fetchProductsSummary, archiveProducts} from '../api.js';
import {avisar} from '../utils/dialogo.js';
import {copiaDeProducto} from '../utils/productos.js';
import ProductModal from '../components/ProductModal.jsx';
import BulkPriceModal from '../components/BulkPriceModal.jsx';
import ProductCategoriesModal from '../components/ProductCategoriesModal.jsx';
import PageToolbar from '../components/PageToolbar.jsx';
import {Sparkline} from '../components/ProductCharts.jsx';

// Catálogo de productos. Cualquier empleado lo consulta, lo filtra y lo exporta;
// sólo administración crea, edita, duplica, archiva y cambia precios en bloque
// (la API lo impone). Los archivados no salen en el TPV pero conservan su ficha.
// Búsqueda, filtros y orden se recuerdan en este navegador.

const IVA = 21;
const PREFS = 'inventario_prefs';
const PREFS_INICIALES = {
    search: '',
    sort: {key: 'name', direction: 'ascending'},
    estado: 'activos',
    tipo: 'todos',
    actividad: 'todos',
    categoria: 'todas',
    itinerario: 'todos',
};
// Columnas que interesa ver de mayor a menor al ordenar por ellas
const DESCENDENTE_PRIMERO = ['unidades30', 'ultimoPedido'];

function leerPrefs() {
    try {
        return {...PREFS_INICIALES, ...JSON.parse(localStorage.getItem(PREFS) || '{}')};
    } catch {
        return PREFS_INICIALES;
    }
}

function formatPriceWithTax(val, taxPct = IVA) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "-";
    const priceWithTax = Number(val);
    if (priceWithTax === 0) return "0,00 €";
    const netBase = priceWithTax / (1 + taxPct / 100);
    const fmtNet = netBase.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtTotal = priceWithTax.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    return (
        <span style={{ whiteSpace: 'nowrap' }}>
            <strong>{fmtTotal} €</strong> <span style={{ color: '#94a3b8', fontSize: '0.75em' }}>({fmtNet} + {taxPct}%)</span>
        </span>
    );
}

function formatWeight(val) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return "-";
    return `${Number(val)} kg`;
}

const fechaCorta = (s) => (s ? s.split('-').reverse().join('/') : '');
const diasDesde = (s, hoy) => (Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / 86400000;
const botonIcono = { padding: '2px 8px' };

export default function Inventory({ token, user }) {
    const esAdmin = user?.role === 'admin';
    const [products, setProducts] = useState([]);
    const [itineraries, setItineraries] = useState([]);
    const [categorias, setCategorias] = useState([]);
    const [resumen, setResumen] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [prefs, setPrefs] = useState(leerPrefs);
    const [modal, setModal] = useState(null);              // {initial, titulo}
    const [seleccion, setSeleccion] = useState(() => new Set());
    const [cambioPrecios, setCambioPrecios] = useState(null); // ids fijados al abrir el modal
    const [verCategorias, setVerCategorias] = useState(false);

    // Edición rápida en la fila
    const [inlineEditId, setInlineEditId] = useState(null);
    const [inlineValues, setInlineValues] = useState({});
    const [inlineSaving, setInlineSaving] = useState(false);

    const setPref = (clave, valor) => setPrefs((p) => {
        const nuevas = {...p, [clave]: valor};
        try { localStorage.setItem(PREFS, JSON.stringify(nuevas)); } catch { /* sin preferencias guardadas */ }
        return nuevas;
    });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [prods, itins, cats] = await Promise.all([
                fetchProducts(token, {archived: 'all'}),
                fetchItineraries(token),
                fetchProductCategories(token),
            ]);
            setProducts(Array.isArray(prods) ? prods : []);
            setItineraries(Array.isArray(itins) ? itins : []);
            setCategorias(Array.isArray(cats) ? cats : []);
            setError("");
        } catch {
            setError("No se pudo cargar el inventario");
        } finally {
            setLoading(false);
        }
        // La actividad es accesoria: si falla, el catálogo se ve igual.
        fetchProductsSummary(token).then(setResumen).catch(() => setResumen(null));
    }, [token]);

    useEffect(() => { load(); }, [load]);

    const lista = useMemo(() => {
        const term = prefs.search.trim().toLowerCase();
        const actividad = (p) => resumen?.productos?.[p.id];

        const filtrados = products.filter((p) => {
            if (prefs.estado === 'activos' && p.archivedAt) return false;
            if (prefs.estado === 'archivados' && !p.archivedAt) return false;
            if (prefs.tipo !== 'todos' && p.type !== prefs.tipo) return false;
            if (prefs.categoria === 'sin' && p.categoryId) return false;
            if (!['todas', 'sin'].includes(prefs.categoria) && p.categoryId !== Number(prefs.categoria)) return false;
            if (prefs.itinerario === 'sin' && p.itineraryId) return false;
            if (!['todos', 'sin'].includes(prefs.itinerario) && p.itineraryId !== Number(prefs.itinerario)) return false;
            if (prefs.actividad !== 'todos' && resumen) {
                const a = actividad(p);
                if (prefs.actividad === 'recientes' && !(a?.unidades30 > 0)) return false;
                if (prefs.actividad === 'dormidos' && a?.ultimoPedido && diasDesde(a.ultimoPedido, resumen.hoy) < 90) return false;
            }
            if (!term) return true;
            return [p.name, p.sku, p.description, p.category?.name].some((t) => (t || '').toLowerCase().includes(term));
        });

        const {key, direction} = prefs.sort;
        const signo = direction === 'ascending' ? 1 : -1;
        const valor = (p) => {
            if (key === 'unidades30') return actividad(p)?.unidades30 || 0;
            if (key === 'ultimoPedido') return actividad(p)?.ultimoPedido || '';
            if (['basePrice', 'bigClientPrice', 'weight'].includes(key)) return Number(p[key]) || 0;
            return (p[key] ?? '').toString().toLowerCase();
        };
        return filtrados.sort((a, b) => {
            const va = valor(a);
            const vb = valor(b);
            const cmp = typeof va === 'number' ? va - vb : va.localeCompare(vb, 'es');
            return signo * cmp || a.name.localeCompare(b.name, 'es');
        });
    }, [products, prefs, resumen]);

    // Las acciones en bloque sólo afectan a lo seleccionado que se ve.
    const seleccionados = lista.filter((p) => seleccion.has(p.id));
    const todosMarcados = lista.length > 0 && seleccionados.length === lista.length;
    const numArchivados = products.filter((p) => p.archivedAt).length;

    const alternar = (id) => setSeleccion((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    });
    const alternarTodos = () => setSeleccion(todosMarcados ? new Set() : new Set(lista.map((p) => p.id)));

    const ordenar = (key) => setPref('sort', {
        key,
        direction: prefs.sort.key === key
            ? (prefs.sort.direction === 'ascending' ? 'descending' : 'ascending')
            : (DESCENDENTE_PRIMERO.includes(key) ? 'descending' : 'ascending'),
    });

    const cabecera = (key, texto, style = {}) => (
        <th onClick={() => ordenar(key)} style={{ cursor: 'pointer', whiteSpace: 'nowrap', ...style }}>
            {texto}{' '}
            {prefs.sort.key === key && (
                <span uk-icon={`icon: chevron-${prefs.sort.direction === 'ascending' ? 'up' : 'down'}; ratio: 0.7`}></span>
            )}
        </th>
    );

    const opcion = (clave, valor, label) => ({label, active: prefs[clave] === valor, onClick: () => setPref(clave, valor)});
    const itinerariosUsados = itineraries.filter((it) => products.some((p) => p.itineraryId === it.id));
    const filtros = [
        {label: 'Estado', active: prefs.estado !== 'activos', options: [
            opcion('estado', 'activos', 'Activos'), opcion('estado', 'archivados', `Archivados (${numArchivados})`), opcion('estado', 'todos', 'Todos'),
        ]},
        {label: 'Tipo', active: prefs.tipo !== 'todos', options: [
            opcion('tipo', 'todos', 'Todos'), opcion('tipo', 'service', 'Servicios'), opcion('tipo', 'item', 'Ítems'),
        ]},
        {label: 'Actividad', active: prefs.actividad !== 'todos', options: [
            opcion('actividad', 'todos', 'Todos'), opcion('actividad', 'recientes', 'Con pedidos en 30 días'), opcion('actividad', 'dormidos', 'Sin pedidos en 90 días'),
        ]},
        {label: 'Categoría', active: prefs.categoria !== 'todas', options: [
            opcion('categoria', 'todas', 'Todas'),
            ...categorias.map((c) => opcion('categoria', String(c.id), c.name)),
            opcion('categoria', 'sin', 'Sin categoría'),
        ]},
        {label: 'Itinerario', active: prefs.itinerario !== 'todos', options: [
            opcion('itinerario', 'todos', 'Todos'),
            ...itinerariosUsados.map((it) => opcion('itinerario', String(it.id), it.name)),
            opcion('itinerario', 'sin', 'Sin itinerario'),
        ]},
    ];
    const hayFiltros = filtros.some((f) => f.active) || prefs.search.trim() !== '';
    const quitarFiltros = () => {
        ['search', 'estado', 'tipo', 'actividad', 'categoria', 'itinerario'].forEach((k) => setPref(k, PREFS_INICIALES[k]));
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

    const archivarSeleccion = async (archivar) => {
        try {
            const r = await archiveProducts(token, seleccionados.map((p) => p.id), archivar);
            avisar(archivar
                ? `${r.actualizados} ${r.actualizados === 1 ? 'producto archivado' : 'productos archivados'}: ya no salen en el TPV`
                : `${r.actualizados} ${r.actualizados === 1 ? 'producto restaurado' : 'productos restaurados'}`, 'success');
            setSeleccion(new Set());
            load();
        } catch (err) {
            setError(err.error || 'No se pudo cambiar el estado de los productos');
        }
    };

    const exportar = () => {
        const filas = seleccionados.length ? seleccionados : lista;
        const aoa = [[
            'Nombre', 'SKU', 'Tipo', 'Categoría', 'Itinerario', 'Precio (IVA incl.)', 'Precio sin IVA',
            'Tarifa gran cliente (IVA incl.)', 'Peso (kg)', 'Uds. últimos 30 días', 'Último pedido', 'Estado',
        ]];
        for (const p of filas) {
            const a = resumen?.productos?.[p.id];
            const precio = Number(p.basePrice) || 0;
            aoa.push([
                p.name, p.sku || '', p.type === 'service' ? 'Servicio' : 'Ítem', p.category?.name || '', p.itinerary?.name || '',
                precio, Number((precio / (1 + IVA / 100)).toFixed(2)), Number(p.bigClientPrice) || 0, Number(p.weight) || 0,
                a?.unidades30 ?? 0, fechaCorta(a?.ultimoPedido), p.archivedAt ? 'Archivado' : 'Activo',
            ]);
        }
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Productos');
        XLSX.writeFile(wb, `productos_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    // Función para renderizar el itinerario asignado
    const renderServiceOptions = (product) => {
        if (product?.itineraryId) {
            const itin = itineraries.find(i => i.id === product.itineraryId);
            if (itin) {
                return (
                    <span className="uk-badge" style={{ background: '#3b82f6', fontSize: '0.7rem', whiteSpace: 'nowrap', padding: '0 8px' }}>
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

    const campoRapido = (product, clave, props = {}) => (
        <input
            className="uk-input uk-form-small"
            value={inlineValues[clave]}
            onChange={e => setInlineValues(v => ({...v, [clave]: e.target.value}))}
            onKeyDown={e => {
                if (e.key === 'Enter') saveInlineEdit(product.id);
                if (e.key === 'Escape') cancelInlineEdit();
            }}
            {...props}
        />
    );

    const selActivos = seleccionados.some((p) => !p.archivedAt);
    const selArchivados = seleccionados.some((p) => p.archivedAt);

    return (
        <div>
            <PageToolbar
                title="Inventario"
                filters={filtros}
                actions={
                    <>
                        <button className="uk-button uk-button-small uk-button-default" onClick={exportar} disabled={!lista.length} type="button"
                                title={seleccionados.length ? 'Exporta los productos seleccionados' : 'Exporta los productos que se ven'}>
                            <span uk-icon="icon: download; ratio: 0.8" style={{ marginRight: 4 }}></span> Excel
                        </button>
                        {esAdmin && (
                            <button className="uk-button uk-button-small uk-button-default" onClick={() => setVerCategorias(true)} type="button">
                                <span uk-icon="icon: tag; ratio: 0.8" style={{ marginRight: 4 }}></span> Categorías
                            </button>
                        )}
                        {esAdmin && (
                            <button className="uk-button uk-button-small uk-button-primary" onClick={() => setModal({initial: {}})} type="button">
                                <span uk-icon="icon: plus; ratio: 0.8" style={{ marginRight: 4 }}></span> Nuevo producto
                            </button>
                        )}
                    </>
                }
            />

            {error && (
                <div className="uk-alert-danger" uk-alert="">
                    <p>{error}</p>
                </div>
            )}

            <ProductModal
                token={token}
                initial={modal?.initial || {}}
                titulo={modal?.titulo}
                isOpen={!!modal}
                itineraries={itineraries}
                onSave={() => {
                    setModal(null);
                    load();
                }}
                onClose={() => setModal(null)}
            />

            {cambioPrecios && (
                <BulkPriceModal
                    token={token}
                    ids={cambioPrecios}
                    onClose={() => setCambioPrecios(null)}
                    onDone={(r) => {
                        setCambioPrecios(null);
                        avisar(`${r.cambios.length} ${r.cambios.length === 1 ? 'precio cambiado' : 'precios cambiados'}`, 'success');
                        load();
                    }}
                />
            )}

            {verCategorias && (
                <ProductCategoriesModal token={token} onClose={() => setVerCategorias(false)} onChange={load}/>
            )}

            <div className="section-content">
                <div className="uk-margin-small">
                    <div className="uk-search uk-search-default uk-width-1-1">
                        <span uk-search-icon=""></span>
                        <input
                            className="uk-search-input"
                            type="search"
                            placeholder="Buscar por nombre, SKU, categoría o descripción..."
                            value={prefs.search}
                            onChange={(e) => setPref('search', e.target.value)}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 10px', fontSize: '0.8rem', color: '#64748b' }}>
                    <span>
                        {lista.length} de {products.length} productos{numArchivados > 0 && ` · ${numArchivados} archivados`}
                        {hayFiltros && (
                            <button type="button" className="uk-button uk-button-link" style={{ fontSize: '0.75rem', marginLeft: 8 }} onClick={quitarFiltros}>
                                Quitar filtros
                            </button>
                        )}
                    </span>
                    {resumen && <span>Últimos 30 días: unidades pedidas; la línea, las últimas 12 semanas.</span>}
                </div>

                {esAdmin && seleccionados.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', marginBottom: 10, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, fontSize: '0.85rem' }}>
                        <strong>{seleccionados.length} {seleccionados.length === 1 ? 'seleccionado' : 'seleccionados'}</strong>
                        <button type="button" className="uk-button uk-button-primary uk-button-small" onClick={() => setCambioPrecios(seleccionados.map((p) => p.id))}>
                            Cambiar precios
                        </button>
                        {selActivos && (
                            <button type="button" className="uk-button uk-button-default uk-button-small" onClick={() => archivarSeleccion(true)}>Archivar</button>
                        )}
                        {selArchivados && (
                            <button type="button" className="uk-button uk-button-default uk-button-small" onClick={() => archivarSeleccion(false)}>Restaurar</button>
                        )}
                        <button type="button" className="uk-button uk-button-default uk-button-small" onClick={exportar}>Exportar selección</button>
                        <button type="button" className="uk-button uk-button-link" style={{ fontSize: '0.75rem' }} onClick={() => setSeleccion(new Set())}>
                            Quitar selección
                        </button>
                    </div>
                )}

                {loading && products.length === 0 ? (
                    <div key="cargando" className="uk-text-center uk-padding">
                        <div uk-spinner="ratio: 1"></div>
                        <p>Cargando productos...</p>
                    </div>
                ) : (
                    <div key="tabla" className="uk-overflow-auto" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
                        <table className="uk-table uk-table-hover uk-table-middle uk-table-divider">
                            <thead>
                            <tr>
                                {esAdmin && (
                                    <th style={{ width: 28 }}>
                                        <input className="uk-checkbox" type="checkbox" checked={todosMarcados} onChange={alternarTodos}
                                               aria-label="Seleccionar todos los productos que se ven"/>
                                    </th>
                                )}
                                {cabecera('name', 'Nombre')}
                                {cabecera('type', 'Tipo')}
                                {cabecera('basePrice', 'Precio')}
                                {cabecera('bigClientPrice', 'Tarifa G. Clientes')}
                                <th>Itinerario</th>
                                {cabecera('weight', 'Peso')}
                                {cabecera('unidades30', 'Últimos 30 días')}
                                {cabecera('ultimoPedido', 'Último pedido')}
                                <th>Acciones</th>
                            </tr>
                            </thead>
                            <tbody>
                            {lista.map((product) => {
                                const editando = inlineEditId === product.id;
                                const a = resumen?.productos?.[product.id];
                                const marcado = seleccion.has(product.id);
                                return (
                                    <tr key={product.id} style={{ background: marcado ? '#f0f9ff' : undefined }}>
                                        {esAdmin && (
                                            <td>
                                                <input className="uk-checkbox" type="checkbox" checked={marcado} onChange={() => alternar(product.id)}
                                                       aria-label={`Seleccionar ${product.name}`}/>
                                            </td>
                                        )}
                                        <td style={{ opacity: product.archivedAt ? 0.6 : 1 }}>
                                            {editando ? campoRapido(product, 'name', { style: { minWidth: 120 }, autoFocus: true }) : (
                                                <>
                                                    <Link to={`/productos/${product.id}`} style={{ fontWeight: 500 }} title="Ver ficha y estadísticas">
                                                        {product.name}
                                                    </Link>
                                                    {product.archivedAt && (
                                                        <span className="uk-label" style={{ fontSize: '0.6rem', marginLeft: 6, background: '#64748b' }}>Archivado</span>
                                                    )}
                                                    {(product.sku || product.category) && (
                                                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                                            {[product.sku, product.category?.name].filter(Boolean).join(' · ')}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`uk-label ${product.type === "service" ? "uk-label-warning" : "uk-label-success"}`}>
                                                {product.type === "service" ? "Servicio" : "Ítem"}
                                            </span>
                                        </td>
                                        <td>
                                            {editando ? campoRapido(product, 'basePrice', { type: 'number', step: '0.01', style: { width: 80 } }) : (
                                                <span style={{ cursor: esAdmin ? 'pointer' : undefined }} onDoubleClick={() => startInlineEdit(product)}>
                                                    {formatPriceWithTax(product.basePrice)}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {editando ? campoRapido(product, 'bigClientPrice', { type: 'number', step: '0.01', style: { width: 80 } }) : (
                                                <span style={{ cursor: esAdmin ? 'pointer' : undefined }} onDoubleClick={() => startInlineEdit(product)}>
                                                    {formatPriceWithTax(product.bigClientPrice)}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {editando ? (
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
                                                <span style={{ cursor: esAdmin ? 'pointer' : undefined }} onDoubleClick={() => startInlineEdit(product)}>
                                                    {renderServiceOptions(product)}
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ whiteSpace: 'nowrap' }}>
                                            {editando ? campoRapido(product, 'weight', { type: 'number', step: '0.01', style: { width: 65 } }) : (
                                                <span style={{ cursor: esAdmin ? 'pointer' : undefined }} onDoubleClick={() => startInlineEdit(product)}>
                                                    {formatWeight(product.weight)}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {!resumen ? '—' : (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <Sparkline
                                                        valores={a?.semanas || resumen.semanas.map(() => 0)}
                                                        etiqueta={`Unidades por semana en las últimas 12 semanas: ${(a?.semanas || []).join(', ') || 'ninguna'}`}
                                                    />
                                                    <span style={{ fontWeight: 600, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: a?.unidades30 ? '#1e293b' : '#94a3b8' }}>
                                                        {(a?.unidades30 || 0).toLocaleString('es-ES')}
                                                    </span>
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                                            {!resumen ? '—' : a?.ultimoPedido ? fechaCorta(a.ultimoPedido) : 'Nunca'}
                                        </td>
                                        <td>
                                            {editando ? (
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <button
                                                        className="uk-button uk-button-primary uk-button-small"
                                                        onClick={() => saveInlineEdit(product.id)}
                                                        disabled={inlineSaving}
                                                        style={botonIcono}
                                                    >
                                                        {inlineSaving ? <span uk-spinner="ratio: 0.4"></span> : <span uk-icon="icon: check; ratio: 0.75"></span>}
                                                    </button>
                                                    <button className="uk-button uk-button-default uk-button-small" onClick={cancelInlineEdit} style={botonIcono}>
                                                        <span uk-icon="icon: close; ratio: 0.75"></span>
                                                    </button>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <Link to={`/productos/${product.id}`} className="uk-button uk-button-default uk-button-small"
                                                          title="Ficha y estadísticas" style={botonIcono}>
                                                        <span uk-icon="icon: album; ratio: 0.75"></span>
                                                    </Link>
                                                    {esAdmin && (
                                                        <>
                                                            <button className="uk-button uk-button-default uk-button-small" onClick={() => startInlineEdit(product)}
                                                                    title="Edición rápida" style={botonIcono}>
                                                                <span uk-icon="icon: pencil; ratio: 0.75"></span>
                                                            </button>
                                                            <button className="uk-button uk-button-default uk-button-small"
                                                                    onClick={() => setModal({initial: copiaDeProducto(product), titulo: 'Duplicar producto'})}
                                                                    title="Duplicar" style={botonIcono}>
                                                                <span uk-icon="icon: copy; ratio: 0.75"></span>
                                                            </button>
                                                            <button className="uk-button uk-button-primary uk-button-small" onClick={() => setModal({initial: product})}
                                                                    title="Editar completo" style={botonIcono}>
                                                                <span uk-icon="icon: settings; ratio: 0.75"></span>
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            </tbody>
                        </table>

                        {lista.length === 0 && (
                            <div className="uk-text-center uk-margin uk-text-muted">
                                {products.length ? 'Ningún producto coincide con la búsqueda o los filtros.' : 'No hay productos.'}
                                {hayFiltros && (
                                    <button type="button" className="uk-button uk-button-link" style={{ marginLeft: 8 }} onClick={quitarFiltros}>
                                        Quitar filtros
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
