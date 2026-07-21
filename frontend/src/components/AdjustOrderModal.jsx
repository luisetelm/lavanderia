import React, {useState, useEffect, useMemo} from 'react';
import {fetchProducts, adjustOrder} from '../api.js';
import {formatEUR} from '../utils/format.js';

// Modal para ajustar un pedido ya cobrado: añadir productos o servicios (un
// arreglo de costura es un producto más del catálogo) y anular líneas que se
// cobraron por error.
//
// Para el empleado es un único gesto. Por detrás, añadir y quitar no son lo
// mismo: lo añadido genera una factura nueva y lo anulado una rectificativa.
// De eso se encarga el backend; aquí sólo se recoge la intención y el motivo.
export default function AdjustOrderModal({token, order, onDone, onClose}) {
    const [productos, setProductos] = useState([]);
    const [busqueda, setBusqueda] = useState('');
    const [aAnadir, setAAnadir] = useState([]);          // [{productId, name, price, quantity}]
    const [aAnular, setAAnular] = useState(new Set());   // ids de OrderLine
    const [motivo, setMotivo] = useState('');
    const [metodo, setMetodo] = useState('cash');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetchProducts(token)
            .then((p) => setProductos(Array.isArray(p) ? p : []))
            .catch(() => setError('No se pudieron cargar los productos.'));
    }, [token]);

    // Sólo se pueden anular las líneas que siguen vivas.
    const lineasVivas = (order.lines || []).filter((l) => !l.voidedAt);

    const filtrados = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        if (!q) return [];
        return productos.filter((p) => (p.name || '').toLowerCase().includes(q)).slice(0, 8);
    }, [busqueda, productos]);

    const importeAnadido = aAnadir.reduce((s, l) => s + l.price * l.quantity, 0);
    const importeAnulado = lineasVivas
        .filter((l) => aAnular.has(l.id))
        .reduce((s, l) => s + Number(l.totalPrice || 0), 0);
    const neto = +(importeAnadido - importeAnulado).toFixed(2);
    const hayCambios = aAnadir.length > 0 || aAnular.size > 0;

    const anadirProducto = (p) => {
        setAAnadir((prev) => {
            const ya = prev.find((x) => x.productId === p.id);
            if (ya) return prev.map((x) => x.productId === p.id ? {...x, quantity: x.quantity + 1} : x);
            return [...prev, {productId: p.id, name: p.name, price: Number(p.basePrice) || 0, quantity: 1}];
        });
        setBusqueda('');
    };

    const toggleAnular = (id) => {
        setAAnular((prev) => {
            const s = new Set(prev);
            if (s.has(id)) s.delete(id); else s.add(id);
            return s;
        });
    };

    const confirmar = async () => {
        setError('');
        if (!motivo.trim()) return setError('Indica el motivo del ajuste.');
        if (!hayCambios) return setError('No has añadido ni anulado nada.');

        setGuardando(true);
        try {
            const res = await adjustOrder(token, order.id, {
                add: aAnadir.map((l) => ({productId: l.productId, quantity: l.quantity})),
                void: [...aAnular].map((id) => ({lineId: id})),
                reason: motivo.trim(),
                // metodo vacío = no se mueve dinero ahora; queda pendiente.
                settlementMethod: neto !== 0 && metodo ? metodo : null,
            });
            onDone(res);
        } catch (e) {
            setError(e.error || 'No se pudo aplicar el ajuste.');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120,
        }}>
            <div style={{
                background: '#fff', borderRadius: 8, width: 560, maxWidth: '95vw',
                maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            }}>
                <div style={{padding: '16px 20px', borderBottom: '1px solid #e5e7eb'}}>
                    <h4 style={{margin: 0}}>Ajustar pedido {order.orderNum}</h4>
                    <div style={{fontSize: '0.8rem', color: '#64748b'}}>
                        Total actual: {formatEUR(Number(order.total) || 0)}
                    </div>
                </div>

                <div style={{padding: 20, overflowY: 'auto', flex: 1}}>
                    {/* ── Anular líneas ── */}
                    <div style={{fontWeight: 600, marginBottom: 8}}>Líneas del pedido</div>
                    {lineasVivas.length === 0 && (
                        <div style={{color: '#64748b', fontSize: '0.85rem'}}>No quedan líneas activas.</div>
                    )}
                    {lineasVivas.map((l) => (
                        <label key={l.id} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
                            borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                            opacity: aAnular.has(l.id) ? 0.55 : 1,
                        }}>
                            <input type="checkbox" className="uk-checkbox"
                                   checked={aAnular.has(l.id)}
                                   onChange={() => toggleAnular(l.id)}/>
                            <span style={{
                                flex: 1,
                                textDecoration: aAnular.has(l.id) ? 'line-through' : 'none',
                            }}>
                                {l.quantity} × {l.product?.name || `Producto ${l.productId}`}
                            </span>
                            <span>{formatEUR(Number(l.totalPrice) || 0)}</span>
                        </label>
                    ))}
                    <div style={{fontSize: '0.75rem', color: '#64748b', marginTop: 6}}>
                        Marca las que se cobraron por error. No se borran: quedan anuladas con su motivo.
                    </div>

                    {/* ── Añadir productos ── */}
                    <div style={{fontWeight: 600, margin: '18px 0 8px'}}>Añadir producto o servicio</div>
                    <input
                        className="uk-input uk-form-small"
                        placeholder="Buscar en el catálogo…"
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                    />
                    {filtrados.length > 0 && (
                        <ul className="uk-list uk-list-divider" style={{margin: '6px 0 0', maxHeight: 160, overflowY: 'auto'}}>
                            {filtrados.map((p) => (
                                <li key={p.id} style={{padding: '4px 0'}}>
                                    <button className="uk-button uk-button-text"
                                            style={{width: '100%', textAlign: 'left'}}
                                            onClick={() => anadirProducto(p)}>
                                        {p.name} <span style={{color: '#64748b'}}>· {formatEUR(Number(p.basePrice) || 0)}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {aAnadir.map((l) => (
                        <div key={l.productId} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '6px 0', borderBottom: '1px solid #f1f5f9',
                        }}>
                            <span style={{flex: 1}}>{l.name}</span>
                            <input type="number" min="1" value={l.quantity}
                                   className="uk-input uk-form-small" style={{width: 64}}
                                   onChange={(e) => {
                                       const q = Math.max(1, parseInt(e.target.value, 10) || 1);
                                       setAAnadir((prev) => prev.map((x) => x.productId === l.productId ? {...x, quantity: q} : x));
                                   }}/>
                            <span style={{width: 70, textAlign: 'right'}}>{formatEUR(l.price * l.quantity)}</span>
                            <button className="uk-button uk-button-text" style={{color: '#d32f2f'}}
                                    onClick={() => setAAnadir((prev) => prev.filter((x) => x.productId !== l.productId))}>
                                quitar
                            </button>
                        </div>
                    ))}
                    <div style={{fontSize: '0.75rem', color: '#64748b', marginTop: 6}}>
                        El precio se calcula igual que en el TPV, con el descuento del cliente si lo tiene.
                    </div>

                    {/* ── Motivo ── */}
                    <div style={{fontWeight: 600, margin: '18px 0 8px'}}>Motivo del ajuste</div>
                    <input
                        className="uk-input uk-form-small"
                        placeholder="Ej.: el cliente añade un arreglo de bajos"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                    />
                </div>

                {/* ── Resumen y confirmación ── */}
                <div style={{padding: '14px 20px', borderTop: '1px solid #e5e7eb', background: '#f8fafc'}}>
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        fontSize: '1.05rem', fontWeight: 600, marginBottom: 10,
                        color: neto > 0 ? '#166534' : (neto < 0 ? '#d32f2f' : '#334155'),
                    }}>
                        <span>
                            {neto > 0 ? 'A cobrar' : (neto < 0 ? 'A devolver' : 'Sin cambio de importe')}
                        </span>
                        <span>{neto !== 0 ? formatEUR(Math.abs(neto)) : '—'}</span>
                    </div>

                    {neto !== 0 && (
                        <div style={{marginBottom: 10}}>
                            <select className="uk-select uk-form-small" value={metodo}
                                    onChange={(e) => setMetodo(e.target.value)}>
                                <option value="cash">Efectivo</option>
                                <option value="card_pos">Tarjeta (TPV)</option>
                                <option value="transfer">Transferencia</option>
                                <option value="">
                                    {neto > 0 ? 'Dejar pendiente de cobro' : 'Dejar pendiente de devolver'}
                                </option>
                            </select>
                            <div style={{fontSize: '0.75rem', color: '#64748b', marginTop: 4}}>
                                {metodo
                                    ? 'El dinero se registra ahora y entra en el arqueo de hoy.'
                                    : (neto > 0
                                        ? 'No se cobra ahora: el pedido queda pendiente de cobro.'
                                        : 'No se devuelve ahora: queda pendiente de devolver al cliente.')}
                            </div>
                        </div>
                    )}

                    {error && <div style={{color: '#d32f2f', marginBottom: 8, fontSize: '0.85rem'}}>{error}</div>}

                    <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                        <button className="uk-button uk-button-default uk-button-small"
                                onClick={onClose} disabled={guardando}>
                            Cancelar
                        </button>
                        <button className="uk-button uk-button-primary uk-button-small"
                                onClick={confirmar} disabled={guardando || !hayCambios}>
                            {guardando ? 'Aplicando…' : 'Confirmar ajuste'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
