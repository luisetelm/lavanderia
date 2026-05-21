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
    let allDone = steps.length > 0;

    for (const s of steps) {
        if (s.status !== 'done') allDone = false;

        if (s.startedAt) {
            const startMs = new Date(s.startedAt).getTime();
            if (!firstStartedAt || startMs < firstStartedAt) firstStartedAt = startMs;

            if (s.status === 'done' && s.completedAt) {
                perStepElapsedMs[s.id] = new Date(s.completedAt).getTime() - startMs;
            } else if (s.status === 'in_progress') {
                perStepElapsedMs[s.id] = Math.max(0, now - startMs);
            }
        }
        if (s.status === 'done' && s.completedAt) {
            const c = new Date(s.completedAt).getTime();
            if (!lastCompletedAt || c > lastCompletedAt) lastCompletedAt = c;
        }
    }

    const isFinished = allDone;
    const startMs = firstStartedAt;
    const endMs = isFinished && lastCompletedAt ? lastCompletedAt : (startMs ? now : null);
    const totalElapsedMs = (startMs && endMs && endMs > startMs) ? (endMs - startMs) : 0;

    return { startMs, endMs, totalElapsedMs, perStepElapsedMs, isFinished };
}

export default function StepProgress({ steps, onComplete, compact = false }) {
    // Reloj para refrescar pasos en curso cada segundo
    const [now, setNow] = useState(Date.now());
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

    const { startMs, endMs, totalElapsedMs, perStepElapsedMs, isFinished } = computeStepTimes(steps, now);
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
                                {(isDone && elapsedMs) ? (
                                    <span style={{ marginLeft: 3, opacity: 0.75, fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>
                                        · {formatDurationMs(elapsedMs)}
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
                </div>
            )}
        </div>
    );
}
