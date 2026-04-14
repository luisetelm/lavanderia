import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDraftOrder } from '../hooks/useDraftOrder.js';
import { createOrder, updateUser } from '../api.js';

const isValidSpanishPhone = (phone) => /^[6789]\d{8}$/.test(phone);

const GARMENT_COLORS = [
    { key: 'negro',    label: 'Negro',     hex: '#1e1e1e' },
    { key: 'blanco',   label: 'Blanco',    hex: '#f5f5f5' },
    { key: 'gris',     label: 'Gris',      hex: '#9ca3af' },
    { key: 'azul',     label: 'Azul',      hex: '#3b82f6' },
    { key: 'marino',   label: 'Marino',    hex: '#1e3a5f' },
    { key: 'rojo',     label: 'Rojo',      hex: '#ef4444' },
    { key: 'verde',    label: 'Verde',     hex: '#22c55e' },
    { key: 'marron',   label: 'Marrón',    hex: '#92400e' },
    { key: 'beige',    label: 'Beige',     hex: '#d4b896' },
    { key: 'rosa',     label: 'Rosa',      hex: '#f472b6' },
    { key: 'amarillo', label: 'Amarillo',  hex: '#facc15' },
    { key: 'morado',   label: 'Morado',    hex: '#a855f7' },
    { key: 'burdeos',  label: 'Burdeos',   hex: '#7f1d1d' },
    { key: 'naranja',  label: 'Naranja',   hex: '#f97316' },
];

export default function DraftOrderBanner({ token, worker }) {
    const draft = useDraftOrder();
    const navigate = useNavigate();
    const bannerRef = useRef(null);

    const [expanded, setExpanded] = useState(true);
    const [expandedLineId, setExpandedLineId] = useState(null);
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
        cart, selectedUser, quickClient, fechaLimite, observaciones,
        updateQuantity, removeFromCart, getPriceForItem,
        updateLineNotes, addLinePhoto, removeLinePhoto, splitLine,
        toggleOptionalStep, setLineColor,
        total, itemCount, clientName, discount, clearDraft, setSelectedUser,
    } = draft;

    const formattedDate = fechaLimite
        ? new Date(fechaLimite).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
        : '—';

    const hasDiscount = discount > 0;

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

    const handleDiscard = () => {
        if (confirm('¿Descartar el pedido en curso?')) {
            clearDraft();
            setExpanded(false);
            setError('');
        }
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

    /* ── Comprimir foto a JPEG pequeño ── */
    const compressPhoto = (file) => new Promise((resolve) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => {
            img.onload = () => {
                const MAX = 800;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) {
                    const ratio = Math.min(MAX / w, MAX / h);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.6));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });

    const handlePhotoCapture = async (lineId, e) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
            const dataUrl = await compressPhoto(file);
            addLinePhoto(lineId, dataUrl);
        }
        e.target.value = '';
    };

    return (
        <>
            <div ref={bannerRef} style={barStyle}>
                {/* ── Flecha toggle centrada arriba ── */}
                <div
                    onClick={() => { setExpanded(!expanded); setExpandedLineId(null); }}
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

                {/* ── Barra resumen ── */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '4px 16px 10px', gap: 10, flexWrap: 'wrap',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{
                            background: '#048ABF', borderRadius: 6, padding: '2px 10px',
                            fontWeight: 700, fontSize: '0.72rem', flexShrink: 0, letterSpacing: '0.03em',
                        }}>
                            PEDIDO EN CURSO
                        </span>

                        {clientName && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.83rem' }}>
                                <span uk-icon="icon: user; ratio: 0.7"></span>
                                <span style={{ fontWeight: 500 }}>{clientName}</span>
                            </span>
                        )}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.83rem' }}>
                            <span uk-icon="icon: bag; ratio: 0.7"></span>
                            {itemCount} {itemCount === 1 ? 'prenda' : 'prendas'}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.83rem' }}>
                            <span uk-icon="icon: calendar; ratio: 0.7"></span>
                            {formattedDate}
                        </span>
                        <span style={{ fontWeight: 700, color: '#5AB5BF', fontSize: '0.9rem' }}>
                            {total.toFixed(2)} €
                        </span>
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
                            style={{ ...btnSmall('#048ABF', '#fff'), fontWeight: 600 }}
                            onClick={handleValidate}
                            disabled={submitting}
                        >
                            {submitting ? 'Validando...' : 'Validar pedido'}
                        </button>
                        <button style={btnSmall('rgba(220,38,38,0.2)', '#f87171')} onClick={handleDiscard}>
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

                {/* ── Panel expandido ── */}
                {expanded && (
                    <div style={{
                        borderTop: '1px solid rgba(255,255,255,0.08)',
                        padding: '10px 16px 14px',
                        maxHeight: 400,
                        overflowY: 'auto',
                    }}>
                        {cart.map(c => {
                            const unitPrice = getPriceForItem(c);
                            const lineTotal = unitPrice * c.quantity;
                            const baseTotal = Number(c.basePrice) * c.quantity;
                            const hasLineDetail = c.notes || (c.photos && c.photos.length > 0);
                            const hasOptionalSteps = (c.availableOptionalSteps || []).length > 0;
                            const isLineOpen = expandedLineId === c.lineId;

                            return (
                                <div key={c.lineId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    {/* Fila principal */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', fontSize: '0.82rem' }}>
                                        {/* Nombre + indicadores — ancho fijo */}
                                        <div style={{ width: 140, flexShrink: 0, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' }}>
                                            {/* Color dot (selected) */}
                                            {c.color && (() => {
                                                const col = GARMENT_COLORS.find(g => g.key === c.color);
                                                return col ? (
                                                    <span style={{
                                                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                                                        background: col.hex,
                                                        border: col.key === 'blanco' ? '1px solid #666' : '1px solid rgba(255,255,255,0.2)',
                                                    }} title={col.label}></span>
                                                ) : null;
                                            })()}
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                                            {hasLineDetail && (
                                                <span style={{ color: '#fbbf24', fontSize: '0.7rem', display: 'flex', gap: 2, flexShrink: 0 }}>
                                                    {c.notes && <span uk-icon="icon: file-edit; ratio: 0.45"></span>}
                                                    {c.photos?.length > 0 && <span uk-icon="icon: camera; ratio: 0.45"></span>}
                                                </span>
                                            )}
                                        </div>

                                        {/* Color picker inline */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                                            {GARMENT_COLORS.map(gc => {
                                                const selected = c.color === gc.key;
                                                return (
                                                    <button
                                                        key={gc.key}
                                                        type="button"
                                                        title={gc.label}
                                                        onClick={() => setLineColor(c.lineId, selected ? null : gc.key)}
                                                        style={{
                                                            width: 14, height: 14, borderRadius: '50%',
                                                            background: gc.hex, cursor: 'pointer', padding: 0,
                                                            border: selected ? '2px solid #fbbf24' : (gc.key === 'blanco' ? '1px solid #666' : '1px solid rgba(255,255,255,0.12)'),
                                                            outline: selected ? '1px solid #fbbf24' : 'none',
                                                            outlineOffset: 1,
                                                            transition: 'all 0.1s',
                                                        }}
                                                    />
                                                );
                                            })}
                                        </div>

                                        {/* Cantidad */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                            <button style={btnSmall()} onClick={() => updateQuantity(c.lineId, c.quantity - 1)}>-</button>
                                            <span style={{ minWidth: 18, textAlign: 'center' }}>{c.quantity}</span>
                                            <button style={btnSmall()} onClick={() => updateQuantity(c.lineId, c.quantity + 1)}>+</button>
                                        </div>

                                        {/* Precio */}
                                        <div style={{ width: 75, textAlign: 'right', flexShrink: 0 }}>
                                            {hasDiscount && (
                                                <span style={{ textDecoration: 'line-through', color: '#64748b', fontSize: '0.72em', marginRight: 4 }}>
                                                    {baseTotal.toFixed(2)}
                                                </span>
                                            )}
                                            <span style={{ color: '#e2e8f0' }}>{lineTotal.toFixed(2)} €</span>
                                        </div>

                                        {/* Botón detalle (nota/foto) */}
                                        <button
                                            style={{
                                                ...btnSmall(isLineOpen ? 'rgba(4,138,191,0.3)' : undefined),
                                                padding: '2px 5px', flexShrink: 0,
                                            }}
                                            title="Nota / Foto"
                                            onClick={() => setExpandedLineId(isLineOpen ? null : c.lineId)}
                                        >
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                <span uk-icon="icon: comment; ratio: 0.55"></span>
                                                <span uk-icon="icon: camera; ratio: 0.55"></span>
                                            </span>
                                        </button>

                                        {/* Desglosar */}
                                        {c.quantity > 1 && (
                                            <button
                                                style={{ ...btnSmall(), padding: '2px 5px', flexShrink: 0 }}
                                                title="Desglosar en prendas individuales"
                                                onClick={() => splitLine(c.lineId)}
                                            >
                                                <span uk-icon="icon: grid; ratio: 0.55"></span>
                                            </button>
                                        )}

                                        {/* Eliminar */}
                                        <button
                                            style={{ ...btnSmall('rgba(220,38,38,0.15)', '#f87171'), padding: '2px 5px', flexShrink: 0 }}
                                            onClick={() => removeFromCart(c.lineId)}
                                        >×</button>
                                    </div>

                                    {/* Pasos opcionales (solo si existen) */}
                                    {hasOptionalSteps && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', padding: '0 0 4px 30px' }}>
                                            <span style={{ fontSize: '0.65rem', color: '#64748b', marginRight: 2, whiteSpace: 'nowrap' }}>Extra:</span>
                                            {(c.availableOptionalSteps || []).map(step => {
                                                const selected = (c.optionalStepIds || []).includes(step.id);
                                                return (
                                                    <button
                                                        key={step.id}
                                                        type="button"
                                                        onClick={() => toggleOptionalStep(c.lineId, step.id)}
                                                        style={{
                                                            fontSize: '0.68rem', padding: '1px 8px', borderRadius: 12,
                                                            border: selected ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.15)',
                                                            background: selected ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.06)',
                                                            color: selected ? '#fbbf24' : '#94a3b8',
                                                            cursor: 'pointer', transition: 'all 0.15s',
                                                            fontWeight: selected ? 600 : 400,
                                                        }}
                                                    >
                                                        {selected ? '✓ ' : ''}{step.stepLabel}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Panel inline de detalle (nota + fotos) */}
                                    {isLineOpen && (
                                        <div style={{
                                            padding: '6px 0 10px 12px',
                                            borderLeft: '2px solid #048ABF',
                                            marginLeft: 4,
                                            marginBottom: 4,
                                        }}>
                                            {/* Chips rápidos */}
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
                                                {['Mancha difícil', 'Prenda delicada', 'Sin garantía', 'Botones sueltos', 'Color desteñido'].map(chip => (
                                                    <button
                                                        key={chip}
                                                        type="button"
                                                        style={{
                                                            fontSize: '0.65rem', padding: '1px 8px', borderRadius: 12,
                                                            border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)',
                                                            color: '#94a3b8', cursor: 'pointer',
                                                        }}
                                                        onClick={() => {
                                                            const cur = (c.notes || '').trim();
                                                            const sep = cur ? '. ' : '';
                                                            updateLineNotes(c.lineId, cur + sep + chip);
                                                        }}
                                                    >
                                                        {chip}
                                                    </button>
                                                ))}
                                            </div>

                                            {/* Nota de texto */}
                                            <input
                                                type="text"
                                                value={c.notes || ''}
                                                onChange={(e) => updateLineNotes(c.lineId, e.target.value)}
                                                placeholder="Nota: mancha, daño, etc."
                                                style={{
                                                    width: '100%', background: 'rgba(255,255,255,0.07)',
                                                    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5,
                                                    color: '#e2e8f0', fontSize: '0.78rem', padding: '5px 8px',
                                                    outline: 'none', marginBottom: 6,
                                                }}
                                            />

                                            {/* Fotos capturadas */}
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                                {(c.photos || []).map((photo, pi) => (
                                                    <div key={pi} style={{ position: 'relative' }}>
                                                        <img
                                                            src={photo}
                                                            alt={`Foto ${pi + 1}`}
                                                            style={{
                                                                width: 56, height: 56, objectFit: 'cover',
                                                                borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)',
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => removeLinePhoto(c.lineId, pi)}
                                                            style={{
                                                                position: 'absolute', top: -4, right: -4,
                                                                width: 16, height: 16, borderRadius: '50%',
                                                                background: '#dc2626', color: '#fff', border: 'none',
                                                                fontSize: '0.6rem', lineHeight: '16px', cursor: 'pointer',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            }}
                                                        >×</button>
                                                    </div>
                                                ))}

                                                {/* Botón captura */}
                                                <label style={{
                                                    width: 56, height: 56, borderRadius: 6,
                                                    border: '1px dashed rgba(255,255,255,0.25)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    cursor: 'pointer', color: '#94a3b8',
                                                    background: 'rgba(255,255,255,0.04)',
                                                }}>
                                                    <span uk-icon="icon: plus; ratio: 0.8"></span>
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        capture="environment"
                                                        multiple
                                                        style={{ display: 'none' }}
                                                        onChange={(e) => handlePhotoCapture(c.lineId, e)}
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

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

