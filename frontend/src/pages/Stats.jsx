// frontend/src/pages/Stats.jsx
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import PageToolbar from '../components/PageToolbar.jsx';
import DateRangeSelector from '../components/DateRangeSelector.jsx';
import { fetchTopProducts } from '../api.js';
import { formatEUR } from '../utils/format.js';

// Paleta cíclica para barras
const PALETTE = [
    '#2563eb', '#16a34a', '#ea580c', '#9333ea', '#dc2626',
    '#0891b2', '#ca8a04', '#db2777', '#0d9488', '#7c3aed',
];

function MonthChart({ bucket, maxQty, metric }) {
    const items = bucket.items || [];
    return (
        <div className="uk-card uk-card-default uk-card-body" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <h4 style={{ margin: 0, textTransform: 'capitalize' }}>{bucket.label}</h4>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    {bucket.totalQty} uds · {formatEUR(bucket.totalRevenue)}
                </div>
            </div>
            {items.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Sin datos</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {items.map((it, idx) => {
                        const value = metric === 'revenue' ? it.revenue : it.qty;
                        const maxVal = metric === 'revenue'
                            ? Math.max(...items.map(i => i.revenue), 1)
                            : maxQty;
                        const pct = maxVal > 0 ? (value / maxVal) * 100 : 0;
                        return (
                            <div key={it.productId} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{
                                        fontSize: '0.8rem',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        marginBottom: 2,
                                    }} title={it.productName}>
                                        {it.productName}
                                    </div>
                                    <div style={{
                                        position: 'relative',
                                        height: 14,
                                        background: '#f1f5f9',
                                        borderRadius: 4,
                                        overflow: 'hidden',
                                    }}>
                                        <div style={{
                                            width: `${pct}%`,
                                            height: '100%',
                                            background: PALETTE[idx % PALETTE.length],
                                            transition: 'width 0.4s ease',
                                        }} />
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.8rem', fontWeight: 600, minWidth: 70, textAlign: 'right' }}>
                                    {metric === 'revenue' ? formatEUR(it.revenue) : `${it.qty} uds`}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function Stats({ token }) {
    // Por defecto: últimos 6 meses
    const today = new Date();
    const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().slice(0, 10);
    const defaultTo = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

    const [from, setFrom] = useState(() => localStorage.getItem('stats_from') || defaultFrom);
    const [to, setTo] = useState(() => localStorage.getItem('stats_to') || defaultTo);
    const [limit, setLimit] = useState(() => Number(localStorage.getItem('stats_limit')) || 10);
    const [metric, setMetric] = useState(() => localStorage.getItem('stats_metric') || 'qty'); // qty | revenue
    const [groupBy, setGroupBy] = useState(() => localStorage.getItem('stats_groupBy') || 'month'); // month | range

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchTopProducts(token, { from, to, limit, groupBy });
            setData(res);
        } catch (err) {
            console.error('Error cargando top productos', err);
            setError(err.error || 'Error cargando estadísticas');
        } finally {
            setLoading(false);
        }
    }, [token, from, to, limit, groupBy]);

    useEffect(() => { load(); }, [load]);

    // KPIs globales del rango
    const totals = useMemo(() => {
        if (!data?.months) return { qty: 0, revenue: 0, products: 0 };
        const productSet = new Set();
        let qty = 0, revenue = 0;
        data.months.forEach(m => {
            m.items.forEach(it => {
                productSet.add(it.productId);
                qty += it.qty;
                revenue += it.revenue;
            });
        });
        return { qty, revenue: Number(revenue.toFixed(2)), products: productSet.size };
    }, [data]);

    // Máx qty global para escalar barras de forma comparable entre meses
    const globalMaxQty = useMemo(() => {
        if (!data?.months) return 0;
        return data.months.reduce((max, b) => {
            const localMax = b.items.reduce((m, it) => Math.max(m, it.qty), 0);
            return Math.max(max, localMax);
        }, 0);
    }, [data]);

    const persist = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (_) { /* noop */ } };

    const toolbarFilters = [
        {
            label: 'Métrica',
            active: true,
            options: [
                { label: 'Unidades', active: metric === 'qty', onClick: () => { setMetric('qty'); persist('stats_metric', 'qty'); } },
                { label: 'Ingresos', active: metric === 'revenue', onClick: () => { setMetric('revenue'); persist('stats_metric', 'revenue'); } },
            ]
        },
        {
            label: 'Agrupar',
            active: true,
            options: [
                { label: 'Por mes', active: groupBy === 'month', onClick: () => { setGroupBy('month'); persist('stats_groupBy', 'month'); } },
                { label: 'Rango total', active: groupBy === 'range', onClick: () => { setGroupBy('range'); persist('stats_groupBy', 'range'); } },
            ]
        },
        {
            label: 'Top',
            active: true,
            options: [5, 10, 15, 20].map(n => ({
                label: `${n}`, active: limit === n, onClick: () => { setLimit(n); persist('stats_limit', n); }
            }))
        },
    ];

    return (
        <div>
            <PageToolbar title="Estadísticas · Productos más pedidos" filters={toolbarFilters} />

            <div className="uk-card uk-card-default uk-card-body" style={{ marginBottom: 16 }}>
                <DateRangeSelector
                    from={from}
                    to={to}
                    onChange={({ from: f, to: t }) => {
                        setFrom(f); setTo(t);
                        persist('stats_from', f); persist('stats_to', t);
                    }}
                />
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
                {[
                    { label: 'Meses', value: data?.months?.length ?? 0 },
                    { label: 'Productos distintos (top)', value: totals.products },
                    { label: 'Unidades (top)', value: totals.qty },
                    { label: 'Ingresos (top)', value: formatEUR(totals.revenue) },
                ].map((k, i) => (
                    <div key={i} className="uk-card uk-card-default uk-card-body uk-text-center" style={{ padding: '14px 10px' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{k.label}</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 2 }}>{k.value}</div>
                    </div>
                ))}
            </div>

            {error && (
                <div className="uk-alert-danger" data-uk-alert>
                    <p>{error}</p>
                </div>
            )}

            {loading ? (
                <div className="uk-text-center uk-margin">
                    <span className="uk-badge uk-badge-warning">Cargando estadísticas...</span>
                </div>
            ) : !data?.months?.length ? (
                <div className="uk-text-center uk-margin">
                    <span className="uk-badge uk-badge-muted">No hay datos en el rango seleccionado.</span>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gap: 16,
                    gridTemplateColumns: groupBy === 'range' ? '1fr' : 'repeat(auto-fit, minmax(320px, 1fr))',
                }}>
                    {data.months.map(b => (
                        <MonthChart key={b.month} bucket={b} maxQty={globalMaxQty} metric={metric} />
                    ))}
                </div>
            )}
        </div>
    );
}


