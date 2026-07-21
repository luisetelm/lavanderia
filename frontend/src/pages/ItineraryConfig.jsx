import React, { useEffect, useState, useCallback } from 'react';
import { confirmar } from '../utils/dialogo.js';
import { fetchItineraries, createItinerary, updateItinerary, deleteItinerary, fetchItineraryResources } from '../api.js';
import PageToolbar from '../components/PageToolbar.jsx';
import UIkit from 'uikit';

// Pasos predefinidos comunes para seleccionar rápidamente
const STEP_PRESETS = [
    { stepKey: 'recepcion', stepLabel: 'Recepción', durationMin: 3, resourceKey: 'manual', autoProgress: false, displayOrder: 10 },
    { stepKey: 'lavado', stepLabel: 'Lavado', durationMin: 70, resourceKey: 'washer_wet', autoProgress: true, displayOrder: 20 },
    { stepKey: 'secado', stepLabel: 'Secado', durationMin: 45, resourceKey: 'washer_wet', autoProgress: true, displayOrder: 30 },
    { stepKey: 'limpieza_seco', stepLabel: 'Limpieza en seco', durationMin: 45, resourceKey: 'washer_dry', autoProgress: true, displayOrder: 25 },
    { stepKey: 'pretratamiento', stepLabel: 'Pre-tratamiento', durationMin: 10, resourceKey: 'manual', autoProgress: false, displayOrder: 15 },
    { stepKey: 'planchado', stepLabel: 'Planchado', durationMin: 15, resourceKey: 'ironing_manual', autoProgress: false, displayOrder: 50 },
    { stepKey: 'doblado', stepLabel: 'Doblado / Embolsado', durationMin: 10, resourceKey: 'manual', autoProgress: false, displayOrder: 60 },
    { stepKey: 'embolsado', stepLabel: 'Embolsado', durationMin: 3, resourceKey: 'manual', autoProgress: false, displayOrder: 70 },
    { stepKey: 'desmontar', stepLabel: 'Desmontar / Desarmar', durationMin: 20, resourceKey: 'sewing', autoProgress: false, displayOrder: 35 },
    { stepKey: 'costura', stepLabel: 'Costura / Montar', durationMin: 30, resourceKey: 'sewing', autoProgress: false, displayOrder: 40 },
    { stepKey: 'envio_externo', stepLabel: 'Envío externo', durationMin: 0, resourceKey: null, autoProgress: false, displayOrder: 80 },
    { stepKey: 'recepcion_externo', stepLabel: 'Recepción externo', durationMin: 0, resourceKey: null, autoProgress: false, displayOrder: 85 },
];

export default function ItineraryConfig({ token }) {
    const [itineraries, setItineraries] = useState([]);
    const [resources, setResources] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null); // null = cerrado, {} = nuevo, {id, ...} = editar
    const [expandedId, setExpandedId] = useState(null);

    const load = useCallback(async () => {
        try {
            const [itin, res] = await Promise.all([
                fetchItineraries(token),
                fetchItineraryResources(token),
            ]);
            setItineraries(itin);
            setResources(res);
        } catch (err) {
            console.error('Error cargando itinerarios:', err);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { load(); }, [load]);

    const handleDelete = async (id, name) => {
        if (!await confirmar(`¿Eliminar el itinerario "${name}"?`, {peligroso: true, textoConfirmar: 'Eliminar'})) return;
        try {
            await deleteItinerary(token, id);
            UIkit.notification({ message: 'Itinerario eliminado', status: 'success', pos: 'top-right', timeout: 2000 });
            load();
        } catch (e) {
            UIkit.notification({ message: e?.error || 'Error al eliminar', status: 'danger', pos: 'top-right', timeout: 3000 });
        }
    };

    const resourceLabel = (key) => {
        if (!key) return '—';
        const r = resources.find(r => r.resourceKey === key);
        return r ? r.label : key;
    };

    if (loading) {
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <div uk-spinner="ratio: 1"></div>
                <p style={{ color: '#64748b' }}>Cargando itinerarios...</p>
            </div>
        );
    }

    return (
        <div>
            <PageToolbar
                title="Itinerarios de servicio"
                actions={
                    <button className="uk-button uk-button-primary uk-button-small" onClick={() => setEditing({})}>
                        <span uk-icon="plus"></span> Nuevo itinerario
                    </button>
                }
            />

            <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 16 }}>
                Cada itinerario define los pasos que sigue una prenda desde que entra hasta que está lista.
                Asigna un itinerario a cada producto en Inventario.
            </p>

            {itineraries.length === 0 ? (
                <div className="uk-alert uk-alert-warning">
                    No hay itinerarios configurados. Crea uno para empezar.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {itineraries.map(itin => {
                        const expanded = expandedId === itin.id;
                        return (
                            <div key={itin.id} className="uk-card uk-card-default" style={{ overflow: 'hidden' }}>
                                <div
                                    style={{
                                        padding: '14px 18px',
                                        display: 'flex', alignItems: 'center', gap: 12,
                                        cursor: 'pointer', background: expanded ? '#f0f9ff' : '#fff',
                                    }}
                                    onClick={() => setExpandedId(expanded ? null : itin.id)}
                                >
                                    <span uk-icon={expanded ? 'chevron-down' : 'chevron-right'} style={{ flexShrink: 0 }}></span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <strong style={{ fontSize: '0.92rem' }}>{itin.name}</strong>
                                        {itin.description && (
                                            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>{itin.description}</div>
                                        )}
                                    </div>
                                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                        {itin.steps?.length || 0} pasos · {itin._count?.products || 0} productos
                                    </span>
                                    <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                                        <button className="uk-button uk-button-default uk-button-small" style={{ fontSize: '0.72rem', padding: '2px 10px' }}
                                            onClick={() => setEditing(itin)}>
                                            Editar
                                        </button>
                                        <button className="uk-button uk-button-danger uk-button-small" style={{ fontSize: '0.72rem', padding: '2px 10px' }}
                                            onClick={() => handleDelete(itin.id, itin.name)}>
                                            Eliminar
                                        </button>
                                    </div>
                                </div>

                                {expanded && itin.steps && (
                                    <div style={{ padding: '0 18px 14px', borderTop: '1px solid #e5e7eb' }}>
                                        <table className="uk-table uk-table-small uk-table-divider" style={{ fontSize: '0.8rem', marginTop: 8 }}>
                                            <thead>
                                                <tr>
                                                    <th style={{ width: 40 }}>#</th>
                                                    <th>Paso</th>
                                                    <th>Recurso</th>
                                                    <th style={{ width: 80 }}>Duración</th>
                                                    <th style={{ width: 60 }}>Orden</th>
                                                    <th style={{ width: 100 }}>Seguimiento</th>
                                                    <th style={{ width: 80 }}>Opcional</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {itin.steps.map(step => (
                                                    <tr key={step.id}>
                                                        <td style={{ color: '#94a3b8' }}>{step.position}</td>
                                                        <td>
                                                            <strong>{step.stepLabel}</strong>
                                                            <span style={{ fontSize: '0.68rem', color: '#94a3b8', marginLeft: 6 }}>({step.stepKey})</span>
                                                        </td>
                                                        <td>{resourceLabel(step.resourceKey)}</td>
                                                        <td>{step.durationMin} min</td>
                                                        <td style={{ color: '#64748b', fontFamily: 'monospace' }}>{step.displayOrder ?? '—'}</td>
                                                        <td>
                                                            {step.autoProgress ? (
                                                                <span className="uk-label" style={{ fontSize: '0.65rem', background: '#3b82f6' }}>Iniciar/Completar</span>
                                                            ) : (
                                                                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Solo completar</span>
                                                            )}
                                                        </td>
                                                        <td>
                                                            {step.isOptional ? (
                                                                <span className="uk-label" style={{ fontSize: '0.65rem', background: '#f59e0b' }}>Opcional</span>
                                                            ) : (
                                                                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Obligatorio</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal de edición */}
            {editing !== null && (
                <ItineraryModal
                    initial={editing}
                    resources={resources}
                    token={token}
                    onSave={() => { setEditing(null); load(); }}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
}

function ItineraryModal({ initial, resources, token, onSave, onClose }) {
    const isNew = !initial.id;
    const [name, setName] = useState(initial.name || '');
    const [description, setDescription] = useState(initial.description || '');
    const [steps, setSteps] = useState(
        initial.steps?.length > 0
            ? initial.steps.map(s => ({ ...s }))
            : [{ stepKey: 'recepcion', stepLabel: 'Recepción', durationMin: 3, resourceKey: 'manual', autoProgress: false }]
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const addStep = (preset) => {
        setSteps(prev => [...prev, { ...preset }]);
    };

    const removeStep = (idx) => {
        setSteps(prev => prev.filter((_, i) => i !== idx));
    };

    const moveStep = (idx, dir) => {
        const newSteps = [...steps];
        const target = idx + dir;
        if (target < 0 || target >= newSteps.length) return;
        [newSteps[idx], newSteps[target]] = [newSteps[target], newSteps[idx]];
        setSteps(newSteps);
    };

    const updateStep = (idx, field, value) => {
        setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
    };

    const handleSave = async () => {
        if (!name.trim()) { setError('El nombre es obligatorio'); return; }
        if (steps.length === 0) { setError('Debe tener al menos un paso'); return; }
        setSaving(true);
        setError('');
        try {
            const payload = { name, description, steps };
            if (isNew) {
                await createItinerary(token, payload);
            } else {
                await updateItinerary(token, initial.id, payload);
            }
            UIkit.notification({ message: isNew ? 'Itinerario creado' : 'Itinerario actualizado', status: 'success', pos: 'top-right', timeout: 2000 });
            onSave();
        } catch (e) {
            setError(e?.error || 'Error guardando');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1100,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '40px 20px', overflowY: 'auto',
        }} onClick={onClose}>
            <div style={{
                background: '#fff', borderRadius: 12, padding: 24, maxWidth: 700, width: '100%',
                maxHeight: '90vh', overflowY: 'auto',
            }} onClick={e => e.stopPropagation()}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 16px' }}>
                    {isNew ? 'Nuevo itinerario' : `Editar: ${initial.name}`}
                </h3>

                {error && <div className="uk-alert-danger" uk-alert="true" style={{ marginBottom: 12 }}><p>{error}</p></div>}

                {/* Nombre y descripción */}
                <div className="uk-margin-small">
                    <label className="uk-form-label" style={{ fontSize: '0.8rem' }}>Nombre del itinerario</label>
                    <input className="uk-input uk-form-small" value={name} onChange={e => setName(e.target.value)}
                        placeholder="Ej: Lavado mojado + plancha" />
                </div>
                <div className="uk-margin-small">
                    <label className="uk-form-label" style={{ fontSize: '0.8rem' }}>Descripción (opcional)</label>
                    <input className="uk-input uk-form-small" value={description} onChange={e => setDescription(e.target.value)}
                        placeholder="Ej: Lavado en agua, secado, planchado y embolsado" />
                </div>

                {/* Pasos */}
                <div style={{ marginTop: 16 }}>
                    <label className="uk-form-label" style={{ fontSize: '0.8rem', marginBottom: 8, display: 'block' }}>
                        Pasos del itinerario (en orden)
                    </label>

                    {steps.map((step, idx) => (
                        <div key={idx} style={{
                            display: 'flex', gap: 6, alignItems: 'center',
                            padding: '8px 10px', marginBottom: 4,
                            background: '#f8fafc', borderRadius: 6, border: '1px solid #e5e7eb',
                            fontSize: '0.8rem',
                        }}>
                            <span style={{ width: 24, color: '#94a3b8', fontWeight: 600, flexShrink: 0 }}>{idx + 1}</span>

                            <input className="uk-input uk-form-small" style={{ width: 130 }}
                                value={step.stepLabel} onChange={e => updateStep(idx, 'stepLabel', e.target.value)}
                                placeholder="Nombre paso" />

                            <select className="uk-select uk-form-small" style={{ width: 140 }}
                                value={step.resourceKey || ''} onChange={e => updateStep(idx, 'resourceKey', e.target.value || null)}>
                                <option value="">Sin recurso</option>
                                {resources.map(r => (
                                    <option key={r.resourceKey} value={r.resourceKey}>{r.label}</option>
                                ))}
                            </select>

                            <input className="uk-input uk-form-small" style={{ width: 60 }} type="number"
                                value={step.durationMin} onChange={e => updateStep(idx, 'durationMin', parseInt(e.target.value) || 0)}
                                title="Duración (min)" />
                            <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>min</span>

                            <input className="uk-input uk-form-small" style={{ width: 50 }} type="number"
                                value={step.displayOrder ?? 0} onChange={e => updateStep(idx, 'displayOrder', parseInt(e.target.value) || 0)}
                                title="Orden en el tablero (número menor = más a la izquierda)" />
                            <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>ord</span>

                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', whiteSpace: 'nowrap' }}
                                title="Marcar si el paso tiene un proceso automático (ej: lavadora). Mostrará Iniciar/Completar en vez de solo Completar.">
                                <input type="checkbox" className="uk-checkbox" style={{ width: 16, height: 16 }}
                                    checked={step.autoProgress || false}
                                    onChange={e => updateStep(idx, 'autoProgress', e.target.checked)} />
                                Auto
                            </label>

                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', whiteSpace: 'nowrap' }}
                                title="Paso opcional: se activa manualmente al crear cada pedido si es necesario (ej: descosido, arreglo).">
                                <input type="checkbox" className="uk-checkbox" style={{ width: 16, height: 16 }}
                                    checked={step.isOptional || false}
                                    onChange={e => updateStep(idx, 'isOptional', e.target.checked)} />
                                Opcional
                            </label>

                            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                                <button type="button" className="uk-button uk-button-default uk-button-small"
                                    style={{ padding: '0 4px', fontSize: '0.7rem', minWidth: 24 }}
                                    onClick={() => moveStep(idx, -1)} disabled={idx === 0}>↑</button>
                                <button type="button" className="uk-button uk-button-default uk-button-small"
                                    style={{ padding: '0 4px', fontSize: '0.7rem', minWidth: 24 }}
                                    onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1}>↓</button>
                                <button type="button" className="uk-button uk-button-danger uk-button-small"
                                    style={{ padding: '0 6px', fontSize: '0.7rem', minWidth: 24 }}
                                    onClick={() => removeStep(idx)}>×</button>
                            </div>
                        </div>
                    ))}

                    {/* Botones para añadir pasos rápidamente */}
                    <div style={{ marginTop: 10 }}>
                        <p style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 6 }}>Añadir paso:</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {STEP_PRESETS.map(preset => (
                                <button key={preset.stepKey}
                                    type="button"
                                    className="uk-button uk-button-default uk-button-small"
                                    style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                                    onClick={() => addStep(preset)}
                                >
                                    + {preset.stepLabel}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Acciones */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
                    <button className="uk-button uk-button-default uk-button-small" onClick={onClose}>Cancelar</button>
                    <button className="uk-button uk-button-primary uk-button-small" onClick={handleSave} disabled={saving}>
                        {saving ? 'Guardando...' : (isNew ? 'Crear itinerario' : 'Guardar cambios')}
                    </button>
                </div>
            </div>
        </div>
    );
}

