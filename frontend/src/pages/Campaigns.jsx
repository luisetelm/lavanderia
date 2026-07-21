import React, { useEffect, useState, useCallback } from 'react';
import { confirmar } from '../utils/dialogo.js';
import UIkit from 'uikit';
import PageToolbar from '../components/PageToolbar.jsx';
import {
    fetchCampaignTemplates,
    previewCampaignAudience,
    fetchCampaigns,
    fetchCampaign,
    createCampaign,
    sendCampaign,
    deleteCampaign,
} from '../api.js';

const STATUS_LABELS = {
    draft: { label: 'Borrador', color: '#64748b' },
    sending: { label: 'Enviando…', color: '#0284c7' },
    completed: { label: 'Completada', color: '#16a34a' },
    canceled: { label: 'Cancelada', color: '#dc2626' },
};

function StatusBadge({ status }) {
    const s = STATUS_LABELS[status] || { label: status, color: '#64748b' };
    return (
        <span style={{
            background: s.color, color: '#fff', fontSize: '0.7rem', fontWeight: 700,
            padding: '2px 8px', borderRadius: 999,
        }}>{s.label}</span>
    );
}

export default function Campaigns({ token }) {
    const [templates, setTemplates] = useState([]);
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);

    // Formulario de nueva campaña
    const [name, setName] = useState('');
    const [templateName, setTemplateName] = useState('');
    const [onlyWhatsApp, setOnlyWhatsApp] = useState(true);
    const [lastOrderMonths, setLastOrderMonths] = useState('');
    const [audience, setAudience] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [creating, setCreating] = useState(false);

    // Detalle
    const [detail, setDetail] = useState(null);

    const filters = useCallback(() => ({
        onlyWhatsApp,
        lastOrderMonths: lastOrderMonths ? Number(lastOrderMonths) : undefined,
    }), [onlyWhatsApp, lastOrderMonths]);

    const loadAll = useCallback(async () => {
        try {
            const [tpls, camps] = await Promise.all([
                fetchCampaignTemplates(token).catch(() => []),
                fetchCampaigns(token),
            ]);
            setTemplates(Array.isArray(tpls) ? tpls : []);
            setCampaigns(camps);
        } catch (err) {
            console.error('Error cargando campañas:', err);
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => { loadAll(); }, [loadAll]);

    // Refresco periódico mientras haya campañas enviándose
    useEffect(() => {
        const anySending = campaigns.some(c => c.status === 'sending');
        if (!anySending) return;
        const t = setInterval(loadAll, 5000);
        return () => clearInterval(t);
    }, [campaigns, loadAll]);

    const selectedTemplate = templates.find(t => t.name === templateName);

    const handlePreview = async () => {
        setPreviewing(true);
        try {
            const res = await previewCampaignAudience(token, filters());
            setAudience(res);
        } catch (err) {
            UIkit.notification({ message: err.error || 'Error calculando audiencia', status: 'danger', pos: 'top-right' });
        } finally {
            setPreviewing(false);
        }
    };

    const handleCreate = async () => {
        if (!name.trim() || !templateName) {
            UIkit.notification({ message: 'Indica un nombre y una plantilla', status: 'warning', pos: 'top-right' });
            return;
        }
        setCreating(true);
        try {
            await createCampaign(token, {
                name: name.trim(),
                templateName,
                language: selectedTemplate?.language || 'es',
                filters: filters(),
            });
            UIkit.notification({ message: 'Campaña creada como borrador', status: 'success', pos: 'top-right' });
            setName(''); setTemplateName(''); setAudience(null);
            await loadAll();
        } catch (err) {
            UIkit.notification({ message: err.error || 'Error creando campaña', status: 'danger', pos: 'top-right' });
        } finally {
            setCreating(false);
        }
    };

    const handleSend = async (campaign) => {
        const ok = await confirmar(
            `Vas a enviar la campaña "${campaign.name}" a ${campaign.totalRecipients} destinatarios por WhatsApp.\n\n¿Continuar?`,
            {titulo: 'Enviar campaña', textoConfirmar: 'Enviar'}
        );
        if (!ok) return;
        try {
            await sendCampaign(token, campaign.id);
            UIkit.notification({ message: 'Envío iniciado', status: 'success', pos: 'top-right' });
            await loadAll();
        } catch (err) {
            UIkit.notification({ message: err.error || 'Error enviando campaña', status: 'danger', pos: 'top-right' });
        }
    };

    const handleDelete = async (campaign) => {
        const ok = await confirmar(`¿Eliminar la campaña "${campaign.name}"?`,
            {peligroso: true, textoConfirmar: 'Eliminar'});
        if (!ok) return;
        try {
            await deleteCampaign(token, campaign.id);
            await loadAll();
        } catch (err) {
            UIkit.notification({ message: err.error || 'Error eliminando', status: 'danger', pos: 'top-right' });
        }
    };

    const openDetail = async (id) => {
        try {
            const res = await fetchCampaign(token, id);
            setDetail(res);
        } catch (err) {
            UIkit.notification({ message: err.error || 'Error cargando detalle', status: 'danger', pos: 'top-right' });
        }
    };

    const marketingTemplates = templates.filter(t => t.usable);

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center' }}><span uk-spinner=""></span></div>;
    }

    return (
        <div className="page-container" style={{ padding: '0 16px 40px' }}>
            <PageToolbar title="Campañas de WhatsApp" />

            {/* Aviso de cumplimiento */}
            <div className="uk-alert uk-alert-warning" style={{ fontSize: '0.85rem' }}>
                <strong>Recuerda:</strong> los envíos masivos usan plantillas de categoría <b>MARKETING</b> aprobadas por Meta y solo se
                mandan a clientes que no han rechazado las notificaciones. Cada conversación de marketing tiene coste.
            </div>

            <div className="uk-grid-small uk-child-width-1-1 uk-child-width-1-2@m" uk-grid="">
                {/* Formulario nueva campaña */}
                <div>
                    <div className="uk-card uk-card-default uk-card-body uk-card-small">
                        <h3 className="uk-card-title" style={{ fontSize: '1.05rem' }}>Nueva campaña</h3>

                        <label className="uk-form-label">Nombre</label>
                        <input className="uk-input" value={name} onChange={e => setName(e.target.value)}
                            placeholder="Ej: Promo primavera" />

                        <label className="uk-form-label" style={{ marginTop: 10 }}>Plantilla</label>
                        <select className="uk-select" value={templateName} onChange={e => setTemplateName(e.target.value)}>
                            <option value="">— Selecciona una plantilla —</option>
                            {marketingTemplates.map(t => (
                                <option key={t.name} value={t.name}>
                                    {t.name} {t.isMarketing ? '' : '(no es MARKETING)'} · {t.language}
                                </option>
                            ))}
                        </select>
                        {templates.length === 0 && (
                            <p style={{ fontSize: '0.78rem', color: '#dc2626', marginTop: 4 }}>
                                No se pudieron cargar plantillas. Revisa la configuración de WhatsApp Business.
                            </p>
                        )}
                        {selectedTemplate && !selectedTemplate.isMarketing && (
                            <p style={{ fontSize: '0.78rem', color: '#d97706', marginTop: 4 }}>
                                ⚠️ Esta plantilla no es de categoría MARKETING; Meta puede rechazar el envío masivo.
                            </p>
                        )}
                        {selectedTemplate?.bodyVariables > 0 && (
                            <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 4 }}>
                                Se sustituirá {'{{1}}'} por el nombre del cliente.
                            </p>
                        )}

                        <hr />
                        <h4 style={{ fontSize: '0.95rem', margin: '6px 0' }}>Audiencia</h4>

                        <label style={{ display: 'block', fontSize: '0.85rem' }}>
                            <input className="uk-checkbox" type="checkbox" checked={onlyWhatsApp}
                                onChange={e => setOnlyWhatsApp(e.target.checked)} style={{ marginRight: 6 }} />
                            Solo clientes con WhatsApp
                        </label>

                        <label className="uk-form-label" style={{ marginTop: 8 }}>Con pedidos en los últimos (meses)</label>
                        <input className="uk-input" type="number" min="1" value={lastOrderMonths}
                            onChange={e => setLastOrderMonths(e.target.value)} placeholder="Cualquiera" />

                        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button className="uk-button uk-button-default uk-button-small" onClick={handlePreview} disabled={previewing}>
                                {previewing ? 'Calculando…' : 'Previsualizar audiencia'}
                            </button>
                            {audience && (
                                <span style={{ fontWeight: 700, color: '#0284c7' }}>{audience.count} destinatarios</span>
                            )}
                        </div>

                        <button className="uk-button uk-button-primary uk-width-1-1" style={{ marginTop: 14 }}
                            onClick={handleCreate} disabled={creating}>
                            {creating ? 'Creando…' : 'Crear campaña (borrador)'}
                        </button>
                    </div>
                </div>

                {/* Lista de campañas */}
                <div>
                    <div className="uk-card uk-card-default uk-card-body uk-card-small">
                        <h3 className="uk-card-title" style={{ fontSize: '1.05rem' }}>Campañas</h3>
                        {campaigns.length === 0 && <p style={{ color: '#64748b' }}>Aún no hay campañas.</p>}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {campaigns.map(c => (
                                <div key={c.id} style={{
                                    border: '1px solid #e2e8f0', borderRadius: 8, padding: 10,
                                    display: 'flex', flexDirection: 'column', gap: 4,
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                        <strong style={{ cursor: 'pointer' }} onClick={() => openDetail(c.id)}>{c.name}</strong>
                                        <StatusBadge status={c.status} />
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                        Plantilla: {c.templateName} · {c.totalRecipients} destinatarios
                                        {c.status === 'completed' && ` · ✅ ${c.sentCount} · ❌ ${c.failedCount}`}
                                    </div>
                                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                        {c.status === 'draft' && (
                                            <button className="uk-button uk-button-primary uk-button-small" onClick={() => handleSend(c)}>
                                                Enviar
                                            </button>
                                        )}
                                        <button className="uk-button uk-button-default uk-button-small" onClick={() => openDetail(c.id)}>
                                            Ver
                                        </button>
                                        {c.status !== 'sending' && (
                                            <button className="uk-button uk-button-danger uk-button-small" onClick={() => handleDelete(c)}>
                                                Eliminar
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal detalle */}
            {detail && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
                }} onClick={() => setDetail(null)}>
                    <div style={{
                        background: '#fff', borderRadius: 10, padding: 20, maxWidth: 640, width: '100%',
                        maxHeight: '85vh', overflow: 'auto',
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0 }}>{detail.campaign.name}</h3>
                            <button className="uk-icon-button" uk-icon="close" onClick={() => setDetail(null)} />
                        </div>
                        <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                            Plantilla: {detail.campaign.templateName} · <StatusBadge status={detail.campaign.status} />
                        </p>
                        <div style={{ display: 'flex', gap: 16, margin: '10px 0', fontSize: '0.85rem' }}>
                            <span>Total: <b>{detail.campaign.totalRecipients}</b></span>
                            <span style={{ color: '#16a34a' }}>Enviados: <b>{detail.stats.sent || 0}</b></span>
                            <span style={{ color: '#dc2626' }}>Fallidos: <b>{detail.stats.failed || 0}</b></span>
                            <span style={{ color: '#64748b' }}>Pendientes: <b>{detail.stats.pending || 0}</b></span>
                        </div>
                        <table className="uk-table uk-table-small uk-table-divider" style={{ fontSize: '0.8rem' }}>
                            <thead><tr><th>Cliente</th><th>Teléfono</th><th>Estado</th><th>Error</th></tr></thead>
                            <tbody>
                                {detail.recipients.map(r => (
                                    <tr key={r.id}>
                                        <td>{r.firstName || '—'}</td>
                                        <td>{r.phone}</td>
                                        <td><StatusBadge status={r.status} /></td>
                                        <td style={{ color: '#dc2626' }}>{r.error || ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

