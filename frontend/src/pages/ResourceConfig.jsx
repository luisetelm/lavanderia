import React, { useEffect, useState, useCallback } from 'react';
import { fetchTrackingResources, createTrackingResource, updateTrackingResource, deleteTrackingResource } from '../api.js';
import PageToolbar from '../components/PageToolbar.jsx';
import UIkit from 'uikit';

const PROCESSING_MODES = [
    { value: 'batch', label: 'Lote (varias prendas a la vez)' },
    { value: 'individual', label: 'Individual (prenda a prenda)' },
];

const CAPACITY_UNITS = [
    { value: 'items', label: 'Prendas' },
    { value: 'kg', label: 'Kilogramos (kg)' },
];

export default function ResourceConfig({ token }) {
    const [resources, setResources] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [showNew, setShowNew] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchTrackingResources(token);
            setResources(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error cargando recursos:', err);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { load(); }, [load]);

    const startEdit = (r) => {
        setEditingId(r.id);
        setForm({
            label: r.label,
            units: r.units,
            processingMode: r.processingMode,
            batchCapacity: r.batchCapacity,
            cycleDurationMin: r.cycleDurationMin,
            capacityUnit: r.capacityUnit || 'items',
        });
        setShowNew(false);
    };

    const startNew = () => {
        setEditingId(null);
        setForm({
            resourceKey: '',
            label: '',
            units: 1,
            processingMode: 'individual',
            batchCapacity: 1,
            cycleDurationMin: 15,
            capacityUnit: 'items',
        });
        setShowNew(true);
    };

    const cancel = () => {
        setEditingId(null);
        setShowNew(false);
        setForm({});
    };

    const save = async () => {
        setSaving(true);
        try {
            if (showNew) {
                if (!form.resourceKey || !form.label) {
                    UIkit.notification({ message: 'Clave y nombre son obligatorios', status: 'warning', pos: 'top-right', timeout: 2000 });
                    setSaving(false);
                    return;
                }
                await createTrackingResource(token, form);
                UIkit.notification({ message: 'Recurso creado', status: 'success', pos: 'top-right', timeout: 2000 });
            } else {
                await updateTrackingResource(token, editingId, form);
                UIkit.notification({ message: 'Recurso actualizado', status: 'success', pos: 'top-right', timeout: 2000 });
            }
            cancel();
            await load();
        } catch (err) {
            UIkit.notification({ message: err?.error || 'Error al guardar', status: 'danger', pos: 'top-right', timeout: 3000 });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id, label) => {
        try {
            await UIkit.modal.confirm(`¿Eliminar el recurso "${label}"? Los itinerarios que lo usen quedarán sin recurso asignado.`);
            await deleteTrackingResource(token, id);
            UIkit.notification({ message: 'Recurso eliminado', status: 'success', pos: 'top-right', timeout: 2000 });
            await load();
        } catch { /* cancelled */ }
    };

    const formatDuration = (min) => {
        if (!min) return '—';
        if (min < 60) return `${min} min`;
        const h = Math.floor(min / 60);
        const m = min % 60;
        return m > 0 ? `${h}h ${m}min` : `${h}h`;
    };

    return (
        <div>
            <PageToolbar
                title="Recursos y máquinas"
                actions={
                    <button className="uk-button uk-button-primary" onClick={startNew}>
                        <span uk-icon="plus"></span> Nuevo recurso
                    </button>
                }
            />

            <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '-8px 0 16px' }}>
                Configura las máquinas, personal y recursos disponibles para el tracking de pedidos.
                El sistema usa estos datos para estimar tiempos de producción.
            </p>

            {loading ? (
                <div className="uk-text-center uk-padding">
                    <div uk-spinner="ratio: 1"></div>
                </div>
            ) : (
                <div className="uk-overflow-auto">
                    <table className="uk-table uk-table-hover uk-table-middle uk-table-divider uk-table-small">
                        <thead>
                            <tr>
                                <th>Nombre</th>
                                <th>Clave</th>
                                <th style={{ textAlign: 'center' }}>Unidades</th>
                                <th>Modo</th>
                                <th style={{ textAlign: 'center' }}>Capacidad</th>
                                <th>Unid. medida</th>
                                <th style={{ textAlign: 'center' }}>Tiempo/ciclo</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* Fila de nuevo recurso */}
                            {showNew && (
                                <tr style={{ background: '#f0fdf4' }}>
                                    <td>
                                        <input className="uk-input uk-form-small" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Lavadora XL" style={{ minWidth: 120 }} />
                                    </td>
                                    <td>
                                        <input className="uk-input uk-form-small" value={form.resourceKey} onChange={e => setForm(f => ({ ...f, resourceKey: e.target.value.replace(/\s/g, '_').toLowerCase() }))} placeholder="washer_xl" style={{ minWidth: 90 }} />
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        <input className="uk-input uk-form-small" type="number" min="1" value={form.units} onChange={e => setForm(f => ({ ...f, units: Number(e.target.value) }))} style={{ width: 55, textAlign: 'center' }} />
                                    </td>
                                    <td>
                                        <select className="uk-select uk-form-small" value={form.processingMode} onChange={e => setForm(f => ({ ...f, processingMode: e.target.value }))}>
                                            {PROCESSING_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                        </select>
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        <input className="uk-input uk-form-small" type="number" min="1" value={form.batchCapacity} onChange={e => setForm(f => ({ ...f, batchCapacity: Number(e.target.value) }))} style={{ width: 55, textAlign: 'center' }} disabled={form.processingMode !== 'batch'} />
                                    </td>
                                    <td>
                                        <select className="uk-select uk-form-small" value={form.capacityUnit} onChange={e => setForm(f => ({ ...f, capacityUnit: e.target.value }))} disabled={form.processingMode !== 'batch'}>
                                            {CAPACITY_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                                        </select>
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        <input className="uk-input uk-form-small" type="number" min="0" value={form.cycleDurationMin} onChange={e => setForm(f => ({ ...f, cycleDurationMin: Number(e.target.value) }))} style={{ width: 55, textAlign: 'center' }} />
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <button className="uk-button uk-button-primary uk-button-small" onClick={save} disabled={saving} style={{ padding: '2px 8px' }}>
                                                {saving ? <span uk-spinner="ratio: 0.4"></span> : <span uk-icon="icon: check; ratio: 0.75"></span>}
                                            </button>
                                            <button className="uk-button uk-button-default uk-button-small" onClick={cancel} style={{ padding: '2px 8px' }}>
                                                <span uk-icon="icon: close; ratio: 0.75"></span>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )}

                            {resources.map(r => (
                                <tr key={r.id} style={editingId === r.id ? { background: '#eff6ff' } : {}}>
                                    <td>
                                        {editingId === r.id ? (
                                            <input className="uk-input uk-form-small" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} style={{ minWidth: 120 }} />
                                        ) : (
                                            <strong>{r.label}</strong>
                                        )}
                                    </td>
                                    <td>
                                        <code style={{ fontSize: '0.75rem', color: '#64748b' }}>{r.resourceKey}</code>
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        {editingId === r.id ? (
                                            <input className="uk-input uk-form-small" type="number" min="1" value={form.units} onChange={e => setForm(f => ({ ...f, units: Number(e.target.value) }))} style={{ width: 55, textAlign: 'center' }} />
                                        ) : (
                                            <span className="uk-badge" style={{ background: '#3b82f6' }}>{r.units}</span>
                                        )}
                                    </td>
                                    <td>
                                        {editingId === r.id ? (
                                            <select className="uk-select uk-form-small" value={form.processingMode} onChange={e => setForm(f => ({ ...f, processingMode: e.target.value }))}>
                                                {PROCESSING_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                            </select>
                                        ) : (
                                            <span className={`uk-label ${r.processingMode === 'batch' ? 'uk-label-success' : 'uk-label-warning'}`} style={{ fontSize: '0.65rem' }}>
                                                {r.processingMode === 'batch' ? 'Lote' : 'Individual'}
                                            </span>
                                        )}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        {editingId === r.id ? (
                                            <input className="uk-input uk-form-small" type="number" min="1" value={form.batchCapacity} onChange={e => setForm(f => ({ ...f, batchCapacity: Number(e.target.value) }))} style={{ width: 55, textAlign: 'center' }} disabled={form.processingMode !== 'batch'} />
                                        ) : (
                                            r.processingMode === 'batch' ? (
                                                <span>{r.batchCapacity} {(r.capacityUnit || 'items') === 'kg' ? 'kg' : 'uds'}</span>
                                            ) : '—'
                                        )}
                                    </td>
                                    <td>
                                        {editingId === r.id ? (
                                            <select className="uk-select uk-form-small" value={form.capacityUnit} onChange={e => setForm(f => ({ ...f, capacityUnit: e.target.value }))} disabled={form.processingMode !== 'batch'}>
                                                {CAPACITY_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                                            </select>
                                        ) : (
                                            r.processingMode === 'batch' ? (
                                                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{(r.capacityUnit || 'items') === 'kg' ? 'Kilogramos' : 'Prendas'}</span>
                                            ) : (
                                                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>—</span>
                                            )
                                        )}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        {editingId === r.id ? (
                                            <input className="uk-input uk-form-small" type="number" min="0" value={form.cycleDurationMin} onChange={e => setForm(f => ({ ...f, cycleDurationMin: Number(e.target.value) }))} style={{ width: 55, textAlign: 'center' }} />
                                        ) : (
                                            <span>{formatDuration(r.cycleDurationMin)}</span>
                                        )}
                                    </td>
                                    <td>
                                        {editingId === r.id ? (
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                <button className="uk-button uk-button-primary uk-button-small" onClick={save} disabled={saving} style={{ padding: '2px 8px' }}>
                                                    {saving ? <span uk-spinner="ratio: 0.4"></span> : <span uk-icon="icon: check; ratio: 0.75"></span>}
                                                </button>
                                                <button className="uk-button uk-button-default uk-button-small" onClick={cancel} style={{ padding: '2px 8px' }}>
                                                    <span uk-icon="icon: close; ratio: 0.75"></span>
                                                </button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                <button className="uk-button uk-button-default uk-button-small" onClick={() => startEdit(r)} style={{ padding: '2px 8px' }} title="Editar">
                                                    <span uk-icon="icon: pencil; ratio: 0.75"></span>
                                                </button>
                                                <button className="uk-button uk-button-danger uk-button-small" onClick={() => handleDelete(r.id, r.label)} style={{ padding: '2px 8px' }} title="Eliminar">
                                                    <span uk-icon="icon: trash; ratio: 0.75"></span>
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {resources.length === 0 && !showNew && (
                        <div className="uk-text-center uk-margin uk-text-muted">
                            No hay recursos configurados.
                        </div>
                    )}
                </div>
            )}

            {/* Leyenda explicativa */}
            <div className="uk-card uk-card-default uk-card-body uk-margin-top" style={{ fontSize: '0.78rem', color: '#475569' }}>
                <h5 style={{ fontSize: '0.85rem', margin: '0 0 8px' }}>ℹ️ Cómo funciona</h5>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li><strong>Modo Lote</strong> (ej. lavadora): varias prendas en un mismo ciclo. El tiempo se calcula como <code>⌈carga/capacidad⌉ × tiempo/ciclo ÷ unidades</code></li>
                    <li><strong>Modo Individual</strong> (ej. planchado): prenda a prenda. Tiempo = <code>cantidad × tiempo/prenda ÷ unidades (personas)</code></li>
                    <li><strong>Unid. medida</strong>: para lotes, indica si la capacidad se mide en <em>prendas</em> o <em>kg</em>. Si es kg, se usa el peso del producto × cantidad.</li>
                    <li><strong>Unidades</strong>: cuántas máquinas o personas hay disponibles (divide el tiempo total).</li>
                </ul>
            </div>
        </div>
    );
}

