import React, { useState, useRef, useEffect } from 'react';
import { confirmar } from '../utils/dialogo.js';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDraftOrder } from '../hooks/useDraftOrder.js';
import { createOrder, updateUser, fetchOrder } from '../api.js';
import { printWashLabels } from '../utils/printUtils.js';
import { getPrintSettings } from '../utils/printSettings.js';
import DraftLines from './DraftLines.jsx';

const isValidSpanishPhone = (phone) => /^[6789]\d{8}$/.test(phone);

// Barra flotante del pedido en curso. En cualquier ruta muestra el resumen y
// permite validar o descartar; fuera del POS además se puede desplegar para
// editar las prendas. En el POS las prendas se editan en la propia página,
// así que la barra queda compacta (solo resumen y acciones).
export default function DraftOrderBanner({ token, worker }) {
    const draft = useDraftOrder();
    const navigate = useNavigate();
    const location = useLocation();
    const bannerRef = useRef(null);
    const compact = location.pathname === '/pos';

    const [expanded, setExpanded] = useState(true);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showNotifyPrompt, setShowNotifyPrompt] = useState(false);
    const [pendingPayload, setPendingPayload] = useState(null);

    // Medir la altura del banner y comunicarla al contexto
    useEffect(() => {
        const el = bannerRef.current;
        if (!el) { draft.setBannerHeight(0); return; }

        const observer = new ResizeObserver(([entry]) => {
            draft.setBannerHeight(Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height));
        });
        observer.observe(el);
        return () => { observer.disconnect(); draft.setBannerHeight(0); };
    }, [draft.isActive]);

    if (!draft.isActive) return null;

    const {
        cart, selectedUser, quickClient, fechaLimite, observaciones, sinSuplemento,
        itemCount, clientName, discount, clearDraft, setSelectedUser, getPriceForItem,
        suplementoUrgencia, totalConSuplemento: total,
    } = draft;

    const formattedDate = fechaLimite
        ? new Date(fechaLimite).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
        : '—';

    const hasDiscount = discount > 0;
    const showPanel = expanded && !compact;

    /* ── Validar pedido ── */
    const handleValidate = async () => {
        setError('');

        if (!cart.length) { setError('El carrito está vacío'); return; }
        if (!selectedUser && (!quickClient.firstName || !quickClient.lastName)) {
            setError('Selecciona un cliente o introduce nombre y apellidos');
            return;
        }
        const phone = selectedUser ? selectedUser.phone : quickClient.phone;
        if (!phone || !isValidSpanishPhone(phone)) {
            setError('Teléfono válido obligatorio');
            return;
        }

        const linesPayload = cart.map(c => ({
            productId: c.productId,
            quantity: c.quantity,
            unitPrice: getPriceForItem(c),
            notes: c.notes || '',
            photos: (c.photos || []),
            optionalStepIds: (c.optionalStepIds || []),
            color: c.color || null,
        }));

        const payload = {
            lines: linesPayload,
            observaciones,
            fechaLimite: fechaLimite || undefined,
        };
        // Sólo administración puede eximir el suplemento de urgencia (el backend lo comprueba)
        if (sinSuplemento && suplementoUrgencia.adelantada) payload.sinSuplemento = true;

        if (selectedUser) {
            payload.clientId = selectedUser.id;
        } else {
            payload.clientFirstName = quickClient.firstName;
            payload.clientLastName = quickClient.lastName;
            payload.clientPhone = quickClient.phone;
            if (quickClient.email) payload.clientEmail = quickClient.email;
        }

        payload.workerId = worker.id;

        // Si el cliente no tiene preferencia de notificación, preguntar
        if (selectedUser && !selectedUser.notifyChannel) {
            setPendingPayload(payload);
            setShowNotifyPrompt(true);
            return;
        }

        await submitOrder(payload);
    };

    const submitOrder = async (payload) => {
        setSubmitting(true);
        try {
            const o = await createOrder(token, payload);
            clearDraft();
            setExpanded(false);

            // Impresión automática al crear el pedido: SOLO las etiquetas de ropa
            // (impresora de etiquetas lavables). El ticket de cliente se imprime
            // al cobrar (o manualmente como justificante si aún no ha pagado).
            if (getPrintSettings().onCreate) {
                try {
                    const full = await fetchOrder(token, o.id);
                    const totalItems = (full.lines || []).reduce((sum, l) => {
                        if (l.product?.printWashLabel === false) return sum; // no genera etiquetas de lavado
                        const labels = l.product?.labelCount || 1;
                        return sum + (l.quantity || 1) * labels;
                    }, 0);
                    if (totalItems > 0) {
                        await printWashLabels({
                            orderNum: full.orderNum,
                            clientFirstName: full.client?.firstName || '',
                            clientLastName: full.client?.lastName || '',
                            totalItems,
                            fechaLimite: full.fechaLimite,
                        });
                    }
                } catch (printErr) {
                    console.warn('Impresión automática de etiquetas al crear falló:', printErr);
                }
            }

            navigate('/tareas', {
                state: { filterOrderId: o.id, orderNumber: o.orderNum || o.id },
            });
        } catch (err) {
            setError(err.error || 'Error al crear pedido');
        } finally {
            setSubmitting(false);
        }
    };

    const handleNotifyChoice = async (channel) => {
        setShowNotifyPrompt(false);
        if (selectedUser) {
            try {
                // El endpoint PUT requiere firstName, lastName, phone y role
                await updateUser(token, selectedUser.id, {
                    firstName: selectedUser.firstName,
                    lastName: selectedUser.lastName,
                    phone: selectedUser.phone,
                    role: selectedUser.role || 'customer',
                    notifyChannel: channel,
                });
                setSelectedUser({ ...selectedUser, notifyChannel: channel });
            } catch (err) {
                console.error('Error guardando preferencia:', err);
            }
        }
        if (pendingPayload) {
            await submitOrder(pendingPayload);
            setPendingPayload(null);
        }
    };

    const handleDiscard = async () => {
        if (await confirmar('¿Descartar el pedido en curso?', {peligroso: true, textoConfirmar: 'Descartar'})) {
            clearDraft();
            setExpanded(false);
            setError('');
        }
    };

    // En el POS, el chip de prendas lleva a la tarjeta donde se editan
    const scrollToLines = () => {
        document.getElementById('pos-prendas')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    /* ── Styles ── */
    const barStyle = {
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 400,
        background: '#0f172a', color: '#fff',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.25)',
        fontFamily: 'inherit',
        transition: 'max-height 0.3s ease',
    };

    const btnSmall = (bg = 'rgba(255,255,255,0.1)', color = '#cbd5e1') => ({
        padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)',
        background: bg, color, cursor: 'pointer', fontSize: '0.78rem', lineHeight: '22px',
    });

    const chipStyle = { display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.83rem' };

    return (
        <>
            <div ref={bannerRef} style={barStyle}>
                {/* ── Flecha toggle centrada arriba (solo fuera del POS) ── */}
                {!compact && (
                    <div
                        onClick={() => setExpanded(!expanded)}
                        style={{
                            display: 'flex', justifyContent: 'center', alignItems: 'center',
                            cursor: 'pointer', padding: '3px 0 0',
                            opacity: 0.5, transition: 'opacity 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                    >
                        <span uk-icon={`icon: ${expanded ? 'chevron-down' : 'chevron-up'}; ratio: 0.85`}></span>
                    </div>
                )}

                {/* ── Barra resumen ── */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: compact ? '8px 16px' : '4px 16px 10px', gap: 10, flexWrap: 'wrap',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{
                            background: '#048ABF', borderRadius: 6, padding: '2px 10px',
                            fontWeight: 700, fontSize: '0.72rem', flexShrink: 0, letterSpacing: '0.03em',
                        }}>
                            PEDIDO EN CURSO
                        </span>

                        <span style={{ ...chipStyle, color: clientName ? '#fff' : '#fbbf24' }}>
                            <span uk-icon="icon: user; ratio: 0.7"></span>
                            <span style={{ fontWeight: 500 }}>{clientName || 'Sin cliente'}</span>
                        </span>
                        <span
                            style={{ ...chipStyle, cursor: compact ? 'pointer' : 'default' }}
                            onClick={compact ? scrollToLines : undefined}
                            title={compact ? 'Ver las prendas del pedido' : undefined}
                        >
                            <span uk-icon="icon: bag; ratio: 0.7"></span>
                            {itemCount} {itemCount === 1 ? 'prenda' : 'prendas'}
                        </span>
                        <span style={chipStyle}>
                            <span uk-icon="icon: calendar; ratio: 0.7"></span>
                            {formattedDate}
                        </span>
                        <span style={{ fontWeight: 700, color: '#5AB5BF', fontSize: '0.95rem' }}>
                            {total.toFixed(2)} €
                        </span>
                        {suplementoUrgencia.aplicado && (
                            <span title={`Entrega adelantada ${suplementoUrgencia.dias} día(s) laborable(s): +${suplementoUrgencia.pct}% de suplemento de urgencia`} style={{
                                background: '#f59e0b', borderRadius: 6, padding: '1px 7px',
                                fontSize: '0.68rem', fontWeight: 600,
                            }}>
                                urgente +{suplementoUrgencia.importe.toFixed(2)} €
                            </span>
                        )}
                        {hasDiscount && (
                            <span style={{
                                background: '#10b981', borderRadius: 6, padding: '1px 7px',
                                fontSize: '0.68rem', fontWeight: 600,
                            }}>
                                -{discount}% dto.
                            </span>
                        )}
                        {observaciones && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.75rem', color: '#fbbf24' }}
                                  title={observaciones}>
                                <span uk-icon="icon: warning; ratio: 0.65"></span>
                                Obs.
                            </span>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                        <button
                            style={{ ...btnSmall('#048ABF', '#fff'), fontWeight: 600, padding: compact ? '4px 14px' : '2px 8px' }}
                            onClick={handleValidate}
                            disabled={submitting}
                        >
                            {submitting ? 'Validando...' : 'Validar pedido'}
                        </button>
                        <button style={btnSmall('rgba(220,38,38,0.2)', '#f87171')} onClick={handleDiscard} title="Descartar pedido">
                            <span uk-icon="icon: trash; ratio: 0.65"></span>
                        </button>
                    </div>
                </div>

                {/* ── Error de validación (siempre visible) ── */}
                {error && (
                    <div style={{
                        background: 'rgba(220,38,38,0.15)', color: '#fca5a5',
                        padding: '6px 16px', fontSize: '0.8rem',
                        borderTop: '1px solid rgba(220,38,38,0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                        <span>{error}</span>
                        <button
                            onClick={() => setError('')}
                            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: '0 4px', fontSize: '1rem' }}
                        >×</button>
                    </div>
                )}

                {/* ── Panel expandido (fuera del POS) ── */}
                {showPanel && (
                    <div style={{
                        borderTop: '1px solid rgba(255,255,255,0.08)',
                        padding: '10px 16px 14px',
                        maxHeight: 400,
                        overflowY: 'auto',
                    }}>
                        <DraftLines theme="dark" />

                        {/* Footer del panel expandido */}
                        <div style={{
                            marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)',
                        }}>
                            <div style={{ marginBottom: 8 }}>
                                <label style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginBottom: 3 }}>
                                    Observaciones
                                </label>
                                <textarea
                                    rows="2"
                                    value={observaciones}
                                    onChange={(e) => draft.setObservaciones(e.target.value)}
                                    placeholder="Notas sobre el pedido..."
                                    style={{
                                        width: '100%', background: 'rgba(255,255,255,0.07)',
                                        border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
                                        color: '#e2e8f0', fontSize: '0.8rem', padding: '6px 10px',
                                        resize: 'vertical', outline: 'none',
                                    }}
                                />
                            </div>
                            <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', color: '#5AB5BF' }}>
                                {suplementoUrgencia.aplicado && (
                                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f59e0b' }}>
                                        Suplemento urgencia (+{suplementoUrgencia.pct}%): {suplementoUrgencia.importe.toFixed(2)} €
                                    </div>
                                )}
                                Total: {total.toFixed(2)} €
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Modal de preferencia de notificación ── */}
            {showNotifyPrompt && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 500,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: '#fff', borderRadius: 10, padding: 24, maxWidth: 380, width: '90%',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
                    }}>
                        <h3 style={{ fontSize: '1.05rem', marginBottom: 4, color: '#1e293b' }}>
                            Preferencia de notificación
                        </h3>
                        <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 16px' }}>
                            ¿Cómo prefiere {selectedUser?.firstName} recibir avisos sobre sus pedidos?
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="uk-button uk-width-1-2" style={{ background: '#25D366', color: '#fff' }}
                                    onClick={() => handleNotifyChoice('whatsapp')}>WhatsApp</button>
                                <button className="uk-button uk-button-primary uk-width-1-2"
                                    onClick={() => handleNotifyChoice('sms')}>SMS</button>
                            </div>
                            <button className="uk-button uk-button-default uk-width-1-1"
                                onClick={() => handleNotifyChoice('none')}>No desea recibir avisos</button>
                        </div>
                        <div style={{ marginTop: 12, textAlign: 'right' }}>
                            <button className="uk-button uk-button-link"
                                onClick={() => { setShowNotifyPrompt(false); setPendingPayload(null); }}
                                style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Cancelar</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
