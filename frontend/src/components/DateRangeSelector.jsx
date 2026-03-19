import React from 'react';
import { getDateRange, formatDate, MONTH_NAMES, DATE_PRESETS } from '../utils/dates.js';

export default function DateRangeSelector({ from, to, onChange }) {
    const setRange = (start, end) => {
        onChange({ from: start, to: end });
    };

    const hoy = new Date();

    return (
        <div>
            {/* Presets rápidos */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {DATE_PRESETS.map(p => {
                    const [start, end] = getDateRange(p.key);
                    const isActive = from === start && to === end;
                    return (
                        <button
                            key={p.key}
                            className={`page-toolbar-chip ${isActive ? 'active' : ''}`}
                            onClick={() => setRange(start, end)}
                            type="button"
                        >
                            {p.label}
                        </button>
                    );
                })}
            </div>

            {/* Meses individuales (últimos 12) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
                {Array.from({ length: 12 }).map((_, i) => {
                    const d = new Date(hoy.getFullYear(), hoy.getMonth() - (11 - i), 1);
                    const start = formatDate(d);
                    const end = formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
                    const isActive = from === start && to === end;
                    return (
                        <button
                            key={start}
                            className={`page-toolbar-chip ${isActive ? 'active' : ''}`}
                            style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                            onClick={() => setRange(start, end)}
                            type="button"
                        >
                            {MONTH_NAMES[d.getMonth()]}{d.getFullYear() !== hoy.getFullYear() ? ` ${d.getFullYear()}` : ''}
                        </button>
                    );
                })}
            </div>

            {/* Inputs manuales */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <div>
                    <label className="uk-form-label">Desde</label>
                    <input
                        className="uk-input" type="date" value={from}
                        onChange={e => setRange(e.target.value, to)}
                        style={{ width: 150 }}
                    />
                </div>
                <div>
                    <label className="uk-form-label">Hasta</label>
                    <input
                        className="uk-input" type="date" value={to}
                        onChange={e => setRange(from, e.target.value)}
                        style={{ width: 150 }}
                    />
                </div>
            </div>
        </div>
    );
}
