import React from 'react';

export default function StepProgress({ steps, onComplete, compact = false }) {
    if (!steps || steps.length === 0) return null;

    const doneCount = steps.filter(s => s.status === 'done').length;
    const pct = Math.round((doneCount / steps.length) * 100);

    // Encontrar el próximo paso pendiente
    const nextStep = steps.find(s => s.status !== 'done');

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
                        const isNext = step.id === nextStep?.id;

                        return (
                            <div
                                key={step.id || idx}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    padding: '3px 8px', borderRadius: 12,
                                    background: isDone ? '#dcfce7' : isNext ? '#eff6ff' : '#f1f5f9',
                                    border: `1px solid ${isDone ? '#22c55e' : isNext ? '#3b82f6' : '#cbd5e1'}`,
                                    fontSize: '0.68rem',
                                    color: isDone ? '#15803d' : isNext ? '#1d4ed8' : '#94a3b8',
                                    fontWeight: isNext ? 700 : 400,
                                    cursor: isNext && onComplete ? 'pointer' : 'default',
                                    transition: 'transform 0.1s',
                                }}
                                title={isDone
                                    ? `Completado${step.completedBy ? ` por ${step.completedBy.firstName}` : ''}${step.completedAt ? ` (${new Date(step.completedAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})` : ''}`
                                    : step.stepLabel
                                }
                                onClick={() => {
                                    if (isNext && onComplete) onComplete(step.id);
                                }}
                                onMouseEnter={e => isNext && onComplete && (e.currentTarget.style.transform = 'scale(1.05)')}
                                onMouseLeave={e => isNext && onComplete && (e.currentTarget.style.transform = 'scale(1)')}
                            >
                                {isDone
                                    ? <span uk-icon="icon: check; ratio: 0.5"></span>
                                    : isNext
                                        ? <span uk-icon="icon: play; ratio: 0.45"></span>
                                        : null
                                }
                                {step.stepLabel}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
