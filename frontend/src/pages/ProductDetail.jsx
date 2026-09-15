import React, {useEffect, useMemo, useState, useCallback} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {fetchProduct, fetchProductStats, fetchProductLines, fetchProductAgreedPrices, fetchItineraries, archiveProducts} from '../api.js';
import {copiaDeProducto} from '../utils/productos.js';
import {formatEUR} from '../utils/format.js';
import {getDateRange} from '../utils/dates.js';
import {avisar} from '../utils/dialogo.js';
import PageToolbar from '../components/PageToolbar.jsx';
import DateRangeSelector from '../components/DateRangeSelector.jsx';
import ProductModal from '../components/ProductModal.jsx';
import {ColumnChart, Medidor} from '../components/ProductCharts.jsx';

// Ficha de producto: datos, estadísticas de pedidos, pedidos, clientes y
// precios pactados.
//
// Las cifras las calcula el backend (GET /api/products/:id/stats) sin pedidos
// cancelados ni líneas anuladas. Los importes van con IVA, como el catálogo, y
// al lado sin IVA. Cualquier empleado consulta la ficha; sólo administración edita.

const IVA = 21;
const sinIva = (v) => Number(v || 0) / (1 + IVA / 100);
const uds = (n) => Number(n || 0).toLocaleString('es-ES');
const pctTexto = (n) => `${Number(n || 0).toLocaleString('es-ES', {maximumFractionDigits: 1})} %`;

const STATUS_LABELS = {
    pending: {text: 'Pendiente', cls: 'uk-label-warning'},
    ready: {text: 'Listo', cls: 'uk-label-success'},
    collected: {text: 'Recogido', cls: ''},
    cancelled: {text: 'Cancelado', cls: 'uk-label-danger'},
};

const ESTADOS_PACTO = {
    vigente: {texto: 'Vigente', cls: 'uk-label-success'},
    futuro: {texto: 'Próximo', cls: 'uk-label-warning'},
    finalizado: {texto: 'Finalizado', cls: ''},
};

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const AGRUPACION = {day: 'por día', week: 'por semana', month: 'por mes'};

const tabStyle = (active) => ({
    padding: '8px 16px',
    fontSize: '0.82rem',
    fontWeight: active ? 700 : 500,
    color: active ? '#048ABF' : '#64748b',
    borderBottom: active ? '2px solid #048ABF' : '2px solid transparent',
    background: 'none',
    borderTop: 'none',
    borderLeft: 'none',
    borderRight: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
});

const lbl = {fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase'};
const nota = {fontSize: '0.75rem', color: '#64748b', margin: '0 0 10px'};
const vacio = {textAlign: 'center', padding: 20, color: '#94a3b8'};
const titulo = {margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#1e293b'};

// 'YYYY-MM-DD' -> Date a medianoche local
const fechaLocal = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
};
const fechaCorta = (s) => fechaLocal(s).toLocaleDateString('es-ES', {day: 'numeric', month: 'short'});
const fechaMedia = (s) => fechaLocal(s).toLocaleDateString('es-ES', {dateStyle: 'medium'});

function etiquetasPeriodo(periodo, unidad) {
    const f = fechaLocal(periodo);
    if (unidad === 'month') {
        return {
            corta: f.toLocaleDateString('es-ES', {month: 'short', year: '2-digit'}),
            larga: f.toLocaleDateString('es-ES', {month: 'long', year: 'numeric'}),
        };
    }
    if (unidad === 'week') {
        return {corta: fechaCorta(periodo), larga: `Semana del ${f.toLocaleDateString('es-ES', {day: 'numeric', month: 'long', year: 'numeric'})}`};
    }
    return {corta: fechaCorta(periodo), larga: f.toLocaleDateString('es-ES', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'})};
}

function rangoInicial() {
    try {
        const guardado = JSON.parse(localStorage.getItem('producto_rango'));
        if (guardado?.from && guardado?.to) return guardado;
    } catch { /* sin preferencia guardada */ }
    const [from, to] = getDateRange('last_3');
    return {from, to};
}

function Importe({valor, fuerte = false}) {
    return (
        <>
            <span style={{fontWeight: fuerte ? 700 : 500}}>{formatEUR(valor)}</span>
            <div style={{fontSize: '0.72rem', color: '#64748b', fontWeight: 400}}>{formatEUR(sinIva(valor))} sin IVA</div>
        </>
    );
}

function Variacion({actual, anterior}) {
    const estilo = {fontSize: '0.72rem', marginTop: 4, color: '#64748b'};
    if (!anterior) return actual ? <div style={estilo}>Sin pedidos en el periodo anterior</div> : null;
    const pct = ((actual - anterior) / anterior) * 100;
    if (Math.abs(pct) < 0.5) return <div style={estilo}>Igual que en el periodo anterior</div>;
    const sube = pct > 0;
    return (
        <div style={{...estilo, color: sube ? '#15803d' : '#b91c1c', fontWeight: 600}}>
            {sube ? '▲ +' : '▼ −'}{Math.abs(pct).toLocaleString('es-ES', {maximumFractionDigits: 0})} %
            <span style={{color: '#64748b', fontWeight: 400}}> vs periodo anterior</span>
        </div>
    );
}

function Dato({etiqueta, valor, detalle, title, children}) {
    return (
        <div className="uk-card uk-card-default uk-card-body" style={{padding: '12px 14px'}} title={title}>
            <div style={lbl}>{etiqueta}</div>
            <div style={{fontSize: '1.25rem', fontWeight: 700, marginTop: 2, color: '#1e293b'}}>{valor}</div>
            {detalle && <div style={{fontSize: '0.75rem', color: '#64748b'}}>{detalle}</div>}
            {children}
        </div>
    );
}

function FichaDatos({producto}) {
    const precio = (v) => (
        <>
            {formatEUR(Number(v))} <span style={{color: '#64748b', fontSize: '0.75rem', fontWeight: 400}}>({formatEUR(sinIva(v))} sin IVA)</span>
        </>
    );
    const filas = [
        ['Tipo', producto.type === 'service' ? 'Servicio' : 'Ítem'],
        ['SKU', producto.sku || '—'],
        ['Categoría', producto.category?.name || 'Sin categoría'],
        ['Precio', precio(producto.basePrice)],
        ['Tarifa gran cliente', Number(producto.bigClientPrice) > 0 ? precio(producto.bigClientPrice) : '—'],
        ['Itinerario', producto.itinerary?.name || 'Sin itinerario'],
        ['Peso', `${Number(producto.weight || 0).toLocaleString('es-ES')} kg`],
        ['Carga del día', producto.countsForLoad ? `Factor ${Number(producto.workloadWeight).toLocaleString('es-ES')}` : 'No computa'],
        ['Etiquetas de lavado', producto.printWashLabel ? `${producto.labelCount} por unidad` : 'No imprime'],
    ];
    return (
        <div className="uk-card uk-card-default uk-card-body" style={{padding: '12px 16px', marginBottom: 16}}>
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px 16px'}}>
                {filas.map(([k, v]) => (
                    <div key={k}>
                        <div style={lbl}>{k}</div>
                        <div style={{fontSize: '0.88rem', color: '#1e293b', fontWeight: 500}}>{v}</div>
                    </div>
                ))}
            </div>
            {producto.description && <p style={{margin: '10px 0 0', fontSize: '0.8rem', color: '#64748b'}}>{producto.description}</p>}
        </div>
    );
}

function PestanaEstadisticas({stats}) {
    const [metrica, setMetrica] = useState('unidades');
    const [verTabla, setVerTabla] = useState(false);

    const serie = useMemo(() => stats.serie.map((p) => {
        const e = etiquetasPeriodo(p.periodo, stats.unidad);
        return {
            clave: p.periodo,
            etiqueta: e.corta,
            etiquetaLarga: e.larga,
            valor: metrica === 'importe' ? p.importe : p.unidades,
            detalle: metrica === 'importe' ? `${formatEUR(sinIva(p.importe))} sin IVA` : `${formatEUR(p.importe)} con IVA`,
        };
    }), [stats, metrica]);

    const semana = stats.diasSemana.map((d) => ({
        clave: d.dia,
        etiqueta: DIAS[d.dia - 1].slice(0, 3),
        etiquetaLarga: DIAS[d.dia - 1][0].toUpperCase() + DIAS[d.dia - 1].slice(1),
        valor: d.unidades,
        detalle: `${uds(d.pedidos)} pedidos`,
    }));

    if (!stats.actual.unidades) {
        return <div style={vacio}>No hay pedidos de este producto en el periodo elegido.</div>;
    }

    const esImporte = metrica === 'importe';
    return (
        <div>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8}}>
                <h4 style={titulo}>Evolución {AGRUPACION[stats.unidad]}</h4>
                <div style={{display: 'flex', gap: 4}}>
                    {[['unidades', 'Unidades'], ['importe', 'Importe con IVA']].map(([k, t]) => (
                        <button key={k} type="button" className={`page-toolbar-chip ${metrica === k ? 'active' : ''}`} onClick={() => setMetrica(k)}>
                            {t}
                        </button>
                    ))}
                </div>
            </div>
            <ColumnChart
                datos={serie}
                entero={!esImporte}
                formato={esImporte ? formatEUR : (v) => `${uds(v)} uds`}
                formatoEje={esImporte ? (v) => `${uds(v)} €` : uds}
                etiqueta={`Evolución de ${esImporte ? 'importe' : 'unidades'} ${AGRUPACION[stats.unidad]}`}
            />
            <button type="button" className="uk-button uk-button-link" style={{fontSize: '0.75rem', marginTop: 4}}
                    onClick={() => setVerTabla((v) => !v)}>
                {verTabla ? 'Ocultar tabla' : 'Ver como tabla'}
            </button>
            {verTabla && (
                <div className="uk-overflow-auto" style={{maxHeight: 280, marginTop: 6}}>
                    <table className="uk-table uk-table-divider uk-table-small" style={{margin: 0, fontVariantNumeric: 'tabular-nums'}}>
                        <thead>
                        <tr>
                            <th>Periodo</th>
                            <th style={{textAlign: 'right'}}>Unidades</th>
                            <th style={{textAlign: 'right'}}>Con IVA</th>
                            <th style={{textAlign: 'right'}}>Sin IVA</th>
                        </tr>
                        </thead>
                        <tbody>
                        {stats.serie.map((p, i) => (
                            <tr key={p.periodo}>
                                <td>{serie[i].etiquetaLarga}</td>
                                <td style={{textAlign: 'right'}}>{uds(p.unidades)}</td>
                                <td style={{textAlign: 'right'}}>{formatEUR(p.importe)}</td>
                                <td style={{textAlign: 'right'}}>{formatEUR(sinIva(p.importe))}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, marginTop: 20}}>
                <div>
                    <h4 style={{...titulo, marginBottom: 8}}>Unidades por día de la semana</h4>
                    <ColumnChart datos={semana} entero alto={180} formato={(v) => `${uds(v)} uds`} formatoEje={uds}
                                 etiqueta="Unidades por día de la semana"/>
                </div>
                <div>
                    <h4 style={{...titulo, marginBottom: 4}}>Se pide junto con</h4>
                    <p style={nota}>Qué parte de los pedidos de este producto incluye también cada uno de estos.</p>
                    {stats.juntos.length === 0 ? (
                        <div style={vacio}>Siempre se ha pedido solo.</div>
                    ) : (
                        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                            {stats.juntos.map((j) => (
                                <div key={j.productId}>
                                    <div style={{display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.8rem', marginBottom: 3}}>
                                        <Link to={`/productos/${j.productId}`} style={{color: '#1e293b', minWidth: 0}}>
                                            {j.name}
                                        </Link>
                                        <span style={{whiteSpace: 'nowrap', color: '#1e293b', fontWeight: 600}}>
                                            {pctTexto(j.pct)} <span style={{color: '#64748b', fontWeight: 400}}>· {uds(j.pedidos)} ped.</span>
                                        </span>
                                    </div>
                                    <Medidor pct={j.pct}/>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function PestanaPedidos({token, productoId, rango}) {
    const navigate = useNavigate();
    const TAM = 20;
    const [pagina, setPagina] = useState(0);
    const [res, setRes] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { setPagina(0); }, [productoId, rango.from, rango.to]);

    useEffect(() => {
        let vigente = true;
        setCargando(true);
        setError('');
        fetchProductLines(token, productoId, {from: rango.from, to: rango.to, page: pagina, size: TAM})
            .then((r) => { if (vigente) setRes(r); })
            .catch((e) => { if (vigente) setError(e.error || 'No se pudieron cargar los pedidos'); })
            .finally(() => { if (vigente) setCargando(false); });
        return () => { vigente = false; };
    }, [token, productoId, rango.from, rango.to, pagina]);

    if (error) return <div className="uk-alert-danger" uk-alert="true"><p>{error}</p></div>;
    if (!res) return <div key="cargando" className="uk-text-center" style={{padding: 16}}><div uk-spinner="ratio: 0.8"></div></div>;

    const {data, meta} = res;
    return (
        <div key="datos" style={{opacity: cargando ? 0.5 : 1, transition: 'opacity 0.15s'}}>
            <p style={nota}>Incluye las líneas anuladas y los pedidos cancelados, que no cuentan en las estadísticas.</p>
            {data.length === 0 ? (
                <div style={vacio}>Sin pedidos en el periodo</div>
            ) : (
                <div className="uk-overflow-auto">
                    <table className="uk-table uk-table-divider uk-table-small uk-table-hover" style={{margin: 0}}>
                        <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Pedido</th>
                            <th>Cliente</th>
                            <th style={{textAlign: 'right'}}>Uds</th>
                            <th style={{textAlign: 'right'}}>Precio</th>
                            <th style={{textAlign: 'right'}}>Importe</th>
                            <th>Estado</th>
                        </tr>
                        </thead>
                        <tbody>
                        {data.map((l) => {
                            const s = STATUS_LABELS[l.status] || {text: l.status, cls: ''};
                            const tachado = l.voidedAt ? {textDecoration: 'line-through', color: '#94a3b8'} : {};
                            return (
                                <tr key={l.id} style={{cursor: 'pointer'}}
                                    onClick={() => navigate('/tareas', {state: {filterOrderId: l.orderId, orderNumber: l.orderNum}})}>
                                    <td style={{fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap'}}>
                                        {new Date(l.createdAt).toLocaleDateString('es-ES', {dateStyle: 'medium'})}
                                    </td>
                                    <td style={{fontWeight: 500}}>{l.orderNum}</td>
                                    <td style={{fontSize: '0.85rem'}}>{l.cliente || <span style={{color: '#94a3b8'}}>Sin cliente</span>}</td>
                                    <td style={{textAlign: 'right', ...tachado}}>{uds(l.quantity)}</td>
                                    <td style={{textAlign: 'right', whiteSpace: 'nowrap', ...tachado}}>
                                        {formatEUR(l.unitPrice)}
                                        {l.discount > 0 && <div style={{fontSize: '0.7rem', color: '#64748b'}}>−{uds(l.discount)} %</div>}
                                    </td>
                                    <td style={{textAlign: 'right', whiteSpace: 'nowrap', ...tachado}}><Importe valor={l.totalPrice}/></td>
                                    <td>
                                        {l.voidedAt ? (
                                            <span className="uk-label uk-label-danger" style={{fontSize: '0.6rem'}} title={l.voidReason || undefined}>Anulada</span>
                                        ) : (
                                            <span className={`uk-label ${s.cls}`} style={{fontSize: '0.6rem'}}>{s.text}</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        </tbody>
                    </table>
                </div>
            )}
            {meta.pages > 1 && (
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: '0.8rem', color: '#64748b'}}>
                    <span>{uds(meta.total)} líneas · página {meta.page + 1} de {meta.pages}</span>
                    <div style={{display: 'flex', gap: 4}}>
                        <button type="button" className="uk-button uk-button-default uk-button-small"
                                disabled={meta.page === 0 || cargando} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
                        <button type="button" className="uk-button uk-button-default uk-button-small"
                                disabled={meta.page + 1 >= meta.pages || cargando} onClick={() => setPagina((p) => p + 1)}>Siguiente</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function PestanaClientes({stats}) {
    const navigate = useNavigate();
    if (!stats.clientes.length) return <div style={vacio}>Sin pedidos en el periodo</div>;
    return (
        <div>
            <p style={nota}>Los 10 que más unidades han pedido en el periodo.</p>
            <div className="uk-overflow-auto">
                <table className="uk-table uk-table-divider uk-table-small uk-table-hover" style={{margin: 0}}>
                    <thead>
                    <tr>
                        <th>Cliente</th>
                        <th style={{textAlign: 'right'}}>Pedidos</th>
                        <th style={{textAlign: 'right'}}>Uds</th>
                        <th style={{textAlign: 'right'}}>Importe</th>
                        <th>Último pedido</th>
                    </tr>
                    </thead>
                    <tbody>
                    {stats.clientes.map((c) => (
                        <tr key={c.clientId ?? 'sin-cliente'} style={{cursor: c.clientId ? 'pointer' : 'default'}}
                            onClick={() => c.clientId && navigate(`/usuarios/${c.clientId}`)}>
                            <td style={{fontWeight: 500}}>{c.nombre || <span style={{color: '#94a3b8', fontWeight: 400}}>Sin cliente</span>}</td>
                            <td style={{textAlign: 'right'}}>{uds(c.pedidos)}</td>
                            <td style={{textAlign: 'right'}}>{uds(c.unidades)}</td>
                            <td style={{textAlign: 'right', whiteSpace: 'nowrap'}}><Importe valor={c.importe}/></td>
                            <td style={{fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap'}}>{fechaMedia(c.ultimoPedido)}</td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function PestanaPrecios({token, productoId}) {
    const navigate = useNavigate();
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState('');
    const [verFinalizados, setVerFinalizados] = useState(false);

    useEffect(() => {
        let vigente = true;
        fetchProductAgreedPrices(token, productoId)
            .then((r) => { if (vigente) setDatos(r); })
            .catch((e) => { if (vigente) setError(e.error || 'No se pudieron cargar los precios pactados'); });
        return () => { vigente = false; };
    }, [token, productoId]);

    if (error) return <div className="uk-alert-danger" uk-alert="true"><p>{error}</p></div>;
    if (!datos) return <div key="cargando" className="uk-text-center" style={{padding: 16}}><div uk-spinner="ratio: 0.8"></div></div>;

    const activos = datos.precios.filter((p) => p.estado !== 'finalizado');
    const numFinalizados = datos.precios.length - activos.length;
    const visibles = verFinalizados ? datos.precios : activos;

    return (
        <div key="datos">
            <p style={nota}>Clientes con un precio distinto del de catálogo para este producto. Se crean y cambian desde la ficha de cada cliente.</p>
            {visibles.length === 0 ? (
                <div style={vacio}>{datos.precios.length ? 'No hay precios pactados vigentes' : 'Ningún cliente tiene precio pactado para este producto'}</div>
            ) : (
                <div className="uk-overflow-auto">
                    <table className="uk-table uk-table-divider uk-table-small uk-table-hover" style={{margin: 0}}>
                        <thead>
                        <tr>
                            <th>Cliente</th>
                            <th style={{textAlign: 'right'}}>Pactado</th>
                            <th style={{textAlign: 'right'}}>Frente al normal</th>
                            <th>Vigencia</th>
                            <th>Estado</th>
                        </tr>
                        </thead>
                        <tbody>
                        {visibles.map((p) => {
                            const est = ESTADOS_PACTO[p.estado] || {texto: p.estado, cls: ''};
                            const dif = datos.basePrice > 0 ? ((p.price - datos.basePrice) / datos.basePrice) * 100 : null;
                            return (
                                <tr key={p.id} style={{cursor: 'pointer', opacity: p.estado === 'finalizado' ? 0.6 : 1}}
                                    onClick={() => navigate(`/usuarios/${p.clientId}`)}>
                                    <td style={{fontWeight: 500}}>
                                        {p.cliente}
                                        {p.note && <div style={{fontSize: '0.72rem', color: '#64748b', fontWeight: 400}}>{p.note}</div>}
                                    </td>
                                    <td style={{textAlign: 'right', whiteSpace: 'nowrap'}}><Importe valor={p.price} fuerte/></td>
                                    <td style={{textAlign: 'right', fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap'}}>
                                        {dif === null ? '—' : `${dif > 0 ? '+' : dif < 0 ? '−' : ''}${Math.abs(dif).toLocaleString('es-ES', {maximumFractionDigits: 1})} %`}
                                    </td>
                                    <td style={{fontSize: '0.78rem', whiteSpace: 'nowrap'}}>
                                        {fechaMedia(p.validFrom)}
                                        <div style={{color: '#64748b'}}>{p.validTo ? `hasta ${fechaMedia(p.validTo)}` : 'sin fin'}</div>
                                    </td>
                                    <td><span className={`uk-label ${est.cls}`} style={{fontSize: '0.6rem'}}>{est.texto}</span></td>
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

export default function ProductDetail({token, user}) {
    const {id} = useParams();
    const productoId = Number(id);
    const navigate = useNavigate();
    const esAdmin = user?.role === 'admin';

    const [producto, setProducto] = useState(null);
    const [error, setError] = useState('');
    const [itinerarios, setItinerarios] = useState([]);
    const [editando, setEditando] = useState(false);
    const [duplicando, setDuplicando] = useState(false);
    const [rango, setRango] = useState(rangoInicial);
    const [stats, setStats] = useState(null);
    const [cargandoStats, setCargandoStats] = useState(false);
    const [errorStats, setErrorStats] = useState('');
    const [pestana, setPestana] = useState('stats');

    const cargarProducto = useCallback(async () => {
        try {
            setProducto(await fetchProduct(token, productoId));
            setError('');
        } catch (e) {
            setError(e.error || 'No se pudo cargar el producto');
        }
    }, [token, productoId]);

    useEffect(() => {
        setProducto(null);
        setStats(null);
        cargarProducto();
    }, [cargarProducto]);

    useEffect(() => {
        if (!esAdmin) return;
        fetchItineraries(token)
            .then((r) => setItinerarios(Array.isArray(r) ? r : []))
            .catch(() => setItinerarios([]));
    }, [token, esAdmin]);

    useEffect(() => {
        if (!rango.from || !rango.to || rango.from > rango.to) return undefined;
        let vigente = true;
        setCargandoStats(true);
        setErrorStats('');
        fetchProductStats(token, productoId, rango)
            .then((r) => { if (vigente) setStats(r); })
            .catch((e) => { if (vigente) setErrorStats(e.error || 'No se pudieron cargar las estadísticas'); })
            .finally(() => { if (vigente) setCargandoStats(false); });
        return () => { vigente = false; };
    }, [token, productoId, rango]);

    const cambiarArchivado = async () => {
        const archivar = !producto.archivedAt;
        try {
            await archiveProducts(token, [producto.id], archivar);
            avisar(archivar ? 'Producto archivado: ya no sale en el TPV' : 'Producto restaurado: vuelve a salir en el TPV', 'success');
            cargarProducto();
        } catch (e) {
            avisar(e.error || 'No se pudo cambiar el estado del producto', 'danger');
        }
    };

    const cambiarRango = ({from, to}) => {
        const r = {from, to};
        setRango(r);
        try { localStorage.setItem('producto_rango', JSON.stringify(r)); } catch { /* noop */ }
    };

    const a = stats?.actual;
    const b = stats?.anterior;

    return (
        <div>
            <PageToolbar
                title={producto ? producto.name : 'Producto'}
                actions={
                    <>
                        <button className="uk-button uk-button-small uk-button-default" onClick={() => navigate('/productos')}>
                            <span uk-icon="icon: arrow-left; ratio: 0.8" style={{marginRight: 4}}></span> Volver
                        </button>
                        {esAdmin && producto && (
                            <>
                                <button className="uk-button uk-button-small uk-button-default" onClick={cambiarArchivado}>
                                    <span uk-icon={`icon: ${producto.archivedAt ? 'refresh' : 'folder'}; ratio: 0.8`} style={{marginRight: 4}}></span>
                                    {producto.archivedAt ? 'Restaurar' : 'Archivar'}
                                </button>
                                <button className="uk-button uk-button-small uk-button-default" onClick={() => setDuplicando(true)}>
                                    <span uk-icon="icon: copy; ratio: 0.8" style={{marginRight: 4}}></span> Duplicar
                                </button>
                                <button className="uk-button uk-button-small uk-button-primary" onClick={() => setEditando(true)}>
                                    <span uk-icon="icon: pencil; ratio: 0.8" style={{marginRight: 4}}></span> Editar
                                </button>
                            </>
                        )}
                    </>
                }
            />

            {error ? (
                <div className="uk-alert-danger" uk-alert="true"><p>{error}</p></div>
            ) : !producto ? (
                <div key="cargando" className="uk-text-center uk-padding">
                    <div uk-spinner="ratio: 1"></div>
                    <p>Cargando producto...</p>
                </div>
            ) : (
                <>
                    {esAdmin && (
                        <ProductModal
                            token={token}
                            initial={producto}
                            isOpen={editando}
                            itineraries={itinerarios}
                            onClose={() => setEditando(false)}
                            onSave={() => {
                                setEditando(false);
                                avisar('Producto guardado', 'success');
                                cargarProducto();
                            }}
                        />
                    )}

                    {esAdmin && (
                        <ProductModal
                            token={token}
                            titulo="Duplicar producto"
                            initial={copiaDeProducto(producto)}
                            isOpen={duplicando}
                            itineraries={itinerarios}
                            onClose={() => setDuplicando(false)}
                            onSave={(nuevo) => {
                                setDuplicando(false);
                                avisar('Producto duplicado', 'success');
                                if (nuevo?.id) navigate(`/productos/${nuevo.id}`);
                            }}
                        />
                    )}

                    {producto.archivedAt && (
                        <div className="uk-alert uk-alert-warning" style={{marginTop: 0}}>
                            Archivado el {new Date(producto.archivedAt).toLocaleDateString('es-ES', {dateStyle: 'medium'})}.
                            No sale en el TPV; su ficha, pedidos y estadísticas se conservan.
                        </div>
                    )}

                    <FichaDatos producto={producto}/>

                    <div className="uk-card uk-card-default uk-card-body" style={{padding: 16, marginBottom: 16}}>
                        <DateRangeSelector from={rango.from} to={rango.to} onChange={cambiarRango}/>
                        {stats && (
                            <p style={{...nota, margin: '10px 0 0'}}>
                                Del {fechaMedia(stats.range.from)} al {fechaMedia(stats.range.to)}
                                {stats.range.to < rango.to && ' (hoy)'}, comparado con los {uds(stats.range.dias)} días
                                anteriores ({fechaMedia(stats.range.previous.from)} – {fechaMedia(stats.range.previous.to)}).
                                Sin pedidos cancelados ni líneas anuladas.
                            </p>
                        )}
                    </div>

                    {errorStats && <div className="uk-alert-danger" uk-alert="true"><p>{errorStats}</p></div>}

                    {/* Las key evitan que React reutilice el nodo del spinner para los
                        datos: UIkit le deja la clase uk-spinner, que hace girar a sus hijos. */}
                    {!stats ? (
                        !errorStats && <div key="cargando" className="uk-text-center uk-padding"><div uk-spinner="ratio: 1"></div></div>
                    ) : (
                        <div key="datos" style={{opacity: cargandoStats ? 0.5 : 1, transition: 'opacity 0.15s'}}>
                            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 16}}>
                                <Dato etiqueta="Unidades" valor={uds(a.unidades)} title={`Periodo anterior: ${uds(b.unidades)}`}>
                                    <Variacion actual={a.unidades} anterior={b.unidades}/>
                                </Dato>
                                <Dato etiqueta="Pedidos" valor={uds(a.pedidos)} detalle={`${uds(a.clientes)} clientes distintos`}
                                      title={`Periodo anterior: ${uds(b.pedidos)}`}>
                                    <Variacion actual={a.pedidos} anterior={b.pedidos}/>
                                </Dato>
                                <Dato etiqueta="Importe" valor={formatEUR(a.importe)} detalle={`${formatEUR(sinIva(a.importe))} sin IVA`}
                                      title={`Periodo anterior: ${formatEUR(b.importe)}`}>
                                    <Variacion actual={a.importe} anterior={b.importe}/>
                                </Dato>
                                <Dato etiqueta="Precio medio cobrado"
                                      valor={a.unidades ? formatEUR(a.importe / a.unidades) : '—'}
                                      detalle={a.unidades ? `${formatEUR(sinIva(a.importe / a.unidades))} sin IVA · catálogo ${formatEUR(producto.basePrice)}` : `Catálogo ${formatEUR(producto.basePrice)}`}/>
                                <Dato etiqueta="Peso en el importe total"
                                      valor={stats.importeTodos > 0 ? pctTexto((a.importe / stats.importeTodos) * 100) : '—'}
                                      detalle={`de ${formatEUR(stats.importeTodos)} de todos los productos`}/>
                            </div>

                            <div className="uk-card uk-card-default" style={{overflow: 'hidden'}}>
                                <div style={{display: 'flex', borderBottom: '1px solid #e2e8f0', padding: '0 12px', overflowX: 'auto'}}>
                                    <button type="button" style={tabStyle(pestana === 'stats')} onClick={() => setPestana('stats')}>Estadísticas</button>
                                    <button type="button" style={tabStyle(pestana === 'orders')} onClick={() => setPestana('orders')}>Pedidos ({uds(a.pedidos)})</button>
                                    <button type="button" style={tabStyle(pestana === 'clients')} onClick={() => setPestana('clients')}>Clientes</button>
                                    <button type="button" style={tabStyle(pestana === 'prices')} onClick={() => setPestana('prices')}>Precios pactados</button>
                                </div>
                                <div style={{padding: '14px 16px'}}>
                                    {pestana === 'stats' && <PestanaEstadisticas stats={stats}/>}
                                    {pestana === 'orders' && <PestanaPedidos token={token} productoId={productoId} rango={rango}/>}
                                    {pestana === 'clients' && <PestanaClientes stats={stats}/>}
                                    {pestana === 'prices' && <PestanaPrecios token={token} productoId={productoId}/>}
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
