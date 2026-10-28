import React, {useState, useEffect, useCallback, useRef, useMemo} from 'react';
import {Link} from 'react-router-dom';
import UIkit from 'uikit';
import {lineasActivas} from '../utils/lineas.js';
import {fetchDates} from '../api';
import {infoCalendario, lineasDelPedido} from '../utils/pasosTPV.js';
import {useDraftOrder} from '../hooks/useDraftOrder.js';
import {rutaEntregas} from '../utils/rutas.js';
import './DateCarousel.css';

/* ── Utilidades de fecha (todo en 'YYYY-MM-DD', hora local) ── */
const ymd = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};
const fromYmd = (s) => {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
};
const addDays = (s, n) => {
    const d = fromYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
};
const mondayOf = (s) => {
    const d = fromYmd(s);
    const dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return ymd(d);
};
const fmt = (s, opts) => fromYmd(s).toLocaleDateString('es-ES', opts);
// "lunes, 14 de septiembre" -> "Lunes, 14 de septiembre"
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtLoad = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const LOAD_MAX_FALLBACK = 45; // el tope real lo manda la API (Administración > Horario laboral)
const WEEKS = 2; // semanas visibles por defecto (vista clásica); el TPV por pasos pide más

const loadLevel = (load, max) => (load >= max ? 'high' : load >= max / 2 ? 'mid' : 'low');

// `lateral`: lo que va al final de la columna del día elegido (las observaciones del pedido)
export default function DateCarousel({fechaLimite, setFechaLimite, token, weeks = WEEKS, lateral = null}) {
    const todayStr = ymd(new Date());
    // Suplemento de urgencia (entrega anterior a la sugerida): la previsión la
    // lleva el pedido en curso; aquí sólo se avisa y se le pasa lo que dice el servidor.
    const draft = useDraftOrder();
    const [weekStart, setWeekStart] = useState(() => mondayOf(fechaLimite || todayStr));
    const [data, setData] = useState(null); // { days, loadByDay, suggestedDate, today }
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Fecha elegida en el calendario nativo que aún no está cargada en la rejilla
    const [pendingPick, setPendingPick] = useState(null);
    const pickerRef = useRef(null);

    // Prendas del pedido en curso: la sugerida busca un día en el que quepan.
    // Se espera un momento tras el último cambio para no pedir el calendario
    // con cada clic en el catálogo.
    const lineas = useMemo(() => lineasDelPedido(draft.cart), [draft.cart]);
    const [lineasPedidas, setLineasPedidas] = useState(lineas);
    useEffect(() => {
        const t = setTimeout(() => setLineasPedidas(lineas), 400);
        return () => clearTimeout(t);
    }, [lineas]);

    const ultimaPeticion = useRef(0);
    const load = useCallback(async (start) => {
        const n = ++ultimaPeticion.current; // sólo vale la respuesta de la última petición
        setLoading(true);
        setError('');
        try {
            const res = await fetchDates(token, {start, weeks, lineas: lineasPedidas});
            if (n === ultimaPeticion.current) setData({...res, lineas: lineasPedidas});
        } catch (e) {
            console.error('Error cargando fechas de entrega:', e);
            if (n === ultimaPeticion.current) setError('No se pudieron cargar las fechas de entrega');
        } finally {
            if (n === ultimaPeticion.current) setLoading(false);
        }
    }, [token, weeks, lineasPedidas]);

    useEffect(() => {
        if (token) load(weekStart);
    }, [token, weekStart, load]);

    // Sin fecha, se pone la sugerida. Y mientras nadie haya elegido otra, la
    // fecha sigue a la sugerida cuando esta cambia (al añadir prendas que no
    // caben ese día): si no, el pedido quedaría «adelantado» y con suplemento
    // sin que nadie lo haya pedido.
    const {fechaManual} = draft;
    useEffect(() => {
        const sugerida = data?.suggestedDate;
        if (!sugerida || sugerida === fechaLimite) return;
        if (!fechaLimite || !fechaManual) setFechaLimite(sugerida, {manual: false});
    }, [fechaLimite, fechaManual, data?.suggestedDate, setFechaLimite]);

    const days = data?.days || [];
    const loadByDay = data?.loadByDay || {};
    const suggestedDate = data?.suggestedDate || null;
    const loadMax = Number(data?.loadMax) > 0 ? Number(data.loadMax) : LOAD_MAX_FALLBACK;
    const {setCalendarInfo, suplementoUrgencia, sinSuplemento, setSinSuplemento} = draft;
    useEffect(() => {
        if (data) setCalendarInfo(infoCalendario(data, data.lineas));
    }, [data, setCalendarInfo]);
    // Lo que pesa el pedido en curso, para avisar si con él el día pasa del tope
    const cargaPedido = Number(data?.orderLoad) || 0;
    const weekEnd = addDays(weekStart, weeks * 7 - 1);
    const canGoBack = weekStart > mondayOf(todayStr);

    const dayByDate = Object.fromEntries(days.map(d => [d.date, d]));
    const selected = fechaLimite ? dayByDate[fechaLimite] : null;

    // Lo que ya se entrega el día elegido, sumado por producto y no por pedido:
    // primero lo que coincide con las prendas del pedido en curso (¿cuántos
    // vestidos de novia hay ya ese día?), luego el resto, lo más pesado antes.
    const cart = draft.cart;
    const resumenDia = useMemo(() => {
        const enDia = {};
        (data?.loadByDay?.[fechaLimite] || []).forEach(o => lineasActivas(o.lines).forEach(l => {
            const p = l.product || {};
            if (p.sku === 'SUPL-URGENCIA') return;
            // Las prendas fuera de catálogo comparten producto genérico: van por su nombre
            const clave = l.customName ? `${l.productId}|${l.customName.trim().toLowerCase()}` : String(l.productId);
            const g = (enDia[clave] ||= {
                id: clave, name: l.customName || p.name || `#${l.productId}`, qty: 0, orders: new Set(),
                weight: p.countsForLoad === false ? 0
                    : l.workloadWeight != null ? Number(l.workloadWeight)
                        : (p.workloadWeight != null ? Number(p.workloadWeight) : 1),
            });
            g.qty += Number(l.quantity) || 0;
            g.orders.add(o.id);
        }));
        // En el pedido en curso cada prenda es una línea: se juntan por producto
        const enPedido = {};
        (cart || []).forEach(c => {
            const clave = c.nombreLibre ? `${c.productId}|${c.nombreLibre.trim().toLowerCase()}` : String(c.productId);
            const g = (enPedido[clave] ||= {id: clave, name: c.name, qty: 0});
            g.qty += Number(c.quantity) || 0;
        });
        const coinciden = Object.values(enPedido)
            .map(c => ({...c, yaHay: enDia[c.id]?.qty || 0, pedidos: enDia[c.id]?.orders.size || 0}))
            .sort((a, b) => b.yaHay - a.yaHay);
        const resto = Object.values(enDia)
            .filter(g => !enPedido[g.id])
            .sort((a, b) => (b.qty * b.weight - a.qty * a.weight) || (b.qty - a.qty));
        return {coinciden, resto};
    }, [data, fechaLimite, cart]);

    const selectDay = (day) => {
        if (day.isPast || !day.isWorking) return;
        setFechaLimite(day.date);
    };

    const goToDate = (dateStr) => {
        setWeekStart(mondayOf(dateStr));
    };

    // Selección de una fecha lejana con el calendario nativo
    const handlePick = (e) => {
        const v = e.target.value;
        if (!v) return;
        if (v < todayStr) {
            UIkit.notification({message: 'La fecha no puede ser anterior a hoy', status: 'warning', pos: 'top-right', timeout: 2500});
            return;
        }
        goToDate(v);
        // El día concreto puede no estar cargado aún (otra semana); se
        // selecciona al llegar los datos si está abierto.
        setPendingPick(v);
    };
    useEffect(() => {
        if (!pendingPick || !data) return;
        const day = (data.days || []).find(d => d.date === pendingPick);
        if (!day) return;
        if (day.isWorking) {
            setFechaLimite(day.date);
        } else {
            UIkit.notification({
                message: `Ese día la lavandería está cerrada${day.label ? ` (${day.label})` : ''}`,
                status: 'warning', pos: 'top-right', timeout: 3000,
            });
        }
        setPendingPick(null);
    }, [pendingPick, data, setFechaLimite]);

    const rangeLabel = (() => {
        const a = fromYmd(weekStart), b = fromYmd(weekEnd);
        const sameMonth = a.getMonth() === b.getMonth();
        const left = a.toLocaleDateString('es-ES', sameMonth ? {day: 'numeric'} : {day: 'numeric', month: 'short'});
        const right = b.toLocaleDateString('es-ES', {day: 'numeric', month: 'short', year: a.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined});
        return `${left} – ${right}`;
    })();

    return (
        <div className="dc">
            {/* Dos bloques: el calendario y lo del día elegido. En el TPV por pasos van
                en dos columnas independientes, para que lo que crece a la derecha
                (el resumen de un día con muchos pedidos) no estire el calendario. */}
            <div className="dc-main">
                {/* Cabecera: título + navegación */}
                <div className="dc-head">
                    <h4 className="dc-title"><span uk-icon="icon: calendar; ratio: 0.9"></span>Fecha de entrega</h4>
                    <div className="dc-nav">
                        <button type="button" className="dc-nav-btn" onClick={() => setWeekStart(mondayOf(todayStr))}
                                disabled={!canGoBack} title="Volver a la semana actual">Hoy</button>
                        <button type="button" className="dc-nav-btn" onClick={() => setWeekStart(addDays(weekStart, -7))}
                                disabled={!canGoBack} aria-label="Semana anterior">
                            <span uk-icon="icon: chevron-left; ratio: 0.9"></span>
                        </button>
                        <span className="dc-range">{rangeLabel}</span>
                        <button type="button" className="dc-nav-btn" onClick={() => setWeekStart(addDays(weekStart, 7))}
                                aria-label="Semana siguiente">
                            <span uk-icon="icon: chevron-right; ratio: 0.9"></span>
                        </button>
                        <button type="button" className="dc-nav-btn" title="Elegir otra fecha"
                                onClick={() => pickerRef.current?.showPicker ? pickerRef.current.showPicker() : pickerRef.current?.click()}>
                            <span uk-icon="icon: calendar; ratio: 0.9"></span>
                        </button>
                        <input ref={pickerRef} type="date" className="dc-picker" min={todayStr}
                               value="" onChange={handlePick} tabIndex={-1} aria-hidden="true"/>
                    </div>
                </div>

                {error && <div className="uk-alert-danger uk-margin-small" uk-alert="true"><p>{error}</p></div>}

                {/* Rejilla semanal */}
                <div className={`dc-grid ${loading ? 'is-loading' : ''}`}>
                    {WEEKDAYS.map(w => <div key={w} className="dc-wd">{w}</div>)}

                    {days.map(day => {
                        const orders = loadByDay[day.date] || [];
                        const isSelected = fechaLimite === day.date;
                        const isSuggested = suggestedDate === day.date;
                        const closed = !day.isWorking;
                        const disabled = day.isPast || closed;
                        const dayMax = Number(day.loadMax) > 0 ? Number(day.loadMax) : loadMax; // tope propio (víspera de festivo) o general
                        const level = loadLevel(day.load, dayMax);
                        const showMonth = day.date.endsWith('-01') || day.date === days[0].date;
                        const cls = [
                            'dc-day',
                            disabled ? 'is-disabled' : '',
                            closed ? 'is-closed' : '',
                            day.isPast ? 'is-past' : '',
                            day.isToday ? 'is-today' : '',
                            isSelected ? 'is-selected' : '',
                            isSuggested && !isSelected ? 'is-suggested' : '',
                            !disabled ? `load-${level}` : '',
                        ].filter(Boolean).join(' ');

                        const title = closed
                            ? `Cerrado${day.label ? ` · ${day.label}` : ''}`
                            : day.isPast ? 'Fecha pasada'
                                : `${orders.length} pedido${orders.length !== 1 ? 's' : ''} · carga ${fmtLoad(day.load)} de ${fmtLoad(dayMax)}`
                                    + (cargaPedido > 0 ? ` · con este pedido, ${fmtLoad(day.load + cargaPedido)}` : '');

                        return (
                            <div key={day.date} className={`dc-cell ${disabled ? 'is-disabled' : ''}`} title={title}>
                                <button
                                    type="button"
                                    className={cls}
                                    onClick={() => selectDay(day)}
                                    disabled={disabled}
                                    aria-pressed={isSelected}
                                >
                                    <span className="dc-num">
                                        {fromYmd(day.date).getDate()}
                                        {showMonth && <small>{fmt(day.date, {month: 'short'}).replace('.', '')}</small>}
                                    </span>

                                    {closed ? (
                                        <span className={`dc-closed ${day.isException ? 'is-holiday' : ''}`}>
                                            {day.isException && <span uk-icon="icon: ban; ratio: 0.6"></span>}
                                            <span className="dc-closed-label">{day.label || 'Cerrado'}</span>
                                        </span>
                                    ) : day.isPast ? (
                                        <span className="dc-meta">&nbsp;</span>
                                    ) : (
                                        <>
                                            {/* Tramo liso = pedidos reales; tramo rayado = reservado a grandes clientes que aún no han entregado */}
                                            <span className="dc-bar">
                                                <i style={{width: `${Math.min(Math.max(day.load - (day.reserved || 0), 0) / dayMax, 1) * 100}%`}}/>
                                                {day.reserved > 0 && (
                                                    <i className="is-reserved" style={{width: `${Math.min(day.reserved / dayMax, 1) * 100}%`}}/>
                                                )}
                                            </span>
                                            <span className="dc-meta">
                                                {orders.length > 0 ? `${orders.length} ped · ${fmtLoad(day.load)}` : (day.load > 0 ? `reserva · ${fmtLoad(day.load)}` : 'libre')}
                                            </span>
                                        </>
                                    )}

                                    {isSuggested && !closed && !day.isPast && <span className="dc-badge">Sugerida</span>}
                                    {isSelected && <span className="dc-check" uk-icon="icon: check; ratio: 0.7"></span>}
                                </button>
                            </div>
                        );
                    })}

                    {loading && !days.length && (
                        <div className="dc-loading"><div uk-spinner="ratio: 0.8"></div></div>
                    )}
                </div>

                <div className="dc-legend">
                    <span><i className="load-low"/>Poca carga</span>
                    <span><i className="load-mid"/>Media</span>
                    <span><i className="load-high"/>Llena</span>
                    <span><i className="closed"/>Cerrado / festivo</span>
                </div>
            </div>

            <div className="dc-side">
                {/* Resumen de la selección */}
                <div className="dc-summary">
                    {fechaLimite ? (
                        <>
                            <span className="dc-summary-date">
                                <span uk-icon="icon: calendar; ratio: 0.8"></span>
                                {cap(fmt(fechaLimite, {weekday: 'long', day: 'numeric', month: 'long'}))}
                            </span>
                            {selected && !selected.isWorking && (
                                <span className="dc-summary-warn">Ese día está cerrado, elige otra fecha</span>
                            )}
                            {selected && selected.isWorking && (
                                <span className="dc-summary-load">
                                    {selected.orders > 0 ? `${selected.orders} pedido${selected.orders !== 1 ? 's' : ''} · carga ${fmtLoad(selected.load)}` : (selected.load > 0 ? `sin pedidos · carga ${fmtLoad(selected.load)}` : 'sin pedidos')}
                                    {selected.reserved > 0 && (
                                        <> (incluye {fmtLoad(selected.reserved)} reservados para {(selected.reservedClients || []).join(', ') || 'grandes clientes'})</>
                                    )}
                                    {(selected.releasedClients || []).length > 0 && (
                                        <> · reserva liberada: {selected.releasedClients.join(', ')} (pasó su recogida sin pedido para este día)</>
                                    )}
                                    {Number(selected.loadMax) > 0 && Number(selected.loadMax) !== loadMax && (
                                        <> · tope de este día {fmtLoad(selected.loadMax)}{selected.label ? ` (${selected.label})` : ''}</>
                                    )}
                                </span>
                            )}
                            {selected && selected.isWorking && cargaPedido > 0 && (() => {
                                const tope = Number(selected.loadMax) > 0 ? Number(selected.loadMax) : loadMax;
                                const conEste = selected.load + cargaPedido;
                                return (
                                    <span className={conEste > tope ? 'dc-summary-warn' : 'dc-summary-load'}>
                                        con este pedido ({fmtLoad(cargaPedido)}), {fmtLoad(conEste)} de {fmtLoad(tope)}
                                        {conEste > tope ? ': se pasa del tope' : ''}
                                    </span>
                                );
                            })()}
                            {selected && selected.isWorking && selected.orders > 0 && (
                                <Link to={rutaEntregas(fechaLimite)} className="dc-link" title="Entregas de ese día, pedido a pedido">
                                    Ver los pedidos de ese día
                                </Link>
                            )}
                            {!selected && (
                                <button type="button" className="dc-link" onClick={() => goToDate(fechaLimite)}>Ver en calendario</button>
                            )}
                            {suggestedDate && suggestedDate !== fechaLimite && (
                                <button type="button" className="dc-link" onClick={() => { setFechaLimite(suggestedDate, {manual: false}); goToDate(suggestedDate); }}>
                                    Usar sugerida ({fmt(suggestedDate, {weekday: 'short', day: 'numeric', month: 'short'})})
                                </button>
                            )}
                        </>
                    ) : (
                        <span className="uk-text-muted">Selecciona un día de entrega</span>
                    )}
                </div>

                {/* Lo que ya se entrega ese día, por producto: para no juntar trabajos de mucha dedicación */}
                {selected && selected.isWorking && (resumenDia.coinciden.length > 0 || resumenDia.resto.length > 0) && (
                    <div className="dc-dia">
                        {resumenDia.coinciden.length > 0 && (
                            <div className="dc-dia-group">
                                <div className="dc-dia-title">Lo de este pedido, ese día</div>
                                <ul className="dc-dia-list">
                                    {resumenDia.coinciden.map(c => (
                                        <li key={c.id} className={c.yaHay > 0 ? 'is-busy' : ''}>
                                            <span className="dc-dia-name">{c.name}</span>
                                            <span className="dc-dia-count">
                                                {c.yaHay > 0 ? (
                                                    <>ya hay <strong>{fmtLoad(c.yaHay)}</strong> en {c.pedidos} pedido{c.pedidos !== 1 ? 's' : ''} · con este, {fmtLoad(c.yaHay + c.qty)}</>
                                                ) : 'ninguno más ese día'}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {resumenDia.resto.length > 0 && (
                            <div className="dc-dia-group">
                                <div className="dc-dia-title">{resumenDia.coinciden.length > 0 ? 'Además, ese día se entregan' : 'Ese día se entregan'}</div>
                                <div className="dc-dia-chips">
                                    {resumenDia.resto.map(g => (
                                        <span key={g.id} className="dc-dia-chip"
                                              title={`${g.orders.size} pedido${g.orders.size !== 1 ? 's' : ''}`}>
                                            <strong>{fmtLoad(g.qty)}</strong> {g.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Entrega anterior a la sugerida: suplemento de urgencia */}
                {fechaLimite && suplementoUrgencia.adelantada && (
                    <div className={`dc-urgent ${suplementoUrgencia.aplicado ? '' : 'is-off'}`}>
                        <span uk-icon="icon: bolt; ratio: 0.8"></span>
                        <span className="dc-urgent-text">
                            {suplementoUrgencia.granCliente ? (
                                <><strong>Entrega adelantada</strong>: antes de la fecha sugerida. Gran cliente con días de recogida y entrega pactados: sin suplemento.</>
                            ) : suplementoUrgencia.pctPerDay > 0 ? (
                                <>
                                    <strong>Entrega adelantada</strong> {suplementoUrgencia.dias} día{suplementoUrgencia.dias !== 1 ? 's' : ''} laborable{suplementoUrgencia.dias !== 1 ? 's' : ''} respecto a la sugerida
                                    {suggestedDate && <> ({fmt(suggestedDate, {weekday: 'short', day: 'numeric', month: 'short'})})</>}.
                                    {suplementoUrgencia.aplicado
                                        ? <> Suplemento de urgencia del {suplementoUrgencia.pct} % ({suplementoUrgencia.pctPerDay} % por día{suplementoUrgencia.maxPct > 0 ? `, máximo ${suplementoUrgencia.maxPct} %` : ''}): <strong>{suplementoUrgencia.importe.toFixed(2)} €</strong>.</>
                                        : suplementoUrgencia.importe > 0
                                            ? <> Suplemento del {suplementoUrgencia.pct} % ({suplementoUrgencia.importe.toFixed(2)} €) eximido.</>
                                            : <> El suplemento ({suplementoUrgencia.pct} %) se calculará sobre las prendas del pedido.</>}
                                </>
                            ) : (
                                <><strong>Entrega adelantada</strong>: antes de la fecha sugerida. El suplemento de urgencia está desactivado.</>
                            )}
                        </span>
                        {suplementoUrgencia.pctPerDay > 0 && !suplementoUrgencia.granCliente && (
                            <label className="dc-urgent-waive" title="No cobrar el suplemento en este pedido">
                                <input type="checkbox" className="uk-checkbox" checked={!!sinSuplemento}
                                       onChange={e => setSinSuplemento(e.target.checked)}/>
                                Sin suplemento
                            </label>
                        )}
                    </div>
                )}

                {lateral}
            </div>
        </div>
    );
}
