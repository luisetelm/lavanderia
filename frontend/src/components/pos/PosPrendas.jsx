import React, {useMemo, useState} from 'react';
import ProductList from '../ProductList.jsx';
import DraftLines from '../DraftLines.jsx';
import {useDraftOrder} from '../../hooks/useDraftOrder.js';
import {TIPOS_FUERA_CATALOGO} from '../../utils/fueraCatalogo.js';

const leerPrecio = (t) => {
    const n = Number(String(t).replace(',', '.').trim());
    return Number.isFinite(n) && n > 0 && n <= 10000 ? Math.round(n * 100) / 100 : null;
};

// Prenda que no está en el catálogo: nombre, precio y servicio (el servicio da
// los pasos del taller y la carga; utils/fueraCatalogo.js). Se abre con el texto
// que se estaba buscando, que suele ser lo que no se ha encontrado.
function FueraDeCatalogo({genericos, nombreInicial, onAdd, onClose}) {
    const [nombre, setNombre] = useState(nombreInicial);
    const [precio, setPrecio] = useState('');
    const disponibles = TIPOS_FUERA_CATALOGO.filter(t => genericos.some(g => g.sku === t.sku));
    const [sku, setSku] = useState(disponibles[0]?.sku || '');
    const valor = leerPrecio(precio);
    const puede = Boolean(nombre.trim()) && valor !== null && Boolean(sku);

    if (!disponibles.length) {
        return (
            <div className="pos-fuera">
                <span className="pos-fuera-aviso">Faltan los productos de fuera de catálogo en la base de datos (backend/sql/035).</span>
                <button type="button" className="uk-button uk-button-default uk-button-small" onClick={onClose}>Cerrar</button>
            </div>
        );
    }

    const anadir = (e) => {
        e.preventDefault();
        if (!puede) return;
        onAdd(genericos.find(g => g.sku === sku), {nombre: nombre.trim(), precio: valor});
    };

    return (
        <form className="pos-fuera" onSubmit={anadir}>
            <div className="pos-fuera-row">
                <input id="pos-fuera-nombre" className="uk-input" placeholder="Nombre de la prenda (p. ej. funda de moto)"
                       value={nombre} maxLength={120} autoFocus onChange={(e) => setNombre(e.target.value)}/>
                <label className="pos-fuera-precio">
                    <input className="uk-input" inputMode="decimal" placeholder="Precio" aria-label="Precio por unidad"
                           value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^0-9.,]/g, ''))}/>
                    <span>€</span>
                </label>
            </div>
            <div className="pos-fuera-row">
                <div className="pos-fuera-tipos" role="radiogroup" aria-label="Servicio">
                    {disponibles.map(t => (
                        <button key={t.sku} type="button" role="radio" aria-checked={sku === t.sku}
                                className={'pos-fuera-tipo' + (sku === t.sku ? ' is-active' : '')}
                                onClick={() => setSku(t.sku)}>
                            {t.label}
                        </button>
                    ))}
                </div>
                <div className="pos-fuera-acciones">
                    <button type="button" className="uk-button uk-button-default uk-button-small" onClick={onClose}>Cancelar</button>
                    <button type="submit" className="uk-button uk-button-primary uk-button-small" disabled={!puede}>Añadir</button>
                </div>
            </div>
        </form>
    );
}

// Bloques «Productos» y «Prendas del pedido» del TPV: el catálogo para añadir
// y las prendas ya metidas, con el total. El catálogo lo carga POS una sola vez
// y llega por props, para no pedirlo de nuevo cada vez que se monta.
// `genericos`: productos de las prendas fuera de catálogo (archivados).
export default function PosPrendas({products, itineraries, genericos = [], error}) {
    const draft = useDraftOrder();
    const [searchProduct, setSearchProduct] = useState('');
    const [fueraAbierto, setFueraAbierto] = useState(false);

    // Unidades de cada producto ya en el pedido, para marcarlo en el catálogo
    const cartCounts = useMemo(() => {
        const m = {};
        (draft.cart || []).forEach(c => { m[c.productId] = (m[c.productId] || 0) + (c.quantity || 0); });
        return m;
    }, [draft.cart]);

    const hasDiscount = Number(draft.discount || 0) > 0;

    // Tras añadir una prenda el cursor vuelve al buscador con el texto
    // seleccionado: lo que se escriba lo sustituye, y la misma tarjeta sigue a
    // la vista para pulsarla otra vez (tres camisas, tres clics).
    const volverAlBuscador = () => {
        const buscador = document.getElementById('pos-producto-buscar');
        if (buscador) {
            buscador.focus({preventScroll: true});
            buscador.select();
        }
    };
    const anadir = (p) => {
        draft.addToCart(p);
        volverAlBuscador();
    };
    const anadirFuera = (producto, datos) => {
        draft.addCustomToCart(producto, datos);
        setFueraAbierto(false);
        setSearchProduct('');
        setTimeout(volverAlBuscador, 0);
    };

    return (
        <>
            {/* ── Catálogo ── */}
            <section className="uk-card uk-card-default pos-card pos-sec-productos">
                <h4 className="pos-card-title">
                    <span uk-icon="icon: tag; ratio: 0.9"></span>
                    Productos
                    <span className="pos-title-right">Pulsa un producto para añadirlo al pedido</span>
                    <button type="button" className="uk-button uk-button-default uk-button-small pos-fuera-btn"
                            aria-expanded={fueraAbierto} onClick={() => setFueraAbierto(!fueraAbierto)}>
                        <span uk-icon="icon: plus; ratio: 0.7"></span> Fuera de catálogo
                    </button>
                </h4>
                {fueraAbierto && (
                    <FueraDeCatalogo genericos={genericos} nombreInicial={searchProduct.trim()}
                                     onAdd={anadirFuera} onClose={() => setFueraAbierto(false)}/>
                )}
                {error && (
                    <div className="uk-alert-danger uk-margin-small" uk-alert="true">
                        <p>{error}</p>
                    </div>
                )}
                <ProductList products={products} searchProduct={searchProduct}
                             setSearchProduct={setSearchProduct} onAdd={anadir}
                             itineraries={itineraries} cartCounts={cartCounts}
                             agreedPriceFor={draft.agreedPriceFor}/>
            </section>

            {/* ── Prendas del pedido ── */}
            <section id="pos-prendas" className="uk-card uk-card-default pos-card pos-sec-prendas">
                <h4 className="pos-card-title">
                    <span uk-icon="icon: bag; ratio: 0.9"></span>
                    Prendas del pedido
                    {draft.itemCount > 0 && <span className="pos-title-count">{draft.itemCount}</span>}
                    {draft.cart.length > 0 && (
                        <span className="pos-title-right">Color, cantidad, precio, nota o foto de cada prenda</span>
                    )}
                </h4>
                <DraftLines theme="light" emptyText="Aún no hay prendas. Añádelas pulsando en el catálogo de productos."/>
                {draft.cart.length > 0 && (
                    <div className="pos-cart-foot">
                        {hasDiscount && <span className="pos-cart-dto">−{Number(draft.discount)}% dto.</span>}
                        {draft.suplementoUrgencia.aplicado && (
                            <span className="pos-cart-dto" style={{ color: '#b45309' }}
                                  title="Entrega anterior a la fecha sugerida">
                                Suplemento urgencia +{draft.suplementoUrgencia.pct}%: {draft.suplementoUrgencia.importe.toFixed(2)} €
                            </span>
                        )}
                        <span>Total</span>
                        <span className="pos-cart-total">{draft.totalConSuplemento.toFixed(2)} €</span>
                    </div>
                )}
            </section>
        </>
    );
}
