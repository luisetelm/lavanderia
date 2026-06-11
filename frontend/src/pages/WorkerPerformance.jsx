// frontend/src/pages/WorkerPerformance.jsx
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import PageToolbar from '../components/PageToolbar.jsx';
import DateRangeSelector from '../components/DateRangeSelector.jsx';
import { fetchWorkerPerformance } from '../api.js';

// Paleta para los segmentos de cada tipo de proceso
const STEP_PALETTE = [
    '#2563eb', '#16a34a', '#ea580c', '#9333ea', '#dc2626',
    '#0891b2', '#ca8a04', '#db2777', '#0d9488', '#7c3aed',
];

// Devuelve el mejor nombre disponible para una trabajadora
function workerDisplayName(w) {
    if (!w) return '';
    const composed = `${w.firstName || ''} ${w.lastName || ''}`.trim();
    return composed || w.name || w.email || `Trabajadora #${w.workerId}`;
}

function formatMin(min) {
    if (min == null) return '–';
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function formatEUR(amount) {
    if (amount == null || isNaN(amount)) return '–';
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(amount);
}

function Delta({ pct }) {
    if (pct == null || isNaN(pct)) return <span style={{ color: '#94a3b8' }}>–</span>;
    if (pct === 0) return <span style={{ color: '#64748b' }}>0%</span>;
    const up = pct > 0;
    return (
        <span style={{
            color: up ? '#16a34a' : '#dc2626',
            fontWeight: 600,
            fontSize: '0.78rem',
            whiteSpace: 'nowrap',
        }}>
            {up ? '▲' : '▼'} {Math.abs(pct)}%
        </span>
    );
}

function CompareCell({ current, previous, delta, suffix = '' }) {
    return (
        <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 700 }}>{current}{suffix}</div>
            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                ant: {previous}{suffix} <Delta pct={delta} />
            </div>
        </div>
    );
}

// Barra apilada horizontal: muestra el mix de procesos de una trabajadora
function StackedBar({ byStepLabel, total, labelColors, maxTotal }) {
    if (!total || total === 0) {
        return <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Sin procesos</div>;
    }
    // Anchura total proporcional al máximo del equipo (para comparar visualmente entre trabajadoras)
    const widthPct = maxTotal > 0 ? (total / maxTotal) * 100 : 100;
    const entries = Object.entries(byStepLabel)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);
    return (
        <div style={{ width: '100%' }}>
            <div style={{
                width: `${widthPct}%`,
                minWidth: 40,
                height: 18,
                background: '#f1f5f9',
                borderRadius: 4,
                overflow: 'hidden',
                display: 'flex',
            }}>
                {entries.map(([lbl, v]) => {
                    const segPct = (v / total) * 100;
                    return (
                        <div
                            key={lbl}
                            title={`${lbl}: ${v} (${segPct.toFixed(1)}%)`}
                            style={{
                                width: `${segPct}%`,
                                background: labelColors[lbl] || '#64748b',
                                color: 'white',
                                fontSize: '0.65rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {segPct >= 12 ? v : ''}
                        </div>
                    );
                })}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
                {total} procesos
            </div>
        </div>
    );
}

function PunctualityCell({ current, previous, eligible, count }) {
    if (current == null) {
        return <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>sin fecha límite</div>;
    }
    const color = current >= 90 ? '#16a34a' : current >= 70 ? '#ca8a04' : '#dc2626';
    const deltaPct = (previous != null)
        ? Number((current - previous).toFixed(1))
        : null;
    return (
        <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontWeight: 700, color }}>{current}%</div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                {count}/{eligible} a tiempo
            </div>
            {deltaPct != null && (
                <div style={{ fontSize: '0.7rem', color: deltaPct >= 0 ? '#16a34a' : '#dc2626' }}>
                    {deltaPct >= 0 ? '▲' : '▼'} {Math.abs(deltaPct)} pp
                </div>
            )}
        </div>
    );
}

function KpiCard({ label, value, previous, delta, suffix = '' }) {
    return (
        <div className="uk-card uk-card-default uk-card-body" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                {label}
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: 2 }}>
                {value}{suffix}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span>período anterior: <strong>{previous}{suffix}</strong></span>
                <Delta pct={delta} />
            </div>
        </div>
    );
}

export default function WorkerPerformance({ token }) {
    const today = new Date();
    const formatDate = (d) => d.toISOString().slice(0, 10);
    const defaultTo = formatDate(today);
    const defaultFrom = formatDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29));

    const [from, setFrom] = useState(() => localStorage.getItem('wp_from') || defaultFrom);
    const [to, setTo] = useState(() => localStorage.getItem('wp_to') || defaultTo);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const persist = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (_) { /* noop */ } };

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWorkerPerformance(token, { from, to });
            setData(res);
        } catch (e) {
            console.error('Error cargando rendimiento', e);
            setError(e.error || 'Error cargando rendimiento');
        } finally {
            setLoading(false);
        }
    }, [token, from, to]);

    useEffect(() => { load(); }, [load]);

    const topStepLabels = useMemo(() => {
        if (!data?.workers) return [];
        const set = new Map();
        for (const w of data.workers) {
            for (const [k, v] of Object.entries(w.current.byStepLabel || {})) {
                set.set(k, (set.get(k) || 0) + v);
            }
        }
        return Array.from(set.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([k]) => k);
    }, [data]);

    // Todos los tipos de paso con su color (para gráfico apilado y leyenda)
    const allStepLabels = useMemo(() => {
        if (!data?.workers) return [];
        const set = new Map();
        for (const w of data.workers) {
            for (const [k, v] of Object.entries(w.current.byStepLabel || {})) {
                set.set(k, (set.get(k) || 0) + v);
            }
        }
        return Array.from(set.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([k]) => k);
    }, [data]);

    const labelColors = useMemo(() => {
        const map = {};
        allStepLabels.forEach((lbl, i) => { map[lbl] = STEP_PALETTE[i % STEP_PALETTE.length]; });
        return map;
    }, [allStepLabels]);

    const maxStepsPerWorker = useMemo(() => {
        if (!data?.workers) return 0;
        return data.workers.reduce((m, w) => Math.max(m, w.current.stepsCompleted || 0), 0);
    }, [data]);

    return (
        <div>
            <PageToolbar title="Rendimiento del equipo" />

            <div className="uk-card uk-card-default uk-card-body" style={{ marginBottom: 16 }}>
                <DateRangeSelector
                    from={from}
                    to={to}
                    onChange={({ from: f, to: t }) => {
                        setFrom(f); setTo(t);
                        persist('wp_from', f); persist('wp_to', t);
                    }}
                />
                {data && (
                    <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#64748b' }}>
                        <strong>Comparando con período anterior:</strong> {data.previous.from} → {data.previous.to}
                        {' '}({data.range.days} días)
                    </div>
                )}
            </div>

            {error && (
                <div className="uk-alert-danger" data-uk-alert>
                    <p>{error}</p>
                </div>
            )}

            {loading ? (
                <div className="uk-text-center uk-margin">
                    <span className="uk-badge uk-badge-warning">Cargando...</span>
                </div>
            ) : !data ? null : (
                <>
                    {/* KPIs globales */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: 10,
                        marginBottom: 16,
                    }}>
                        <KpiCard
                            label="Procesos completados"
                            value={data.totals.current.stepsCompleted}
                            previous={data.totals.previous.stepsCompleted}
                            delta={data.totals.deltas.stepsCompletedPct}
                        />
                        <KpiCard
                            label="Pedidos finalizados"
                            value={data.totals.current.ordersFinishedCount ?? 0}
                            previous={data.totals.previous.ordersFinishedCount ?? 0}
                            delta={data.totals.deltas.ordersFinishedPct}
                        />
                        <KpiCard
                            label="Importe finalizado"
                            value={formatEUR(data.totals.current.ordersFinishedAmount ?? 0)}
                            previous={formatEUR(data.totals.previous.ordersFinishedAmount ?? 0)}
                            delta={data.totals.deltas.ordersFinishedAmountPct}
                        />
                        <KpiCard
                            label="Pedidos atendidos"
                            value={data.totals.current.ordersCount}
                            previous={data.totals.previous.ordersCount}
                            delta={data.totals.deltas.ordersCountPct}
                        />
                        <KpiCard
                            label="Líneas tocadas"
                            value={data.totals.current.linesCount}
                            previous={data.totals.previous.linesCount}
                            delta={data.totals.deltas.linesCountPct}
                        />
                        <KpiCard
                            label="Trabajadoras activas"
                            value={data.workers.filter(w => w.current.stepsCompleted > 0).length}
                            previous={data.workers.filter(w => w.previous.stepsCompleted > 0).length}
                            delta={null}
                        />
                    </div>

                    {/* Gráfico de barras apiladas: mix de procesos por trabajadora */}
                    <div className="uk-card uk-card-default uk-card-body" style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                            <h4 style={{ margin: 0 }}>Distribución de procesos por trabajadora</h4>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                Cada barra muestra el reparto por tipo de proceso. Anchura proporcional al volumen total.
                            </div>
                        </div>

                        {(() => {
                            const activeWorkers = data.workers.filter(w => w.current.stepsCompleted > 0);
                            if (activeWorkers.length === 0 || allStepLabels.length === 0) {
                                return (
                                    <div style={{
                                        padding: '20px 16px',
                                        textAlign: 'center',
                                        color: '#94a3b8',
                                        fontSize: '0.85rem',
                                        background: '#f8fafc',
                                        borderRadius: 6,
                                    }}>
                                        No hay procesos cerrados en este período para mostrar el gráfico.
                                        <div style={{ fontSize: '0.72rem', marginTop: 4 }}>
                                            (Sólo se cuentan pasos del tracking marcados como completados con trabajadora asignada.)
                                        </div>
                                    </div>
                                );
                            }
                            return (
                                <>
                                    {/* Leyenda */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                                        {allStepLabels.map(lbl => (
                                            <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem' }}>
                                                <span style={{
                                                    width: 12, height: 12, borderRadius: 2,
                                                    background: labelColors[lbl], display: 'inline-block',
                                                }} />
                                                {lbl}
                                            </div>
                                        ))}
                                    </div>
                                    {/* Filas */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {activeWorkers.map(w => (
                                            <div key={w.workerId} style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'minmax(120px, 160px) 1fr',
                                                gap: 10,
                                                alignItems: 'center',
                                            }}>
                                                <div style={{
                                                    fontSize: '0.82rem',
                                                    fontWeight: 600,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                }} title={workerDisplayName(w)}>
                                                    {workerDisplayName(w)}
                                                </div>
                                                <StackedBar
                                                    byStepLabel={w.current.byStepLabel || {}}
                                                    total={w.current.stepsCompleted}
                                                    labelColors={labelColors}
                                                    maxTotal={maxStepsPerWorker}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </>
                            );
                        })()}
                    </div>

                    {/* Tabla por trabajadora */}
                    <div className="uk-card uk-card-default uk-card-body" style={{ padding: 0 }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table className="uk-table uk-table-divider uk-table-small uk-table-hover" style={{ margin: 0 }}>
                                <thead style={{ background: '#f8fafc' }}>
                                    <tr>
                                        <th style={{ minWidth: 160 }}>Trabajadora</th>
                                        <th className="uk-text-right" style={{ minWidth: 120 }}>Procesos</th>
                                        <th className="uk-text-right" style={{ minWidth: 120 }}>Pedidos</th>
                                        <th className="uk-text-right" style={{ minWidth: 110 }}>Finalizados</th>
                                        <th className="uk-text-right" style={{ minWidth: 120 }}>Importe finalizado</th>
                                        <th className="uk-text-right" style={{ minWidth: 110 }}>Líneas</th>
                                        <th className="uk-text-right" style={{ minWidth: 110 }}>Tiempo medio / proceso</th>
                                        <th className="uk-text-right" style={{ minWidth: 110 }}>Tiempo total</th>
                                        <th className="uk-text-right" style={{ minWidth: 110 }}>Puntualidad</th>
                                        <th className="uk-text-right" style={{ minWidth: 90 }}>% del equipo</th>
                                        {topStepLabels.map(l => (
                                            <th key={l} className="uk-text-right" style={{ minWidth: 90 }}>{l}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.workers.length === 0 ? (
                                        <tr>
                                            <td colSpan={10 + topStepLabels.length} style={{ textAlign: 'center', padding: 30, color: '#94a3b8' }}>
                                                No hay procesos cerrados en el período.
                                            </td>
                                        </tr>
                                    ) : data.workers.map(w => (
                                        <tr key={w.workerId}>
                                            <td>
                                                <div style={{ fontWeight: 600 }}>
                                                    {workerDisplayName(w)}
                                                    {!w.isActive && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: '#94a3b8' }}>(inactiva)</span>}
                                                </div>
                                                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{w.role}</div>
                                            </td>
                                            <td className="uk-text-right">
                                                <CompareCell
                                                    current={w.current.stepsCompleted}
                                                    previous={w.previous.stepsCompleted}
                                                    delta={w.deltas.stepsCompletedPct}
                                                />
                                            </td>
                                            <td className="uk-text-right">
                                                <CompareCell
                                                    current={w.current.ordersCount}
                                                    previous={w.previous.ordersCount}
                                                    delta={w.deltas.ordersCountPct}
                                                />
                                            </td>
                                            <td className="uk-text-right">
                                                <CompareCell
                                                    current={w.current.ordersFinishedCount ?? 0}
                                                    previous={w.previous.ordersFinishedCount ?? 0}
                                                    delta={w.deltas.ordersFinishedPct}
                                                />
                                            </td>
                                            <td className="uk-text-right">
                                                <CompareCell
                                                    current={formatEUR(w.current.ordersFinishedAmount ?? 0)}
                                                    previous={formatEUR(w.previous.ordersFinishedAmount ?? 0)}
                                                    delta={w.deltas.ordersFinishedAmountPct}
                                                />
                                            </td>
                                            <td className="uk-text-right">
                                                <CompareCell
                                                    current={w.current.linesCount}
                                                    previous={w.previous.linesCount}
                                                    delta={w.deltas.linesCountPct}
                                                />
                                            </td>
                                            <td className="uk-text-right">
                                                <div style={{ fontWeight: 600 }}>{formatMin(w.current.avgStepMin)}</div>
                                                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                                    ant: {formatMin(w.previous.avgStepMin)}
                                                </div>
                                            </td>
                                            <td className="uk-text-right">
                                                <div style={{ fontWeight: 600 }}>{formatMin(w.current.totalDurationMin)}</div>
                                                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                                    ant: {formatMin(w.previous.totalDurationMin)}
                                                </div>
                                            </td>
                                            <td className="uk-text-right">
                                                <PunctualityCell
                                                    current={w.current.onTimePct}
                                                    previous={w.previous.onTimePct}
                                                    eligible={w.current.onTimeEligible}
                                                    count={w.current.onTimeCount}
                                                />
                                            </td>
                                            <td className="uk-text-right" style={{ fontWeight: 600 }}>
                                                {w.sharePct}%
                                            </td>
                                            {topStepLabels.map(l => (
                                                <td key={l} className="uk-text-right">
                                                    {w.current.byStepLabel?.[l] || 0}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                                {data.workers.length > 0 && (
                                    <tfoot style={{ background: '#f8fafc', fontWeight: 700 }}>
                                        <tr>
                                            <td>TOTAL EQUIPO</td>
                                            <td className="uk-text-right">
                                                <CompareCell
                                                    current={data.totals.current.stepsCompleted}
                                                    previous={data.totals.previous.stepsCompleted}
                                                    delta={data.totals.deltas.stepsCompletedPct}
                                                />
                                            </td>
                                            <td className="uk-text-right">
                                                <CompareCell
                                                    current={data.totals.current.ordersCount}
                                                    previous={data.totals.previous.ordersCount}
                                                    delta={data.totals.deltas.ordersCountPct}
                                                />
                                            </td>
                                            <td className="uk-text-right">
                                                <CompareCell
                                                    current={data.totals.current.ordersFinishedCount ?? 0}
                                                    previous={data.totals.previous.ordersFinishedCount ?? 0}
                                                    delta={data.totals.deltas.ordersFinishedPct}
                                                />
                                            </td>
                                            <td className="uk-text-right">
                                                <CompareCell
                                                    current={formatEUR(data.totals.current.ordersFinishedAmount ?? 0)}
                                                    previous={formatEUR(data.totals.previous.ordersFinishedAmount ?? 0)}
                                                    delta={data.totals.deltas.ordersFinishedAmountPct}
                                                />
                                            </td>
                                            <td className="uk-text-right">
                                                <CompareCell
                                                    current={data.totals.current.linesCount}
                                                    previous={data.totals.previous.linesCount}
                                                    delta={data.totals.deltas.linesCountPct}
                                                />
                                            </td>
                                            <td className="uk-text-right">–</td>
                                            <td className="uk-text-right">{formatMin(data.totals.current.totalDurationMin)}</td>
                                            <td className="uk-text-right">–</td>
                                            <td className="uk-text-right">100%</td>
                                            {topStepLabels.map(l => (
                                                <td key={l} className="uk-text-right">
                                                    {data.workers.reduce((s, w) => s + (w.current.byStepLabel?.[l] || 0), 0)}
                                                </td>
                                            ))}
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </div>

                    <div style={{ marginTop: 12, fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5 }}>
                        <strong>Cómo leer la tabla:</strong> "Procesos" cuenta cada paso del itinerario que la trabajadora cerró
                        (lavado, planchado, doblado…). "Finalizados" cuenta los pedidos que la trabajadora <em>cerró por completo</em>:
                        es decir, fue ella quien marcó el último paso pendiente, dejando el pedido listo. "Pedidos" cuenta cabeceras únicas: aunque cierre 8 pasos del mismo
                        pedido, suma 1. El "tiempo medio" se calcula sólo cuando el paso tiene <em>inicio</em> y <em>fin</em>
                        registrados (auto-progress o doble click). Las variaciones <Delta pct={12} /> / <Delta pct={-9} />
                        comparan con el período anterior de igual duración. La <strong>puntualidad</strong> es el % de
                        procesos cerrados antes de la <em>fecha límite</em> del pedido (sólo se cuentan procesos de pedidos
                        que tienen fecha límite asignada). Un <em>pp</em> = punto porcentual.
                    </div>
                </>
            )}
        </div>
    );
}

