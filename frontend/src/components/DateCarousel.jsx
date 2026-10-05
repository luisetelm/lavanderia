import React, {useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo} from 'react';
import {createPortal} from 'react-dom';
import {Link} from 'react-router-dom';
import UIkit from 'uikit';
import {lineasActivas} from '../utils/lineas.js';
import {fetchDates} from '../api';
import {useDraftOrder} from '../hooks/useDraftOrder.js';
import {rutaPedido, rutaCliente} from '../utils/rutas.js';
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
const WEEKS = 2;

const loadLevel = (load, max) => (load >= max ? 'high' : load >= max / 2 ? 'mid' : 'low');

const ESTADOS = {
    pending: ['Pendiente', 'warning'], in_progress: ['En proceso', 'primary'], ready: ['Listo', 'success'],
    collected: ['Recogido', 'default'], cancelled: ['Cancelado', 'default'],
};

/*
 * Desplegable con los pedidos de un día. Se pinta con un portal en <body> para
 * que no lo recorte la columna del TPV (overflow), pero sigue dentro del árbol
 * de React: antes era un uk-dropdown con "container: true", que UIkit movía
 * fuera del árbol y los enlaces de dentro hacían una recarga completa en vez
 * de navegar (se perdía el pedido al llegar a Tareas).
 */
function DayPopover({anchorEl, open, onClose, onMouseEnter, onMouseLeave, children}) {
    const ref = useRef(null);
    const [style, setStyle] = useState({top: 0, left: 0, visibility: 'hidden'});

    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const a = anchorEl?.getBoundingClientRect();
            const el = ref.current;
            if (!a || !el) return;
            const w = el.offsetWidth, h = el.offsetHeight, margin = 8, gap = 6;
            let left = a.left + a.width / 2 - w / 2;
            left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
            let top = a.bottom + gap;
            if (top + h > window.innerHeight - margin && a.top - gap - h >= margin) top = a.top - gap - h;
            setStyle({top, left, visibility: 'visible'});
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [open, anchorEl]);

    useEffect(() => {
        if (!open) return;
        const dentro = (t) => ref.current?.contains(t) || anchorEl?.contains(t);
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        const onDown = (e) => { if (!dentro(e.target)) onClose(); };
        // Si se desplaza la página (o la columna del TPV) el ancla se mueve: se cierra.
        const onScroll = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onDown);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onDown);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [open, onClose, anchorEl]);

    if (!open) return null;
    return createPortal(
        <div ref={ref} className="dc-popover" style={style} role="dialog"
             onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
            {children}
        </div>,
        document.body,
    );
}

export default function DateCarousel({fechaLimite, setFechaLimite, token}) {
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

    // Desplegable de pedidos del día: con ratón se abre al pasar por encima;
    // en pantallas táctiles (la tablet del taller no tiene hover) con el botón
    // de la esquina de cada día, que también sirve para dejarlo fijo con un clic.
    const canHover = useMemo(() => !window.matchMedia || window.matchMedia('(hover: hover)').matches, []);
    const cellRefs = useRef({});
    const [popDay, setPopDay] = useState(null);     // fecha cuyo desplegable está abierto
    const [popPinned, setPopPinned] = useState(false); // abierto con clic: no se cierra al salir con el ratón
    const popTimer = useRef(null);
    const clearPopTimer = () => { if (popTimer.current) { clearTimeout(popTimer.current); popTimer.current = null; } };
    const closePop = useCallback(() => { clearPopTimer(); setPopDay(null); setPopPinned(false); }, []);
    const hoverIn = (date) => {
        if (!canHover || popPinned) return;
        clearPopTimer();
        popTimer.current = setTimeout(() => setPopDay(date), 350);
    };
    const hoverOut = () => {
        if (!canHover || popPinned) return;
        clearPopTimer();
        popTimer.current = setTimeout(() => setPopDay(null), 200);
    };
    const togglePop = (date) => {
        clearPopTimer();
        if (popDay === date && popPinned) { closePop(); return; }
        setPopDay(date);
        setPopPinned(true);
    };
    useEffect(() => () => clearPopTimer(), []);
    // Al cambiar de semana el ancla desaparece: se cierra lo que hubiera abierto.
    useEffect(() => { closePop(); }, [weekStart, closePop]);

    const load = useCallback(async (start) => {
        setLoading(true);
        setError('');
        try {
            const res = await fetchDates(token, {start, weeks: WEEKS});
            setData(res);
        } catch (e) {
            console.error('Error cargando fechas de entrega:', e);
            setError('No se pudieron cargar las fechas de entrega');
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (token) load(weekStart);
    }, [token, weekStart, load]);

    // Si el pedido aún no tiene fecha (pedido nuevo o borrador vaciado),
    // se propone la fecha sugerida por el servidor.
    useEffect(() => {
        if (!fechaLimite && data?.suggestedDate) {
            setFechaLimite(data.suggestedDate);
        }
    }, [fechaLimite, data?.suggestedDate, setFechaLimite]);

    const days = data?.days || [];
    const loadByDay = data?.loadByDay || {};
    const suggestedDate = data?.suggestedDate || null;
    const loadMax = Number(data?.loadMax) > 0 ? Number(data.loadMax) : LOAD_MAX_FALLBACK;
    const {setCalendarInfo, suplementoUrgencia, sinSuplemento, setSinSuplemento} = draft;
    useEffect(() => {
        if (!data) return;
        const daysAheadByDate = {};
        (data.days || []).forEach(d => { daysAheadByDate[d.date] = d.daysAhead || 0; });
        setCalendarInfo({
            suggestedDate,
            urgency: {pctPerDay: Number(data.urgency?.pctPerDay) || 0, maxPct: Number(data.urgency?.maxPct) || 0},
            daysAheadByDate,
        });
    }, [data, suggestedDate, setCalendarInfo]);
    const weekEnd = addDays(weekStart, WEEKS * 7 - 1);
    const canGoBack = weekStart > mondayOf(todayStr);

    const dayByDate = Object.fromEntries(days.map(d => [d.date, d]));
    const selected = fechaLimite ? dayByDate[fechaLimite] : null;

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

    // Carga ponderada de un pedido (para el desplegable de detalle)
    const orderWeighted = (o) => lineasActivas(o.lines).reduce((s, l) => {
        const p = l.product || {};
        if (p.countsForLoad === false) return s;
        const w = (p.workloadWeight != null) ? Number(p.workloadWeight) : 1;
        return s + (l.quantity || 0) * w;
    }, 0);

    const rangeLabel = (() => {
        const a = fromYmd(weekStart), b = fromYmd(weekEnd);
        const sameMonth = a.getMonth() === b.getMonth();
        const left = a.toLocaleDateString('es-ES', sameMonth ? {day: 'numeric'} : {day: 'numeric', month: 'short'});
        const right = b.toLocaleDateString('es-ES', {day: 'numeric', month: 'short', year: a.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined});
        return `${left} – ${right}`;
    })();

    return (
        <div className="dc">
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
                            : `${orders.length} pedido${orders.length !== 1 ? 's' : ''} · carga ${fmtLoad(day.load)}`;

                    const hasPop = orders.length > 0 && !closed;
                    return (
                        <div key={day.date} className={`dc-cell ${disabled ? 'is-disabled' : ''} ${hasPop ? 'has-pop' : ''}`}
                             ref={el => { cellRefs.current[day.date] = el; }}
                             title={title}
                             onMouseEnter={hasPop ? () => hoverIn(day.date) : undefined}
                             onMouseLeave={hasPop ? hoverOut : undefined}>
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

                            {hasPop && (
                                <>
                                    <button type="button" className="dc-pop-btn"
                                            aria-label={`Ver los ${orders.length} pedidos del día`}
                                            aria-expanded={popDay === day.date}
                                            onClick={(e) => { e.stopPropagation(); togglePop(day.date); }}>
                                        <span uk-icon="icon: list; ratio: 0.55"></span>
                                    </button>
                                    <DayPopover anchorEl={cellRefs.current[day.date]}
                                                open={popDay === day.date}
                                                onClose={closePop}
                                                onMouseEnter={clearPopTimer}
                                                onMouseLeave={hoverOut}>
                                        <div className="dc-pop">
                                            <div className="dc-pop-head uk-flex uk-flex-between uk-flex-middle">
                                                <strong>{cap(fmt(day.date, {weekday: 'long', day: 'numeric', month: 'short'}))}</strong>
                                                <button type="button" className="dc-pop-close" aria-label="Cerrar" onClick={closePop}>
                                                    <span uk-icon="icon: close; ratio: 0.7"></span>
                                                </button>
                                            </div>
                                            <div className="dc-pop-list">
                                                {orders.map(order => {
                                                    const [stLabel, stClass] = ESTADOS[order.status] || [order.status, 'default'];
                                                    return (
                                                        <div key={order.id} className="dc-pop-item">
                                                            <div className="uk-flex uk-flex-between uk-flex-middle" style={{gap: 6}}>
                                                                <Link to={rutaPedido(order)} className="uk-text-bold" style={{fontSize: '0.82rem'}}
                                                                      title="Abrir el pedido">
                                                                    {order.orderNum}
                                                                </Link>
                                                                <span className={`uk-label uk-label-${stClass}`} style={{fontSize: '0.6rem'}}>{stLabel}</span>
                                                            </div>
                                                            <div className="uk-text-muted" style={{fontSize: '0.72rem'}}>
                                                                {order.client ? (
                                                                    <Link to={rutaCliente(order.client)} className="dc-pop-client" title="Ver la ficha del cliente">
                                                                        {order.client.firstName} {order.client.lastName}
                                                                    </Link>
                                                                ) : 'Cliente rápido'}
                                                                {' · Carga '}{fmtLoad(orderWeighted(order))}
                                                            </div>
                                                            <div style={{fontSize: '0.72rem', marginTop: 2, lineHeight: 1.35}}>
                                                                {lineasActivas(order.lines).map((l, i) => {
                                                                    const noLoad = l.product?.countsForLoad === false;
                                                                    return (
                                                                        <span key={l.id} style={{color: noLoad ? '#9ca3af' : '#475569'}}>
                                                                            {i > 0 ? ', ' : ''}{l.quantity}× {l.product?.name || `#${l.productId}`}{noLoad ? ' (no computa)' : ''}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="dc-pop-foot">
                                                {orders.length} pedido{orders.length !== 1 ? 's' : ''} · Carga {fmtLoad(day.load)}
                                            </div>
                                        </div>
                                    </DayPopover>
                                </>
                            )}
                        </div>
                    );
                })}

                {loading && !days.length && (
                    <div className="dc-loading"><div uk-spinner="ratio: 0.8"></div></div>
                )}
            </div>

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
                        {!selected && (
                            <button type="button" className="dc-link" onClick={() => goToDate(fechaLimite)}>Ver en calendario</button>
                        )}
                        {suggestedDate && suggestedDate !== fechaLimite && (
                            <button type="button" className="dc-link" onClick={() => { setFechaLimite(suggestedDate); goToDate(suggestedDate); }}>
                                Usar sugerida ({fmt(suggestedDate, {weekday: 'short', day: 'numeric', month: 'short'})})
                            </button>
                        )}
                    </>
                ) : (
                    <span className="uk-text-muted">Selecciona un día de entrega</span>
                )}
            </div>

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

            <div className="dc-legend">
                <span><i className="load-low"/>Poca carga</span>
                <span><i className="load-mid"/>Media</span>
                <span><i className="load-high"/>Llena</span>
                <span><i className="closed"/>Cerrado / festivo</span>
            </div>
        </div>
    );
}
