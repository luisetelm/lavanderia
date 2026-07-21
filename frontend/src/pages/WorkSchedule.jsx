import React, { useEffect, useState, useCallback } from 'react';
import { confirmar } from '../utils/dialogo.js';
import { fetchWorkSchedule, updateWorkSchedule, addScheduleException, deleteScheduleException } from '../api.js';
import UIkit from 'uikit';
import PageToolbar from '../components/PageToolbar.jsx';

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function WorkSchedule({ token }) {
    const [weekly, setWeekly] = useState([]);
    const [exceptions, setExceptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Nuevo festivo
    const [newException, setNewException] = useState({ date: '', label: '', isWorking: false, capacityMin: 0 });

    const load = useCallback(async () => {
        try {
            const result = await fetchWorkSchedule(token);
            setWeekly(result.weekly || []);
            setExceptions(result.exceptions || []);
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
            const result = await updateWorkSchedule(token, weekly);
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

