import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Link} from 'react-router-dom';
import UIkit from 'uikit';
import {lineasActivas} from '../utils/lineas.js';
import {fetchDates} from '../api';
import {useDraftOrder} from '../hooks/useDraftOrder.js';
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

export default function DateCarousel({fechaLimite, setFechaLimite, token, esAdmin = false}) {
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

                    return (
                        <div key={day.date} className="dc-cell">
                            <button
                                type="button"
                                className={cls}
                                onClick={() => selectDay(day)}
                                disabled={disabled}
                                aria-pressed={isSelected}
                                title={title}
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
                                        <span className="dc-bar"><i style={{width: `${Math.min(day.load / dayMax, 1) * 100}%`}}/></span>
                                        <span className="dc-meta">
                                            {orders.length > 0 ? `${orders.length} ped · ${fmtLoad(day.load)}` : (day.load > 0 ? `reserva · ${fmtLoad(day.load)}` : 'libre')}
                                        </span>
                                    </>
                                )}

                                {isSuggested && !closed && !day.isPast && <span className="dc-badge">Sugerida</span>}
                                {isSelected && <span className="dc-check" uk-icon="icon: check; ratio: 0.7"></span>}
                            </button>

                            {/* Detalle de pedidos del día al pasar el ratón */}
                            {orders.length > 0 && !closed && (
                                <div className="uk-card uk-card-default" style={{padding: 0}}
                                     uk-dropdown="mode: hover; delay-show: 350; delay-hide: 200; pos: bottom-center; container: true; animation: uk-animation-slide-top-small">
                                    <div className="dc-pop">
                                        <div className="dc-pop-head">
                                            <strong>{cap(fmt(day.date, {weekday: 'long', day: 'numeric', month: 'short'}))}</strong>
                                        </div>
                                        <div className="dc-pop-list">
                                            {orders.map(order => {
                                                const st = order.status;
                                                const stLabel = st === 'pending' ? 'Pendiente' : st === 'in_progress' ? 'En proceso' : st === 'ready' ? 'Listo' : st === 'collected' ? 'Recogido' : st === 'cancelled' ? 'Cancelado' : st;
                                                const stClass = st === 'pending' ? 'warning' : st === 'in_progress' ? 'primary' : st === 'ready' ? 'success' : 'default';
                                                return (
                                                    <div key={order.id} className="dc-pop-item">
                                                        <div className="uk-flex uk-flex-between uk-flex-middle" style={{gap: 6}}>
                                                            <Link to="/tareas"
                                                                  state={{filterOrderId: order.id, orderNumber: order.orderNum || order.id}}
                                                                  className="uk-text-bold" style={{fontSize: '0.82rem'}}>
                                                                {order.orderNum}
                                                            </Link>
                                                            <span className={`uk-label uk-label-${stClass}`} style={{fontSize: '0.6rem'}}>{stLabel}</span>
                                                        </div>
                                                        <div className="uk-text-muted" style={{fontSize: '0.72rem'}}>
                                                            {order.client?.firstName} {order.client?.lastName} · Carga {fmtLoad(orderWeighted(order))}
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
                                </div>
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
                    {esAdmin && suplementoUrgencia.pctPerDay > 0 && !suplementoUrgencia.granCliente && (
                        <label className="dc-urgent-waive" title="Sólo administración">
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
