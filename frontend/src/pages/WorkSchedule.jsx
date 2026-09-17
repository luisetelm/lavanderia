import React, { useEffect, useState, useCallback } from 'react';
import { confirmar } from '../utils/dialogo.js';
import { fetchWorkSchedule, updateWorkSchedule, addScheduleException, deleteScheduleException } from '../api.js';
import UIkit from 'uikit';
import PageToolbar from '../components/PageToolbar.jsx';

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const fmtCarga = (n) => (n == null ? '—' : Number(n).toLocaleString('es-ES', { maximumFractionDigits: 1 }));

export default function WorkSchedule({ token }) {
    const [weekly, setWeekly] = useState([]);
    const [exceptions, setExceptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // Tope de carga diaria (camisas equivalentes) y percentiles del último año
    const [loadMax, setLoadMax] = useState('');
    const [loadStats, setLoadStats] = useState(null);
    // Suplemento por entregar antes de la fecha sugerida: % por día laborable adelantado y tope (0 por día = sin recargo)
    const [urgencyPctPerDay, setUrgencyPctPerDay] = useState('');
    const [urgencyMaxPct, setUrgencyMaxPct] = useState('');

    // Nuevo festivo
    const [newException, setNewException] = useState({ date: '', label: '', isWorking: false, capacityMin: 0 });

    const load = useCallback(async () => {
        try {
            const result = await fetchWorkSchedule(token);
            setWeekly(result.weekly || []);
            setExceptions(result.exceptions || []);
            setLoadMax(result.loadMax ?? '');
            setLoadStats(result.loadStats || null);
            setUrgencyPctPerDay(result.urgencyPctPerDay ?? '');
            setUrgencyMaxPct(result.urgencyMaxPct ?? '');
        } catch (err) {
            console.error('Error cargando calendario:', err);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { load(); }, [load]);

    const handleSaveWeekly = async () => {
        setSaving(true);
        try {
            const porDia = parseFloat(urgencyPctPerDay);
            const tope = parseFloat(urgencyMaxPct);
            const result = await updateWorkSchedule(token, weekly, {
                loadMax: parseFloat(loadMax) || undefined,
                urgencyPctPerDay: Number.isFinite(porDia) ? porDia : undefined,
                urgencyMaxPct: Number.isFinite(tope) ? tope : undefined,
            });
            setWeekly(result);
            UIkit.notification({ message: 'Horario guardado', status: 'success', pos: 'top-right', timeout: 2000 });
        } catch (e) {
            UIkit.notification({ message: 'Error guardando horario', status: 'danger', pos: 'top-right', timeout: 2000 });
        } finally {
            setSaving(false);
        }
    };

    const handleAddException = async () => {
        if (!newException.date) return;
        try {
            const result = await addScheduleException(token, newException);
            setExceptions(prev => [...prev, result].sort((a, b) => new Date(a.date) - new Date(b.date)));
            setNewException({ date: '', label: '', isWorking: false, capacityMin: 0 });
            UIkit.notification({ message: 'Excepción añadida', status: 'success', pos: 'top-right', timeout: 2000 });
        } catch (e) {
            UIkit.notification({ message: 'Error añadiendo excepción', status: 'danger', pos: 'top-right', timeout: 2000 });
        }
    };

    const handleDeleteException = async (id) => {
        if (!await confirmar('¿Eliminar esta excepción?', {peligroso: true, textoConfirmar: 'Eliminar'})) return;
        try {
            await deleteScheduleException(token, id);
            setExceptions(prev => prev.filter(e => e.id !== id));
        } catch (e) {
            UIkit.notification({ message: 'Error eliminando', status: 'danger', pos: 'top-right', timeout: 2000 });
        }
    };

    const updateDay = (dayOfWeek, field, value) => {
        setWeekly(prev => prev.map(d =>
            d.dayOfWeek === dayOfWeek ? { ...d, [field]: value } : d
        ));
    };

    if (loading) {
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <div uk-spinner="ratio: 1"></div>
                <p style={{ color: '#64748b' }}>Cargando calendario...</p>
            </div>
        );
    }

    return (
        <div>
            <PageToolbar title="Horario laboral" filters={[]} />

            {/* Horario semanal */}
            <div className="uk-card uk-card-default uk-card-body uk-margin-bottom">
                <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12 }}>Horario semanal</h4>

                <div className="uk-overflow-auto">
                    <table className="uk-table uk-table-small uk-table-divider uk-table-hover">
                        <thead>
                            <tr>
                                <th>Día</th>
                                <th style={{ width: 60 }}>Activo</th>
                                <th>Entrada</th>
                                <th>Salida</th>
                                <th>Min. efectivos</th>
                            </tr>
                        </thead>
                        <tbody>
                            {weekly.map(day => (
                                <tr key={day.dayOfWeek} style={{ opacity: day.isWorking ? 1 : 0.5 }}>
                                    <td style={{ fontWeight: 600 }}>{DAY_NAMES[day.dayOfWeek]}</td>
                                    <td>
                                        <input
                                            type="checkbox"
                                            className="uk-checkbox"
                                            checked={day.isWorking}
                                            onChange={e => updateDay(day.dayOfWeek, 'isWorking', e.target.checked)}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="time"
                                            className="uk-input uk-form-small"
                                            style={{ width: 110 }}
                                            value={day.startTime || ''}
                                            onChange={e => updateDay(day.dayOfWeek, 'startTime', e.target.value)}
                                            disabled={!day.isWorking}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="time"
                                            className="uk-input uk-form-small"
                                            style={{ width: 110 }}
                                            value={day.endTime || ''}
                                            onChange={e => updateDay(day.dayOfWeek, 'endTime', e.target.value)}
                                            disabled={!day.isWorking}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="number"
                                            className="uk-input uk-form-small"
                                            style={{ width: 80 }}
                                            value={day.capacityMin || 0}
                                            onChange={e => updateDay(day.dayOfWeek, 'capacityMin', parseInt(e.target.value) || 0)}
                                            disabled={!day.isWorking}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Tope de carga diaria: a partir de aquí el calendario del TPV da el día por lleno */}
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                    <label className="uk-form-label" style={{ fontWeight: 600 }}>Carga máxima por día</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                        <input
                            type="number"
                            className="uk-input uk-form-small"
                            style={{ width: 90 }}
                            min="1"
                            step="1"
                            value={loadMax}
                            onChange={e => setLoadMax(e.target.value)}
                        />
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>camisas equivalentes (camisa = 1, traje = 2,5, servilleta = 0,05)</span>
                    </div>
                    {loadStats && loadStats.dias > 0 && (
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 6 }}>
                            Últimos {loadStats.meses} meses ({loadStats.dias} días laborables, con los pesos actuales de los productos):
                            día típico <strong>{fmtCarga(loadStats.p50)}</strong> · el 90 % de los días por debajo de <strong>{fmtCarga(loadStats.p90)}</strong> ·
                            el 95 % por debajo de <strong>{fmtCarga(loadStats.p95)}</strong> · máximo <strong>{fmtCarga(loadStats.max)}</strong>.
                            {loadStats.p90 != null && (
                                <> Un tope cerca de {fmtCarga(loadStats.p90)} marca como lleno un día de cada diez.</>
                            )}
                        </div>
                    )}
                </div>

                {/* Suplemento por adelantar la entrega respecto a la fecha sugerida */}
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                    <label className="uk-form-label" style={{ fontWeight: 600 }}>Suplemento por entrega adelantada</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 4 }}>
                        <input
                            type="number"
                            className="uk-input uk-form-small"
                            style={{ width: 80 }}
                            min="0"
                            max="500"
                            step="1"
                            value={urgencyPctPerDay}
                            onChange={e => setUrgencyPctPerDay(e.target.value)}
                        />
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>% por cada día laborable que se adelanta la entrega respecto a la sugerida (0 = sin recargo), hasta un tope de</span>
                        <input
                            type="number"
                            className="uk-input uk-form-small"
                            style={{ width: 80 }}
                            min="0"
                            max="500"
                            step="1"
                            value={urgencyMaxPct}
                            onChange={e => setUrgencyMaxPct(e.target.value)}
                        />
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>%</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 6 }}>
                        {(() => {
                            const d = parseFloat(urgencyPctPerDay) || 0;
                            const m = parseFloat(urgencyMaxPct) || 0;
                            const pct = (n) => (m > 0 ? Math.min(d * n, m) : d * n);
                            return d > 0
                                ? <>Ejemplo: 1 día = {pct(1)} %, 2 días = {pct(2)} %, 3 días = {pct(3)} %, 5 días = {pct(5)} %. </>
                                : <>Recargo desactivado. </>;
                        })()}
                        Se aplica sobre las prendas del pedido y se añade como la línea «Suplemento urgencia», así sale en el ticket y en la factura.
                        No se aplica a los servicios externos (peletero, alfombras) ni a los grandes clientes (tienen días de recogida y entrega pactados), y administración puede eximirlo en el TPV.
                    </div>
                </div>

                <button
                    className="uk-button uk-button-primary uk-button-small uk-margin-top"
                    onClick={handleSaveWeekly}
                    disabled={saving}
                >
                    {saving ? 'Guardando...' : 'Guardar horario'}
                </button>
            </div>

            {/* Excepciones / Festivos */}
            <div className="uk-card uk-card-default uk-card-body">
                <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12 }}>Festivos y excepciones</h4>

                {/* Formulario para añadir */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                    <div>
                        <label className="uk-form-label" style={{ fontSize: '0.75rem' }}>Fecha</label>
                        <input
                            type="date"
                            className="uk-input uk-form-small"
                            value={newException.date}
                            onChange={e => setNewException(prev => ({ ...prev, date: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label className="uk-form-label" style={{ fontSize: '0.75rem' }}>Descripción</label>
                        <input
                            type="text"
                            className="uk-input uk-form-small"
                            placeholder="Ej: Festivo local"
                            value={newException.label}
                            onChange={e => setNewException(prev => ({ ...prev, label: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label className="uk-form-label" style={{ fontSize: '0.75rem' }}>
                            <input
                                type="checkbox"
                                className="uk-checkbox"
                                checked={newException.isWorking}
                                onChange={e => setNewException(prev => ({ ...prev, isWorking: e.target.checked }))}
                            />{' '}
                            Se trabaja
                        </label>
                    </div>
                    <button
                        className="uk-button uk-button-primary uk-button-small"
                        onClick={handleAddException}
                        disabled={!newException.date}
                    >
                        Añadir
                    </button>
                </div>

                {/* Lista de excepciones */}
                {exceptions.length === 0 ? (
                    <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No hay excepciones próximas</p>
                ) : (
                    <table className="uk-table uk-table-small uk-table-divider">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Descripción</th>
                                <th>Trabaja</th>
                                <th>Min.</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {exceptions.map(exc => (
                                <tr key={exc.id}>
                                    <td>{new Date(exc.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                                    <td>{exc.label || '—'}</td>
                                    <td>{exc.isWorking ? 'Sí' : 'No'}</td>
                                    <td>{exc.capacityMin || 0}</td>
                                    <td>
                                        <button
                                            className="uk-button uk-button-danger uk-button-small"
                                            style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                                            onClick={() => handleDeleteException(exc.id)}
                                        >
                                            <span uk-icon="icon: trash; ratio: 0.7"></span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

