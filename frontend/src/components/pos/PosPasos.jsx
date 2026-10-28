import React, {useEffect, useRef} from 'react';
import {useDraftOrder} from '../../hooks/useDraftOrder.js';
import {fetchDates} from '../../api.js';
import {PASOS, esPaso, pasosCompletos, pedirValidacion, infoCalendario} from '../../utils/pasosTPV.js';
import PosCliente from './PosCliente.jsx';
import PosPrendas from './PosPrendas.jsx';
import PosEntrega from './PosEntrega.jsx';
import PosRevisar from './PosRevisar.jsx';

// TPV por pasos: cliente, prendas, entrega y revisar, de uno en uno. El paso
// se guarda con el pedido en curso, así que un pedido a medias vuelve a él.
// La barra de pasos deja ir a cualquiera: nada obliga a completar uno para pasar.
export default function PosPasos({token, products, itineraries, error}) {
    const draft = useDraftOrder();
    const paso = esPaso(draft.paso) ? draft.paso : 'cliente';
    const i = PASOS.findIndex(p => p.key === paso);
    const completos = pasosCompletos(draft);
    const bodyRef = useRef(null);
    const siguienteRef = useRef(null);
    const validarRef = useRef(null);

    // Cada paso empieza arriba y con el cursor en lo siguiente que hay que hacer:
    // el buscador de clientes (o el nombre del cliente nuevo), el de productos,
    // «Siguiente» en la entrega (la fecha sugerida ya viene puesta) y «Validar».
    useEffect(() => {
        bodyRef.current?.scrollTo?.(0, 0);
        const t = setTimeout(() => {
            const body = bodyRef.current;
            if (!body) return;
            const objetivo = {
                cliente: () => body.querySelector('#pos-cliente-buscar, #pos-cliente-nombre') || siguienteRef.current,
                prendas: () => body.querySelector('#pos-producto-buscar'),
                entrega: () => siguienteRef.current,
                revisar: () => validarRef.current,
            }[paso]?.();
            objetivo?.focus?.({preventScroll: true});
        }, 0);
        return () => clearTimeout(t);
    }, [paso]);

    // El suplemento de urgencia sale de la fecha sugerida, que trae el calendario
    // al mostrarse. Fuera del paso de entrega (por ejemplo, al recargar estando en
    // Revisar) se pide aquí, para que el total no salga sin el suplemento.
    const {setCalendarInfo, fechaLimite} = draft;
    const tieneCalendario = Boolean(draft.calendarInfo?.suggestedDate);
    useEffect(() => {
        if (paso === 'entrega' || tieneCalendario || !token) return undefined;
        let vigente = true;
        fetchDates(token, {start: fechaLimite || undefined, weeks: 2})
            .then(res => { if (vigente) setCalendarInfo(infoCalendario(res)); })
            .catch(e => console.warn('No se pudo cargar el calendario de entregas', e));
        return () => { vigente = false; };
    }, [paso, tieneCalendario, token, fechaLimite, setCalendarInfo]);

    const irA = (key) => draft.setPaso(key);
    const anterior = PASOS[i - 1];
    const siguiente = PASOS[i + 1];
    const sinPrendas = !draft.cart.length;

    return (
        <div className="pos-wizard">
            <nav className="pos-steps" aria-label="Pasos del pedido">
                {PASOS.map((p, n) => {
                    const actual = p.key === paso;
                    const hecho = completos[p.key];
                    return (
                        <button key={p.key} type="button"
                                className={`pos-step ${actual ? 'is-current' : ''} ${hecho && !actual ? 'is-done' : ''}`}
                                aria-current={actual ? 'step' : undefined}
                                onClick={() => irA(p.key)}>
                            <span className="pos-step-num">{hecho && !actual ? <span uk-icon="icon: check; ratio: 0.7"></span> : n + 1}</span>
                            <span className="pos-step-label">{p.titulo}</span>
                        </button>
                    );
                })}
            </nav>

            <div ref={bodyRef} className={`pos-wizard-body pos-step-${paso}`}>
                {paso === 'cliente' && <PosCliente token={token}/>}
                {paso === 'prendas' && <PosPrendas products={products} itineraries={itineraries} error={error}/>}
                {paso === 'entrega' && <PosEntrega token={token} weeks={4}/>}
                {paso === 'revisar' && <PosRevisar onIrA={irA}/>}
            </div>

            <div className="pos-wizard-nav">
                {anterior ? (
                    <button type="button" className="uk-button uk-button-default pos-nav-btn" onClick={() => irA(anterior.key)}>
                        <span uk-icon="icon: chevron-left; ratio: 0.9"></span> Atrás
                    </button>
                ) : <span/>}
                {siguiente ? (
                    <button ref={siguienteRef} type="button" className="uk-button uk-button-primary pos-nav-btn" onClick={() => irA(siguiente.key)}>
                        Siguiente: {siguiente.titulo} <span uk-icon="icon: chevron-right; ratio: 0.9"></span>
                    </button>
                ) : (
                    <span className="pos-nav-end">
                        {sinPrendas && <span className="pos-nav-hint">Añade al menos una prenda para validar</span>}
                        {/* La validación es la de la barra del pedido en curso, que sólo existe con prendas */}
                        <button ref={validarRef} type="button" className="uk-button uk-button-primary pos-nav-btn"
                                disabled={sinPrendas} onClick={pedirValidacion}>
                            <span uk-icon="icon: check; ratio: 0.9"></span> Validar pedido
                        </button>
                    </span>
                )}
            </div>
        </div>
    );
}
