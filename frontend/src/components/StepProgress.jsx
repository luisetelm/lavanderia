import React, { useEffect, useState } from 'react';

/* ── Helpers de formato ── */
function formatHHMM(date) {
    if (!date) return null;
    const d = new Date(date);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const hhmm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return hhmm;
    return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ${hhmm}`;
}

function formatDurationMs(ms) {
    if (!ms || ms <= 0) return '0s';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

function formatEstimateMin(min) {
    if (!min || min <= 0) return null;
    if (min < 60) return `~${min}min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `~${h}h${m}m` : `~${h}h`;
}

/**
 * Calcula:
 *  - startMs: instante en el que se INICIÓ el primer paso (mínimo startedAt).
 *  - endMs: instante en el que se completó el ÚLTIMO paso (máximo completedAt) si todo está done,
 *      o `now` si aún hay pasos pendientes/en curso.
 *  - totalElapsedMs: endMs - startMs.
 *  - perStepElapsedMs: ms transcurridos por paso individual (real, solo si tiene startedAt).
 *  - isFinished: true si todos los pasos están done.
 */
function computeStepTimes(steps, now) {
    let firstStartedAt = null;
    let lastCompletedAt = null;
    const perStepElapsedMs = {};
    const perStepInferred = {}; // true si el tiempo se infirió por wall-clock (no había start explícito)
    let allDone = steps.length > 0;

    // Paso 1: tiempos explícitos (startedAt presente y > 1s antes de completedAt)
    for (const s of steps) {
        if (s.status !== 'done') allDone = false;

        if (s.startedAt) {
            const startMs = new Date(s.startedAt).getTime();
            if (!firstStartedAt || startMs < firstStartedAt) firstStartedAt = startMs;

            if (s.status === 'done' && s.completedAt) {
                const real = new Date(s.completedAt).getTime() - startMs;
                if (real > 1000) perStepElapsedMs[s.id] = real;
            } else if (s.status === 'in_progress') {
                perStepElapsedMs[s.id] = Math.max(0, now - startMs);
            }
        }
        if (s.status === 'done' && s.completedAt) {
            const c = new Date(s.completedAt).getTime();
            if (!lastCompletedAt || c > lastCompletedAt) lastCompletedAt = c;
        }
    }

    // Paso 2: inferir tiempo "de permanencia" para pasos done sin start explícito,
    // usando el completedAt del paso done inmediatamente anterior (por posición).
    // Esto da el tiempo wall-clock que la prenda pasó esperando en esa fase
    // antes de avanzar, que es la métrica útil cuando no se usa el botón Iniciar.
    const orderedDone = steps
        .filter(s => s.status === 'done' && s.completedAt)
        .sort((a, b) => {
            const pa = a.position ?? 0;
            const pb = b.position ?? 0;
            if (pa !== pb) return pa - pb;
            return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
        });

    for (let i = 0; i < orderedDone.length; i++) {
        const s = orderedDone[i];
        if (perStepElapsedMs[s.id]) continue; // ya tiene tiempo explícito
        const completedMs = new Date(s.completedAt).getTime();
        const prev = orderedDone[i - 1];
        if (prev) {
            const prevCompletedMs = new Date(prev.completedAt).getTime();
            const gap = completedMs - prevCompletedMs;
            if (gap > 0) {
                perStepElapsedMs[s.id] = gap;
                perStepInferred[s.id] = true;
            }
        }
        // Primer paso sin start: no podemos saber cuánto estuvo, lo dejamos sin valor.
    }

    const isFinished = allDone;
    const startMs = firstStartedAt;
    const endMs = isFinished && lastCompletedAt ? lastCompletedAt : (startMs ? now : null);
    const totalElapsedMs = (startMs && endMs && endMs > startMs) ? (endMs - startMs) : 0;

    return { startMs, endMs, totalElapsedMs, perStepElapsedMs, perStepInferred, isFinished };
}

export default function StepProgress({ steps, onComplete, compact = false }) {
    // Reloj para refrescar pasos en curso cada segundo
    const [now, setNow] = useState(Date.now());
    const [showTimeline, setShowTimeline] = useState(false);
    useEffect(() => {
        const allDone = (steps || []).every(s => s.status === 'done');
        if (allDone) return; // si está finalizado no hace falta tick
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [steps]);

    if (!steps || steps.length === 0) return null;

    const doneCount = steps.filter(s => s.status === 'done').length;
    const pct = Math.round((doneCount / steps.length) * 100);
    const nextStep = steps.find(s => s.status !== 'done');

    const { startMs, endMs, totalElapsedMs, perStepElapsedMs, perStepInferred, isFinished } = computeStepTimes(steps, now);
    const totalEstimateMin = steps.reduce((acc, s) => acc + (s.durationMin || 0), 0);

    return (
        <div style={{ marginTop: compact ? 4 : 8 }}>
            {/* Barra de progreso */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: compact ? 2 : 6,
            }}>
                <div style={{
                    flex: 1, height: compact ? 4 : 6, background: '#e2e8f0',
                    borderRadius: 4, overflow: 'hidden',
                }}>
                    <div style={{
                        width: `${pct}%`, height: '100%',
                        background: pct === 100 ? '#22c55e' : '#3b82f6',
                        transition: 'width 0.3s ease',
                        borderRadius: 4,
                    }} />
                </div>
                <span style={{ fontSize: compact ? '0.65rem' : '0.72rem', color: '#64748b', flexShrink: 0 }}>
                    {doneCount}/{steps.length}
                </span>
            </div>

            {/* Pasos */}
            {!compact && (
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                    {steps.map((step, idx) => {
                        const isDone = step.status === 'done';
                        const isInProgress = step.status === 'in_progress';
                        const isNext = step.id === nextStep?.id;
                        const elapsedMs = perStepElapsedMs[step.id];
                        const estimate = formatEstimateMin(step.durationMin);

                        const tooltipParts = [step.stepLabel];
                        if (estimate) tooltipParts.push(`Estimado: ${estimate}`);
                        if (step.startedAt) tooltipParts.push(`Inicio: ${formatHHMM(step.startedAt)}`);
                        if (isDone && step.completedAt) tooltipParts.push(`Fin: ${formatHHMM(step.completedAt)}`);
                        if (elapsedMs) tooltipParts.push(`Duración real: ${formatDurationMs(elapsedMs)}`);
                        if (isDone && step.completedBy) tooltipParts.push(`Por: ${step.completedBy.firstName}`);

                        return (
                            <div
                                key={step.id || idx}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    padding: '3px 8px', borderRadius: 12,
                                    background: isDone ? '#dcfce7' : isInProgress ? '#dbeafe' : isNext ? '#eff6ff' : '#f1f5f9',
                                    border: `1px solid ${isDone ? '#22c55e' : isInProgress ? '#2563eb' : isNext ? '#3b82f6' : '#cbd5e1'}`,
                                    fontSize: '0.68rem',
                                    color: isDone ? '#15803d' : isInProgress ? '#1d4ed8' : isNext ? '#1d4ed8' : '#94a3b8',
                                    fontWeight: isNext || isInProgress ? 700 : 400,
                                    cursor: isNext && onComplete ? 'pointer' : 'default',
                                    transition: 'transform 0.1s',
                                }}
                                title={tooltipParts.join(' · ')}
                                onClick={() => {
                                    if (isNext && onComplete) onComplete(step.id);
                                }}
                                onMouseEnter={e => isNext && onComplete && (e.currentTarget.style.transform = 'scale(1.05)')}
                                onMouseLeave={e => isNext && onComplete && (e.currentTarget.style.transform = 'scale(1)')}
                            >
                                {isDone
                                    ? <span uk-icon="icon: check; ratio: 0.5"></span>
                                    : isInProgress
                                        ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563eb', display: 'inline-block' }}></span>
                                        : isNext
                                            ? <span uk-icon="icon: play; ratio: 0.45"></span>
                                            : null
                                }
                                {step.stepLabel}
                                {/* Tiempo inline en la chip: real si ya empezó, estimado si aún no */}
                                {(isDone && elapsedMs != null) ? (
                                    <span style={{ marginLeft: 3, opacity: 0.75, fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}
                                          title={perStepInferred[step.id] ? 'Tiempo de permanencia (inferido entre pasos)' : 'Duración real medida'}>
                                        · {perStepInferred[step.id] ? '~' : ''}{formatDurationMs(elapsedMs)}
                                    </span>
                                ) : isInProgress && elapsedMs ? (
                                    <span style={{ marginLeft: 3, fontVariantNumeric: 'tabular-nums' }}>
                                        · {formatDurationMs(elapsedMs)}
                                    </span>
                                ) : estimate ? (
                                    <span style={{ marginLeft: 3, opacity: 0.6, fontWeight: 400 }}>
                                        · {estimate}
                                    </span>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Resumen de tiempos de la prenda */}
            {!compact && (startMs || totalElapsedMs > 0 || totalEstimateMin > 0) && (
                <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6,
                    fontSize: '0.65rem', color: '#64748b', fontVariantNumeric: 'tabular-nums',
                }}>
                    {startMs && (
                        <span title="Fecha y hora desde que la prenda entró en proceso">
                            ▶ Inicio: <strong style={{ color: '#334155' }}>{formatHHMM(startMs)}</strong>
                        </span>
                    )}
                    {isFinished && endMs && (
                        <span title="Fecha y hora en la que se completó el último paso">
                            🏁 Fin: <strong style={{ color: '#334155' }}>{formatHHMM(endMs)}</strong>
                        </span>
                    )}
                    {totalElapsedMs > 0 && (
                        <span title={isFinished
                            ? 'Tiempo total de proceso (desde recepción hasta el último paso completado)'
                            : 'Tiempo transcurrido desde recepción (sigue actualizándose)'}
                        >
                            Σ {isFinished ? 'Proceso' : 'Transcurrido'}: <strong style={{ color: '#334155' }}>{formatDurationMs(totalElapsedMs)}</strong>
                        </span>
                    )}
                    {totalEstimateMin > 0 && (
                        <span title="Suma de las duraciones estimadas de trabajo activo de todos los pasos">
                            ⏱ Trabajo estimado: <strong style={{ color: '#334155' }}>{formatEstimateMin(totalEstimateMin)}</strong>
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => setShowTimeline(v => !v)}
                        style={{
                            marginLeft: 'auto', padding: '1px 8px', borderRadius: 10,
                            border: '1px solid #cbd5e1', background: showTimeline ? '#e2e8f0' : '#fff',
                            color: '#475569', cursor: 'pointer', fontSize: '0.65rem',
                        }}
                        title="Ver tiempos detallados de cada paso"
                    >
                        {showTimeline ? '▴ Ocultar cronología' : '▾ Ver cronología'}
                    </button>
                </div>
            )}

            {/* Panel desplegable: cronología paso a paso */}
            {!compact && showTimeline && (
                <div style={{
                    marginTop: 6, padding: '8px 10px',
                    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6,
                    fontSize: '0.7rem',
                }}>
                    <div style={{
                        fontWeight: 600, color: '#475569', marginBottom: 6,
                        fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.03em',
                    }}>
                        Cronología de pasos
                    </div>
                    {steps.map(s => {
                        const isDone = s.status === 'done';
                        const isInProgress = s.status === 'in_progress';
                        let liveMs = perStepElapsedMs[s.id];
                        if (isInProgress && s.startedAt) {
                            liveMs = Math.max(0, now - new Date(s.startedAt).getTime());
                        }
                        const statusIcon = isDone ? '✓' : isInProgress ? '▶' : '○';
                        const statusColor = isDone ? '#16a34a' : isInProgress ? '#2563eb' : '#94a3b8';
                        const estimate = formatEstimateMin(s.durationMin);
                        return (
                            <div key={s.id} style={{
                                display: 'grid',
                                gridTemplateColumns: 'auto 1fr auto',
                                gap: 8, alignItems: 'center',
                                padding: '3px 0',
                                borderTop: '1px dashed #e2e8f0',
                            }}>
                                <span style={{ color: statusColor, width: 14, textAlign: 'center', fontWeight: 700 }}>{statusIcon}</span>
                                <span style={{ color: s.status === 'pending' ? '#94a3b8' : '#1e293b', minWidth: 0 }}>
                                    <strong style={{ fontWeight: 600 }}>{s.stepLabel}</strong>
                                    {s.startedAt && (
                                        <span style={{ marginLeft: 6, color: '#64748b', fontWeight: 400 }}>
                                            {formatHHMM(s.startedAt)}
                                            {s.completedAt ? ` → ${formatHHMM(s.completedAt)}` : isInProgress ? ' → en curso' : ''}
                                        </span>
                                    )}
                                    {isDone && s.completedBy?.firstName && (
                                        <span style={{ marginLeft: 6, color: '#94a3b8', fontWeight: 400, fontSize: '0.62rem' }}>
                                            · {s.completedBy.firstName}
                                        </span>
                                    )}
                                </span>
                                <span style={{
                                    fontVariantNumeric: 'tabular-nums', color: statusColor,
                                    minWidth: 60, textAlign: 'right', fontWeight: 600,
                                }}
                                title={perStepInferred[s.id]
                                    ? 'Tiempo de permanencia (entre el paso anterior y este)'
                                    : (liveMs != null ? 'Duración real medida' : (estimate ? 'Tiempo estimado' : ''))}>
                                    {liveMs != null
                                        ? <>{perStepInferred[s.id] ? '~' : ''}{formatDurationMs(liveMs)}</>
                                        : estimate
                                            ? <span style={{ opacity: 0.6, fontWeight: 400 }}>{estimate}</span>
                                            : '—'}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
