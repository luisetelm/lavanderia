import React, {useMemo, useState} from 'react';
import ProductList from '../ProductList.jsx';
import DraftLines from '../DraftLines.jsx';
import {useDraftOrder} from '../../hooks/useDraftOrder.js';

// Bloques «Productos» y «Prendas del pedido» del TPV: el catálogo para añadir
// y las prendas ya metidas, con el total. El catálogo lo carga POS una sola vez
// y llega por props, para no pedirlo de nuevo cada vez que se monta.
export default function PosPrendas({products, itineraries, error}) {
    const draft = useDraftOrder();
    const [searchProduct, setSearchProduct] = useState('');

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
    const anadir = (p) => {
        draft.addToCart(p);
        const buscador = document.getElementById('pos-producto-buscar');
        if (buscador) {
            buscador.focus({preventScroll: true});
            buscador.select();
        }
    };

    return (
        <>
            {/* ── Catálogo ── */}
            <section className="uk-card uk-card-default pos-card pos-sec-productos">
                <h4 className="pos-card-title">
                    <span uk-icon="icon: tag; ratio: 0.9"></span>
                    Productos
                    <span className="pos-title-right">Pulsa un producto para añadirlo al pedido</span>
                </h4>
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
                        <span className="pos-title-right">Color, cantidad, nota o foto de cada prenda</span>
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
